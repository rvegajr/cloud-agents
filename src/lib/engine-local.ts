import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { SendFn, SendOpts, TurnResult } from "./build-loop.js";
import {
  assertClaudeCredential,
  createClaudeHandle,
  git,
  hasCommitsAhead,
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
import { browserFromEnv, qwenMcpConfigArg, type McpStdioServer } from "../../architect-crew-gate/src/browser.js";
import {
  formatGateSummary,
  gateConfigFromEnv,
  gateFeedbackNote,
  readPackageJson,
  runQualityGate,
  type GateConfig,
  type GateResult,
} from "../../architect-crew-gate/src/quality-gate.js";
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
  /** Re-launches of one turn after the runner is cut off (qwen-code caps a turn at 100 tool calls). */
  continuations: number;
}

export function localConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LocalConfig {
  const host = (env.OLLAMA_HOST?.trim() || "http://localhost:11434").replace(/\/+$/, "");
  const model = env.LOCAL_MODEL?.trim() || "qwen3-coder-next";
  const runnerRaw = env.LOCAL_RUNNER?.trim().toLowerCase();
  const minutes = Number(env.LOCAL_TURN_TIMEOUT_MIN);
  const cont = Number(env.LOCAL_TURN_CONTINUATIONS);
  return {
    host: /^https?:\/\//.test(host) ? host : `http://${host}`,
    model,
    plannerModel: env.LOCAL_PLANNER_MODEL?.trim() || model,
    runner: runnerRaw === "aider" ? "aider" : "qwen",
    timeoutMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60_000,
    continuations: Number.isFinite(cont) && cont >= 0 ? Math.floor(cont) : 2,
  };
}

/** The runner stopped the turn, not the model: its progress is on disk and the turn can continue. */
export function wasInterrupted(out: { code: number; stderr: string; stdout: string }): boolean {
  if (out.code === 0) return false;
  if (out.code === 124 || out.code === 143) return true; // our timeout, SIGTERM
  return /Loop detection halted|turn_tool_call_cap|maximum number of tool calls/i.test(`${out.stderr}\n${out.stdout}`);
}

