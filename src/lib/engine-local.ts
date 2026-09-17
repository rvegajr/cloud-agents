import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { SendFn, TurnResult } from "./build-loop.js";
import {
  assertClaudeCredential,
  createClaudeHandle,
  git,
  loadClaudeRecord,
  makeClaudeSend,
  openClaudeWorkspace,
  pushAndOpenPr,
  redactGitSecrets,
  saveClaudeRecord,
  scrubbedEnv,
  type ClaudeQueryFn,
  type ClaudeRecord,
  type EngineName,
} from "./engine-claude.js";
import { extractJsonBlock } from "./report.js";
import {
  classifyPrompt,
  loadMaxUsage,
  policyFromEnv,
  routeTurn,
  saveMaxUsage,
  type MaxUsage,
  type RoutingPolicy,
  type Tier,
  type TurnKind,
} from "./routing.js";
import type { AgentHandle } from "./slack-fix.js";

/**
 * The local executor: an Ollama model driven by an agentic CLI (qwen-code by
 * default, aider as the fast alternative) inside the same clone the Claude
 * engine uses. It has no session memory, so every turn is handed the outputs of
 * the turns before it. `createHybridHandle` composes it with `makeClaudeSend`
 * under the routing policy in `routing.ts`.
 */

export type LocalRunner = "qwen" | "aider";

export interface LocalConfig {
  /** Ollama base URL, no trailing slash. */
  host: string;
  /** Executor model tag as `ollama list` prints it. */
  model: string;
  /** Model for turns the policy diverts from Claude (plans over the ceiling, ENGINE=local). */
  plannerModel: string;
  runner: LocalRunner;
  timeoutMs: number;
}

export function localConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LocalConfig {
  const host = (env.OLLAMA_HOST?.trim() || "http://localhost:11434").replace(/\/+$/, "");
  const model = env.LOCAL_MODEL?.trim() || "qwen3-coder-next";
  const runnerRaw = env.LOCAL_RUNNER?.trim().toLowerCase();
  const minutes = Number(env.LOCAL_TURN_TIMEOUT_MIN);
  return {
    host: /^https?:\/\//.test(host) ? host : `http://${host}`,
    model,
    plannerModel: env.LOCAL_PLANNER_MODEL?.trim() || model,
    runner: runnerRaw === "aider" ? "aider" : "qwen",
    timeoutMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60_000,
  };
}

export async function ollamaModels(host: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchFn(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`ollama ${host}/api/tags -> HTTP ${res.status}`);
  const body = (await res.json()) as { models?: { name?: string }[] };
  return (body.models ?? []).map((m) => m.name ?? "").filter(Boolean);
}

/** `qwen3-coder-next` matches `qwen3-coder-next:latest`; an explicit tag must match exactly. */
export function modelIsPulled(model: string, pulled: string[]): boolean {
  if (pulled.includes(model)) return true;
  return !model.includes(":") && pulled.includes(`${model}:latest`);
}

export interface LocalCommand {
  file: string;
  args: string[];
  env: Record<string, string | undefined>;
}

/** The subprocess sees the login-scrubbed env plus only what the runner needs to reach Ollama. */
export function buildLocalCommand(cfg: LocalConfig, model: string, prompt: string): LocalCommand {
  const base = scrubbedEnv();
  delete base.OPENAI_API_KEY;
  delete base.OPENAI_BASE_URL;
  delete base.CLAUDE_CODE_OAUTH_TOKEN;
  if (cfg.runner === "aider") {
    return {
      file: "aider",
      args: [
        "--model",
        `ollama_chat/${model}`,
        "--message",
        prompt,
        "--yes-always",
        "--no-auto-commits",
        "--no-check-update",
        "--no-show-model-warnings",
        "--no-gitignore",
      ],
      env: { ...base, OLLAMA_API_BASE: cfg.host },
    };
  }
  return {
    file: "qwen",
    args: ["--auth-type", "openai", "--yolo", "--model", model, "--output-format", "text", prompt],
    env: {
      ...base,
      OPENAI_API_KEY: "ollama",
      OPENAI_BASE_URL: `${cfg.host}/v1`,
      OPENAI_MODEL: model,
      QWEN_CODE_SUPPRESS_YOLO_WARNING: "1",
    },
  };
}

export type ExecFn = (cmd: LocalCommand, cwd: string, timeoutMs: number) => Promise<{ stdout: string; stderr: string; code: number }>;

const execFileP = promisify(execFile);

export const defaultExec: ExecFn = async (cmd, cwd, timeoutMs) => {
  try {
    const { stdout, stderr } = await execFileP(cmd.file, cmd.args, {
      cwd,
      env: cmd.env as NodeJS.ProcessEnv,
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      killSignal: "SIGTERM",
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; message?: string };
    const code = typeof e.code === "number" ? e.code : e.killed ? 124 : 1;
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? String(err), code };
  }
};