export function continuationNote(attempt: number, seconds: number): string {
  return (
    `## Continuation (attempt ${attempt})\n\n` +
    `Your previous attempt at this exact turn was cut off by the harness after ${seconds}s (it caps one turn at 100 tool calls). ` +
    `Nothing was lost: the working tree holds that progress. Run \`git status\` and \`git log --oneline -5\` first, do not redo ` +
    `finished work, and be economical with tool calls: batch shell commands, do not re-read files you just wrote, run the test ` +
    `suite once at the end. Finish the turn and end with the required report.\n\n---\n\n`
  );
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

/**
 * The subprocess sees the login-scrubbed env plus only what the runner needs to reach Ollama.
 * `mcpServers` (qwen-code only) are handed over on the command line for this turn: the QA
 * analyst's browser, never persisted in the checkout.
 */
export function buildLocalCommand(cfg: LocalConfig, model: string, prompt: string, extra: { mcpServers?: Record<string, McpStdioServer> } = {}): LocalCommand {
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
  const mcp = extra.mcpServers && Object.keys(extra.mcpServers).length ? ["--mcp-config", qwenMcpConfigArg(extra.mcpServers)] : [];
  return {
    file: "qwen",
    args: ["--auth-type", "openai", "--yolo", "--model", model, "--output-format", "text", ...mcp, prompt],
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
  /** The browser server a turn sent with `browser: true` gets (qwen-code only; aider has no tool use). */
  browser?: McpStdioServer;
  onTurn?: (info: LocalTurnInfo) => void;
  log?: (line: string) => void;
}): SendFn {
  const exec = opts.exec ?? defaultExec;
  const model = opts.model ?? opts.cfg.model;
  return async (prompt, o): Promise<TurnResult> => {
    const runId = `local-${Date.now()}`;
    let attempt = 0;
    let seconds = 0;
    let lastSeconds = 0;
    let p = prompt;
    const mcpServers = o?.browser && opts.browser ? { playwright: opts.browser } : undefined;
    if (o?.browser && opts.browser && opts.cfg.runner !== "aider") opts.log?.("local: playwright MCP attached to this turn");
    for (;;) {
      attempt++;
      const cmd = buildLocalCommand(opts.cfg, model, p, { mcpServers });
      const started = Date.now();
      opts.log?.(`local: ${opts.cfg.runner} ${model} (${p.length} chars${attempt > 1 ? `, continuation ${attempt - 1}` : ""})`);
      const out = await exec(cmd, opts.cwd, opts.cfg.timeoutMs);
      lastSeconds = Math.round((Date.now() - started) / 1000);
      seconds += lastSeconds;
      opts.onTurn?.({ model, runner: opts.cfg.runner, seconds: lastSeconds, code: out.code });
      if (out.code === 0) return { status: "finished", result: out.stdout, runId };
      const tail = out.stderr.trim().slice(-300);
      if (wasInterrupted(out) && attempt <= opts.cfg.continuations) {
        opts.log?.(`local: ${opts.cfg.runner} interrupted after ${lastSeconds}s (${tail.split("\n").at(-1)}); continuing`);
        p = `${continuationNote(attempt, lastSeconds)}${prompt}`;
        continue;
      }
      opts.log?.(`local: ${opts.cfg.runner} exited ${out.code} after ${seconds}s total: ${tail}`);
      return { status: "error", result: out.stdout || undefined, runId };
    }
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

const KIT_ROOT = resolve(import.meta.dirname, "..", "..");

const HYGIENE_GITIGNORE = [
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  "*.db",
  "*.sqlite",
  "*.sqlite3",
  ".env",
  ".qwen/",
  ".aider*",
  ".cursor/worktrees/",
].join("\n");

const GATE_RULES_NOTE = `
## Orchestrator quality gate

An automated gate runs after every turn in this clone. It is not this session's
report that decides a turn is done:
- The repo's own \`npm run lint|typecheck|test|build\` (whichever exist) must exit 0.
- A fresh clone (\`git clone . scratch && npm ci\`) must start the app: \`npm start\`
  answers HTTP 200, or a CLI's \`--help\` exits 0.
- \`git ls-files\` must never include \`.qwen/\`, \`.aider*\`, \`dist/\`, \`build/\`,
  \`coverage/\`, \`node_modules/\`, \`*.db\`, or \`.env\`. They are in .gitignore already.
- Do not edit SPEC.md, ROADMAP.md, REQUIREMENTS.md, QUALITY.md, DESIGN.md, TASKS.md,
  QA.md, eslint/tsconfig/test-runner config, or package.json scripts. Ask for that
  change in your report instead of making it; the gate reverts it.
- Do not edit test files. Tests define done. Fix the code they test.
Failures come back to you as feedback; fix the cause, never the check.
`;

/** New repos build-app creates have only a README. Seed the agent kit once, before any turn. */
export function seedRepoKit(cwd: string, log?: (l: string) => void): boolean {
  const files = git(cwd, ["ls-files"]).split("\n").filter(Boolean);
  const seeded = files.some((f) => f === "QWEN.md" || f === "AGENTS.md");
  if (seeded || files.length > 3) return false;

  const agentsSrc = resolve(KIT_ROOT, "target-repo-kit", "AGENTS.md");
  let agents = existsSync(agentsSrc) ? readFileSync(agentsSrc, "utf8") : "";
  agents = agents
    .split("\n")
    .filter((l) => !/Cloud Agent to Fast, Opus, or GPT|Composer 2\.5, Fast off|Resume a \`bc-\` id|COST on that AI's own meter/.test(l))
    .join("\n");
  if (agents) writeFileSync(resolve(cwd, "AGENTS.md"), agents);
  writeFileSync(resolve(cwd, "QWEN.md"), `${agents ? "@AGENTS.md\n" : ""}${GATE_RULES_NOTE}`);

  const gitignorePath = resolve(cwd, ".gitignore");
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const missing = HYGIENE_GITIGNORE.split("\n").filter((line) => !existing.includes(line));
  if (missing.length) {
    writeFileSync(gitignorePath, `${existing.trim() ? `${existing.trim()}\n` : ""}${missing.join("\n")}\n`);
  }

  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.name=cloud-agents", "-c", "user.email=cloud-agents@localhost", "commit", "-q", "-m", "chore: seed agent kit"],
    { cwd, stdio: "ignore" },
  );
  log?.("seeded AGENTS.md, QWEN.md, .gitignore");
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
  gateCfg?: GateConfig;
  exec?: ExecFn;
  /** Executes the gate's npm/git commands. Separate from `exec` (the local model harness) because the
   * gate must run for real regardless of what drives the model; defaults to `defaultExec`. */
  gateExec?: ExecFn;
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
  rec.gates ??= [];
  saveClaudeRecord(rec);
  if (seedRepoKit(rec.cwd, log)) saveClaudeRecord(rec);

  const gateCfg: GateConfig = args.gateCfg ?? gateConfigFromEnv();
  const gatedKinds: TurnKind[] = ["iterate", "finish", "unblock"];

  /** Capture the scripts baseline once package.json exists, so tamper detection has a fixed point. */
  const captureGateBaseline = (): void => {
    if (rec.gateScriptsBaseline) return;
    const pkg = readPackageJson(rec.cwd);
    if (pkg?.scripts) {
      rec.gateScriptsBaseline = pkg.scripts;
      rec.gateBaseline = git(rec.cwd, ["rev-parse", "HEAD"]);
      saveClaudeRecord(rec);
    }
  };

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

  /** The reviewer may read and run, never edit: enforced by the tool list, not by plan mode (which makes Claude Code stop and ask). */
  const claudeReviewSend = makeClaudeSend({
    cwd: rec.cwd,
    model: args.model,
    onCost: (usd) => {
      rec.apiEquivalentUsd += usd;
      saveClaudeRecord(rec);
    },
    onRateLimit: (u: MaxUsage) => {
      saveMaxUsage(u);
    },
    tools: { allowed: ["Read", "Grep", "Glob", "Bash"], disallowed: ["Edit", "Write", "NotebookEdit", "MultiEdit"] },
    queryFn: args.queryFn,
  });

  const browser = browserFromEnv();
  const localSend = (model: string, cwd: string = rec.cwd) =>
    makeLocalSend({
      cwd,
      cfg,
      model,
      exec: args.exec,
      browser,
      log,
      onTurn: (info) => {
        rec.localTurns = (rec.localTurns ?? 0) + 1;
        rec.localSeconds = (rec.localSeconds ?? 0) + info.seconds;
        saveClaudeRecord(rec);
      },
    });

  const architectKinds: TurnKind[] = ["plan", "spec", "triage", "requirements", "blueprint", "understand", "devise"];
  /** Fresh-session, read-only reviewers: ACG's review and polya-craft's look back. */
  const reviewerKinds: TurnKind[] = ["review", "look-back"];
  /** Turns that carry their whole context in the prompt; only the milestone loop replays the transcript. */
  const selfContained: TurnKind[] = ["task", "qa", "review", "understand", "devise", "carry-out", "walk", "look-back"];
  const runTier = async (tier: Tier, kind: TurnKind, prompt: string, o: SendOpts | undefined): Promise<TurnResult> => {
    if (tier === "claude") {
      if (reviewerKinds.includes(kind)) return claudeReviewSend(prompt, { ...o, fresh: true });
      const p = kind === "plan" || kind === "spec" || kind === "blueprint" || kind === "devise" ? `${prompt}${executorNote(cfg.model)}` : prompt;
      return claudeSend(p, o);
    }
    const model = architectKinds.includes(kind) || kind === "qa" || reviewerKinds.includes(kind) ? cfg.plannerModel : cfg.model;
    const replay = selfContained.includes(kind) ? "" : transcriptContext(rec.transcript);
    // A turn that asks for a browser (QA) gets Playwright MCP on qwen-code's command line for that turn only.
    return localSend(model, o?.cwd ?? rec.cwd)(`${replay}${prompt}`, o);
  };

  /**
   * Run the local turn, then the deterministic gate in its clone. A failing gate is
   * fed back as a continuation (same pattern as `wasInterrupted`), up to
   * `gateCfg.retries` times, before the turn is treated as failed. Nothing here
   * trusts the model's own report; `runQualityGate` re-runs commands.
   */
  const runLocalGated = async (kind: TurnKind, prompt: string, mode: "agent" | "plan" | undefined): Promise<TurnResult> => {
    let p = prompt;
    let turn: TurnResult = { status: "error", runId: undefined };
    for (let attempt = 0; attempt <= gateCfg.retries; attempt++) {
      turn = await runTier("local", kind, p, mode ? { mode } : undefined);
      if (turn.status !== "finished") return turn; // execution failure: let the existing rescue path handle it
      orchestratorCommit(rec.cwd, `${args.engine}: ${kind} turn (gate attempt ${attempt})`, log);
      captureGateBaseline();
      const gate = await runQualityGate(rec.cwd, gateCfg, kind === "finish" ? "finish" : "iterate", {
        scriptsBaseline: rec.gateScriptsBaseline,
        exec: args.gateExec ?? defaultExec,
        log,
      });
      rec.gates!.push({
        kind,
        attempt,
        passed: gate.passed,
        seconds: gate.seconds,
        failing: gate.findings.filter((f) => !f.ok).map((f) => f.rule),
      });
      saveClaudeRecord(rec);
      log(formatGateSummary(gate));
      if (gate.passed) return { ...turn, gate };
      if (attempt === gateCfg.retries) return { ...turn, status: "error", gate };
      p = `${gateFeedbackNote(attempt + 1, gate)}${prompt}`;
    }
    return turn;
  };

  const remember = (kind: TurnKind, tier: Tier, turn: TurnResult) => {
    if (turn.status === "finished" && turn.result) {
      rec.transcript!.push({ kind, tier, result: turn.result });
      saveClaudeRecord(rec);
    }
  };

  const send: SendFn = async (prompt, o) => {
    const kind = classifyPrompt(prompt);
    const route = o?.tier
      ? o.tier === "claude"
        ? routeTurn("unblock", { ...policy, rescue: true }, loadMaxUsage())
        : { tier: "local" as const, reason: `${kind}: forced local` }
      : routeTurn(kind, policy, loadMaxUsage());
    if (o?.tier === "claude" && route.tier === "claude") route.reason = `${kind}: forced claude`;
    log(`route: ${route.reason} -> ${route.tier}`);
    let turn =
      route.tier === "local" && gatedKinds.includes(kind)
        ? await runLocalGated(kind, prompt, o?.mode)
        : await runTier(route.tier, kind, prompt, o);
    remember(kind, route.tier, turn);

    const verdictKinds: TurnKind[] = ["verify", "finish"];
    if (route.tier === "local" && policy.rescue) {
      const report = turn.status === "finished" ? extractJsonBlock<{ done?: boolean; complete?: boolean }>(turn.result) : undefined;
      const passed = report?.done === true || report?.complete === true;
      const failedTurn = turn.status !== "finished";
      const failedVerdict = verdictKinds.includes(kind) && !passed;
      if (failedTurn || failedVerdict) {
        const rescue = routeTurn("unblock", policy, loadMaxUsage());
        if (rescue.tier === "claude") {
          orchestratorCommit(rec.cwd, "wip: local executor checkpoint before rescue", log);
          log(`rescue: local ${kind} ${failedTurn ? "did not finish" : "did not pass"}; re-running on Claude`);
          const p = `${transcriptContext(rec.transcript)}${prompt}`;
          turn = await claudeSend(p, o);
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
    workspace: rec.cwd,
    send: async (prompt, opts) => {
      const turn = await send(prompt, opts);
      if (opts?.mode !== "plan") orchestratorCommit(rec.cwd, `${args.engine}: ${classifyPrompt(prompt)} turn`, log);
      if (opts?.mode !== "plan" && args.autoCreatePR !== false && !rec.prUrl && hasCommitsAhead(rec.cwd, rec.ref)) {
        try {
          rec.prUrl = pushAndOpenPr(rec.cwd, `${args.engine}: ${rec.branch}`, rec.ref);
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