export interface LocalTurnInfo {
  model: string;
  runner: LocalRunner;
  seconds: number;
  code: number;
}

export function makeLocalSend(opts: {
  cwd: string;
  cfg: LocalConfig;
  model?: string;
  exec?: ExecFn;
  onTurn?: (info: LocalTurnInfo) => void;
  log?: (line: string) => void;
}): SendFn {
  const exec = opts.exec ?? defaultExec;
  const model = opts.model ?? opts.cfg.model;
  return async (prompt): Promise<TurnResult> => {
    const cmd = buildLocalCommand(opts.cfg, model, prompt);
    const started = Date.now();
    opts.log?.(`local: ${opts.cfg.runner} ${model} (${prompt.length} chars)`);
    const out = await exec(cmd, opts.cwd, opts.cfg.timeoutMs);
    const seconds = Math.round((Date.now() - started) / 1000);
    opts.onTurn?.({ model, runner: opts.cfg.runner, seconds, code: out.code });
    if (out.code !== 0) {
      opts.log?.(`local: ${opts.cfg.runner} exited ${out.code} after ${seconds}s: ${out.stderr.trim().slice(-400)}`);
      return { status: "error", result: out.stdout || undefined, runId: `local-${started}` };
    }
    return { status: "finished", result: out.stdout, runId: `local-${started}` };
  };
}

/** Text the memoryless executor needs from the turns before it. */
export function transcriptContext(transcript: ClaudeRecord["transcript"] | undefined): string {
  if (!transcript?.length) return "";
  const label: Record<string, string> = {
    plan: "Plan (written by the planning model; follow it exactly)",
    spec: "Specification (written by the planning model)",
    implement: "Implementation report (from the previous turn)",
    iterate: "Previous iteration report",
    verify: "Previous verification report",
    finish: "Previous final verification",
    triage: "Triage",
    unblock: "Intervention notes",
    other: "Earlier turn",
  };
  const parts = transcript.slice(-3).map((t) => `### ${label[t.kind] ?? t.kind} [${t.tier}]\n${t.result.trim()}`);
  return `## Context from earlier turns of this job\n\nYou have no memory of earlier turns. Everything you need is below.\n\n${parts.join("\n\n")}\n\n---\n\n`;
}

/** Appended to a plan prompt when a local model will execute it. What the eval showed matters. */
export function executorNote(model: string): string {
  return (
    `\n\n## Executor profile\n\n` +
    `The implement and verify phases will run on a smaller local model (${model}) that has no memory of this ` +
    `conversation and cannot ask questions. Write the plan so it can be executed verbatim:\n` +
    `- For every step: the exact file path, and the exact code to add or change in a fenced block (not a description of it).\n` +
    `- Resolve every ambiguity yourself and state the decision (which log file, which flag names, which error text).\n` +
    `- List the exact verification commands and the exact expected output or exit code for each.\n` +
    `- Say explicitly what must NOT change.\n`
  );
}

function orchestratorCommit(cwd: string, message: string, log?: (l: string) => void): boolean {
  if (!git(cwd, ["status", "--porcelain"])) return false;
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=cloud-agents", "-c", "user.email=cloud-agents@localhost", "commit", "-q", "-m", message], {
    cwd,
    stdio: "ignore",
  });
  log?.(`committed working tree: ${message}`);
  return true;
}

export interface HybridHandleArgs {
  engine: "hybrid" | "local";
  repo: string;
  ref: string;
  autoCreatePR?: boolean;
  model?: string;
  agentId?: string;
  cfg?: LocalConfig;
  policy?: RoutingPolicy;
  exec?: ExecFn;
  queryFn?: ClaudeQueryFn;
  log?: (line: string) => void;
}

export async function createHybridHandle(args: HybridHandleArgs): Promise<AgentHandle> {
  const cfg = args.cfg ?? localConfigFromEnv();
  const policy = args.policy ?? policyFromEnv(args.engine);
  const log = args.log ?? ((l: string) => console.log(l));
  const usesClaude = policy.plan === "claude" || policy.implement === "claude" || policy.verify === "claude" || policy.rescue;
  if (usesClaude) assertClaudeCredential();

  const rec = openClaudeWorkspace(args);
  rec.engine = args.engine;
  rec.transcript ??= [];
  saveClaudeRecord(rec);

  const claudeSend = makeClaudeSend({
    cwd: rec.cwd,
    model: args.model,
    sessionId: rec.sessionId,
    onSession: (id) => {
      rec.sessionId = id;
      saveClaudeRecord(rec);
    },
    onCost: (usd) => {
      rec.apiEquivalentUsd += usd;
      saveClaudeRecord(rec);
    },
    onRateLimit: (u: MaxUsage) => {
      const merged = saveMaxUsage(u);
      if (merged.utilization !== undefined) log(`max: ${(merged.utilization * 100).toFixed(0)}% of ${merged.rateLimitType ?? "?"}`);
    },
    queryFn: args.queryFn,
  });

  const localSend = (model: string) =>
    makeLocalSend({
      cwd: rec.cwd,
      cfg,
      model,
      exec: args.exec,
      log,
      onTurn: (info) => {
        rec.localTurns = (rec.localTurns ?? 0) + 1;
        rec.localSeconds = (rec.localSeconds ?? 0) + info.seconds;
        saveClaudeRecord(rec);
      },
    });

  const runTier = async (tier: Tier, kind: TurnKind, prompt: string, mode: "agent" | "plan" | undefined): Promise<TurnResult> => {
    if (tier === "claude") {
      const p = kind === "plan" || kind === "spec" ? `${prompt}${executorNote(cfg.model)}` : prompt;
      return claudeSend(p, mode ? { mode } : undefined);
    }
    const model = kind === "plan" || kind === "spec" || kind === "triage" ? cfg.plannerModel : cfg.model;
    const p = `${transcriptContext(rec.transcript)}${prompt}`;
    return localSend(model)(p);
  };

  const remember = (kind: TurnKind, tier: Tier, turn: TurnResult) => {
    if (turn.status === "finished" && turn.result) {
      rec.transcript!.push({ kind, tier, result: turn.result });
      saveClaudeRecord(rec);
    }
  };

  const send: SendFn = async (prompt, o) => {
    const kind = classifyPrompt(prompt);
    const route = routeTurn(kind, policy, loadMaxUsage());
    log(`route: ${route.reason} -> ${route.tier}`);
    let turn = await runTier(route.tier, kind, prompt, o?.mode);
    remember(kind, route.tier, turn);

    const verdictKinds: TurnKind[] = ["verify", "finish"];
    if (route.tier === "local" && verdictKinds.includes(kind) && policy.rescue) {
      const report = turn.status === "finished" ? extractJsonBlock<{ done?: boolean; complete?: boolean }>(turn.result) : undefined;
      const passed = report?.done === true || report?.complete === true;
      if (!passed) {
        const rescue = routeTurn("unblock", policy, loadMaxUsage());
        if (rescue.tier === "claude") {
          orchestratorCommit(rec.cwd, "wip: local executor checkpoint before rescue", log);
          log(`rescue: local ${kind} did not pass; re-running on Claude`);
          const p = `${transcriptContext(rec.transcript)}${prompt}`;
          turn = await claudeSend(p, o?.mode ? { mode: o.mode } : undefined);
          remember(kind, "claude", turn);
        } else {
          log(`rescue skipped: ${rescue.reason}`);
        }
      }
    }
    return turn;
  };

  return {
    agentId: rec.agentId,
    send: async (prompt, opts) => {
      const turn = await send(prompt, opts);
      if (opts?.mode !== "plan") orchestratorCommit(rec.cwd, `${args.engine}: ${classifyPrompt(prompt)} turn`, log);
      if (opts?.mode === "agent" && args.autoCreatePR !== false && !rec.prUrl) {
        try {
          rec.prUrl = pushAndOpenPr(rec.cwd, `${args.engine}: ${rec.branch}`);
          saveClaudeRecord(rec);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          console.error(`${args.engine} PR open failed`, redactGitSecrets(detail));
        }
      } else if (rec.prUrl && opts?.mode !== "plan") {
        try {
          execFileSync("git", ["push", "origin", rec.branch], { cwd: rec.cwd, stdio: "ignore" });
        } catch {
          /* the verify phase pushes its own merge commit; a no-op push is fine */
        }
      }
      return { ...turn, prUrl: rec.prUrl };
    },
    getUsage: async () => ({
      totalTokens: 0,
      rawCostCents: Math.round(rec.apiEquivalentUsd * 100),
    }),
  };
}

/** One factory for every engine that owns its clone. Cursor stays with the SDK in the callers. */
export async function createEngineHandle(
  engine: Exclude<EngineName, "cursor">,
  args: Omit<HybridHandleArgs, "engine">,
): Promise<AgentHandle> {
  if (engine === "claude") return createClaudeHandle(args);
  return createHybridHandle({ ...args, engine });
}

/** Resume picks the engine the record was started with, not the current ENGINE. */
export function engineOfRecord(agentId: string, fallback: EngineName): Exclude<EngineName, "cursor"> {
  const rec = loadClaudeRecord(agentId);
  if (rec?.engine) return rec.engine;
  return fallback === "cursor" ? "claude" : fallback;
}

export function workspaceExists(agentId: string): boolean {
  const rec = loadClaudeRecord(agentId);
  return Boolean(rec && existsSync(rec.cwd));
}
