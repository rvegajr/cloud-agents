import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { query, type Options, type SDKMessage, type SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";
import type { SendFn, TurnResult } from "./build-loop.js";
import type { AgentHandle } from "./slack-fix.js";
import { parseAllowlist } from "./slack-thread.js";
import { saveMaxUsage, type MaxUsage } from "./routing.js";

export type EngineName = "cursor" | "claude" | "hybrid" | "local";

export class MaxExhausted extends Error {
  constructor(public resetsAt?: number) {
    super("Max plan usage exhausted; not buying extra usage. Resume after reset or use --engine cursor.");
    this.name = "MaxExhausted";
  }
}

export function parseEngine(raw?: string): EngineName {
  const v = (raw ?? process.env.ENGINE ?? "cursor").trim().toLowerCase();
  if (v === "claude" || v === "hybrid" || v === "local") return v;
  return "cursor";
}

/** Engines whose workspace is a local clone driven by this process (not a Cursor VM). */
export function isLocalWorkspaceEngine(engine: EngineName): engine is "claude" | "hybrid" | "local" {
  return engine !== "cursor";
}

export function isClaudeAgentId(id: string | undefined): boolean {
  return Boolean(id && /^cc-[a-z0-9-]+$/i.test(id));
}

export function newClaudeAgentId(): string {
  return `cc-${randomUUID()}`;
}

/** Slack: Claude Max only for these U… ids. Empty = nobody on Slack uses Max. */
export function parseClaudeUserIds(raw?: string): string[] {
  return parseAllowlist(raw).filter((s) => /^U[A-Z0-9]+$/i.test(s));
}

export function claudeAllowedForSlackUser(user: string | undefined, allowlist: string[]): boolean {
  if (!user || allowlist.length === 0) return false;
  const id = user.trim();
  return allowlist.some((allowed) => allowed === id);
}

/**
 * Slack uses Claude only when the mentioning user is allowlisted.
 * A `cc-…` thread stays on Claude, but only that allowlist may continue it.
 * A `bc-…` thread stays on Cursor even if the mentioner is allowlisted.
 */
export function slackUsesClaude(opts: {
  user: string | undefined;
  allowlist: string[];
  existingId?: string;
}): "claude" | "cursor" | "denied" {
  const allowed = claudeAllowedForSlackUser(opts.user, opts.allowlist);
  if (opts.existingId) {
    if (isClaudeAgentId(opts.existingId)) return allowed ? "claude" : "denied";
    return "cursor";
  }
  return allowed ? "claude" : "cursor";
}

/** `claude auth status` JSON: null / missing / "none" means Max (or a login) is paying. */
export function claudeApiKeySourceFromAuth(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return "unparseable";
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return "unparseable";
    }
  }
  if (!parsed || typeof parsed !== "object") return "unparseable";
  const src = (parsed as { apiKeySource?: unknown }).apiKeySource;
  if (src == null || src === "" || src === "none") return "none";
  return String(src);
}

/** True when a shell-profile line would export ANTHROPIC_API_KEY (comments ignored). */
export function profileLineExportsAnthropicKey(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith("#")) return false;
  return /(?:^|[\s;])(?:export\s+)?ANTHROPIC_API_KEY=/.test(t);
}

/** Subprocess env: keep the login session, drop product and API secrets. */
export function scrubbedEnv(): Record<string, string | undefined> {
  const dropExact = new Set([
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "CURSOR_API_KEY",
  ]);
  const dropPrefix = /^(SLACK_|JAM_|JOBS_API_|VERCEL_|RAILWAY_)/;
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (dropExact.has(k) || dropPrefix.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export function assertClaudeCredential(): void {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is set; unset it so ENGINE=claude bills Max, not the API.");
  }
}

export function publicGithubUrl(repo: string): string {
  return repo
    .trim()
    .replace(/\.git$/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/https:\/\/[^@]+@github\.com\//i, "https://github.com/");
}

export function authenticatedCloneUrl(repo: string, token?: string): string {
  const https = publicGithubUrl(repo);
  const t = token?.trim();
  const m = https.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/i);
  if (t && m) return `https://x-access-token:${t}@github.com/${m[1]}.git`;
  return repo.trim();
}

export type ClaudeQueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;

/** The experimental `/usage` control request, when the query object offers it. */
type PlanUsageWindow = { utilization: number | null; resets_at: string | null } | null | undefined;
type UsageCapable = {
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (opts?: { skipBehaviors?: boolean }) => Promise<{
    rate_limits_available: boolean;
    rate_limits: { five_hour?: PlanUsageWindow; seven_day?: PlanUsageWindow } | null;
  }>;
};

/** Convert the `/usage` windows (0-100, ISO reset) to routing samples (0-1, epoch seconds). */
export function planUsageSamples(
  res: { rate_limits_available: boolean; rate_limits: { five_hour?: PlanUsageWindow; seven_day?: PlanUsageWindow } | null },
  observedAt = new Date().toISOString(),
): MaxUsage[] {
  if (!res.rate_limits_available || !res.rate_limits) return [];
  const out: MaxUsage[] = [];
  for (const type of ["five_hour", "seven_day"] as const) {
    const w = res.rate_limits[type];
    if (!w || typeof w.utilization !== "number") continue;
    const reset = w.resets_at ? Date.parse(w.resets_at) : NaN;
    out.push({
      status: "allowed",
      utilization: Math.min(Math.max(w.utilization, 0), 100) / 100,
      rateLimitType: type,
      resetsAt: Number.isFinite(reset) ? Math.floor(reset / 1000) : undefined,
      observedAt,
    });
  }
  return out;
}

/**
 * Routing samples from one `rate_limit_event`. The typed fields describe the
 * window that changed; `unifiedWindows` (present on current CLIs, not yet in
 * the type) carries every window's utilization as a 0-1 fraction.
 */
export function rateLimitSamples(info: SDKRateLimitInfo, observedAt = new Date().toISOString()): MaxUsage[] {
  const out: MaxUsage[] = [];
  const windows = (info as { unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number } | undefined> }).unifiedWindows;
  for (const type of ["five_hour", "seven_day"] as const) {
    const w = windows?.[type];
    if (!w || typeof w.utilization !== "number") continue;
    const u = w.utilization > 1 ? w.utilization / 100 : w.utilization;
    out.push({ status: info.status, utilization: u, rateLimitType: type, resetsAt: w.resetsAt, observedAt });
  }
  if (!out.length || info.status === "rejected") {
    out.push({
      status: info.status,
      utilization: info.status === "rejected" ? 1 : info.utilization,
      rateLimitType: info.rateLimitType,
      resetsAt: info.resetsAt,
      observedAt,
    });
  }
  return out;
}

/** Ask the live query for the plan windows; silent when the SDK or plan does not offer them. */
export async function samplePlanUsage(q: unknown, onSample: (u: MaxUsage) => void): Promise<boolean> {
  const fn = (q as UsageCapable | null)?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
  if (typeof fn !== "function") return false;
  try {
    const res = await fn.call(q, { skipBehaviors: true });
    const samples = planUsageSamples(res);
    for (const u of samples) onSample(u);
    return samples.length > 0;
  } catch {
    return false;
  }
}

export function makeClaudeSend(opts: {
  cwd: string;
  model?: string;
  sessionId?: string;
  onSession?: (id: string) => void;
  onCost?: (usd: number) => void;
  /** Every rate-limit sample the SDK reports, exhausted or not. Handles pass `saveMaxUsage` so routing can read them. */
  onRateLimit?: (usage: MaxUsage) => void;
  queryFn?: ClaudeQueryFn;
}): SendFn {
  let sessionId = opts.sessionId;
  const run = opts.queryFn ?? query;
  const onRateLimit = opts.onRateLimit ?? (() => {});
  return async (prompt, o): Promise<TurnResult> => {
    assertClaudeCredential();
    let result: string | undefined;
    let status: TurnResult["status"] = "error";
    const options: Options = {
      cwd: opts.cwd,
      resume: sessionId,
      model: opts.model ?? (process.env.CLAUDE_MODEL?.trim() || "sonnet"),
      permissionMode: o?.mode === "plan" ? "plan" : "acceptEdits",
      allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
      settingSources: ["project"],
      maxTurns: 80,
      maxBudgetUsd: 20,
      env: scrubbedEnv(),
    };
    for await (const m of run({ prompt, options })) {
      if (m.type === "system" && "subtype" in m && m.subtype === "init") {
        sessionId = m.session_id;
        opts.onSession?.(sessionId);
        if (m.apiKeySource !== "none") {
          throw new Error(`refusing to run: apiKeySource=${m.apiKeySource}; this would bill the API`);
        }
      }
      if (m.type === "rate_limit_event") {
        const info = m.rate_limit_info;
        for (const u of rateLimitSamples(info)) onRateLimit(u);
        if (info.errorCode === "credits_required" || info.status === "rejected" || info.isUsingOverage || info.overageInUse) {
          throw new MaxExhausted(info.resetsAt);
        }
      }
      if (m.type === "result") {
        status = m.subtype === "success" ? "finished" : "error";
        result = m.subtype === "success" ? m.result : undefined;
        opts.onCost?.(m.total_cost_usd);
      }
    }
    return { status, result, runId: sessionId };
  };
}

export interface ClaudeRecord {
  agentId: string;
  sessionId?: string;
  cwd: string;
  repo: string;
  ref: string;
  branch: string;
  apiEquivalentUsd: number;
  prUrl?: string;
  /** Absent on records written before the hybrid engine existed: those are plain Claude. */
  engine?: "claude" | "hybrid" | "local";
  /** Hybrid/local only: outputs of earlier turns, replayed to the memoryless local model. */
  transcript?: { kind: string; tier: "claude" | "local"; result: string }[];
  localTurns?: number;
  localSeconds?: number;
}

function recordsDir(): string {
  const dir = resolve(process.cwd(), ".runs");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function recordPath(agentId: string): string {
  return join(recordsDir(), `claude-${agentId}.json`);
}

export function loadClaudeRecord(agentId: string): ClaudeRecord | undefined {
  const path = recordPath(agentId);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as ClaudeRecord;
}

export function saveClaudeRecord(rec: ClaudeRecord): void {
  writeFileSync(recordPath(rec.agentId), `${JSON.stringify(rec, null, 2)}\n`);
}

export function redactGitSecrets(text: string): string {
  return text
    .replace(/x-access-token:[^@\s]+@/gi, "x-access-token:<redacted>@")
    .replace(/\bgho_[A-Za-z0-9_]+/g, "gho_<redacted>")
    .replace(/\bghp_[A-Za-z0-9_]+/g, "ghp_<redacted>")
    .replace(/\bghu_[A-Za-z0-9_]+/g, "ghu_<redacted>");
}

export function cloneWorkspace(repo: string, ref: string, root = process.env.WORK_ROOT?.trim() || join(tmpdir(), "cloud-agents-work")): string {
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "build-"));
  const token = process.env.GITHUB_TOKEN?.trim();
  try {
    execFileSync("git", ["clone", "--branch", ref, "--depth", "50", authenticatedCloneUrl(repo, token), dir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const detail = err instanceof Error ? redactGitSecrets(err.message) : "git clone failed";
    throw new Error(`git clone failed for ${publicGithubUrl(repo)}@${ref}: ${detail}`);
  }
  execFileSync("git", ["remote", "set-url", "origin", publicGithubUrl(repo)], { cwd: dir, stdio: "inherit" });
  return dir;
}

export function pushAndOpenPr(cwd: string, title: string): string {
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" }).trim();
  execFileSync("git", ["push", "-u", "origin", branch], { cwd, stdio: "inherit", env: process.env });
  const out = execFileSync("gh", ["pr", "create", "--draft", "--fill", "--title", title], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  const url = out.trim().split(/\s+/).find((s) => s.startsWith("http")) ?? out.trim();
  return url;
}

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Open (or re-open on a fresh box) the clone behind a cc- record. Shared by the Claude and hybrid engines. */
export function openClaudeWorkspace(args: { repo: string; ref: string; agentId?: string }): ClaudeRecord {
  if (args.agentId) {
    const loaded = loadClaudeRecord(args.agentId);
    if (!loaded) throw new Error(`No Claude workspace for ${args.agentId}. Start a new job rather than resume.`);
    if (!existsSync(loaded.cwd)) {
      loaded.cwd = cloneWorkspace(loaded.repo, loaded.ref);
      try {
        execFileSync("git", ["fetch", "origin", loaded.branch], { cwd: loaded.cwd, stdio: "inherit" });
        execFileSync("git", ["checkout", loaded.branch], { cwd: loaded.cwd, stdio: "inherit" });
      } catch {
        execFileSync("git", ["checkout", "-b", loaded.branch], { cwd: loaded.cwd, stdio: "inherit" });
      }
      saveClaudeRecord(loaded);
    }
    return loaded;
  }
  const agentId = newClaudeAgentId();
  const cwd = cloneWorkspace(args.repo, args.ref);
  const branch = `claude/${agentId.slice(3, 11)}`;
  execFileSync("git", ["checkout", "-b", branch], { cwd, stdio: "inherit" });
  const rec: ClaudeRecord = { agentId, cwd, repo: publicGithubUrl(args.repo), ref: args.ref, branch, apiEquivalentUsd: 0 };
  saveClaudeRecord(rec);
  return rec;
}

export async function createClaudeHandle(args: {
  repo: string;
  ref: string;
  autoCreatePR?: boolean;
  model?: string;
  agentId?: string;
  queryFn?: ClaudeQueryFn;
}): Promise<AgentHandle> {
  assertClaudeCredential();
  const rec = openClaudeWorkspace(args);

  const send = makeClaudeSend({
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
    onRateLimit: (u) => {
      saveMaxUsage(u);
    },
    queryFn: args.queryFn,
  });

  return {
    agentId: rec.agentId,
    send: async (prompt, opts) => {
      const turn = await send(prompt, opts);
      if (opts?.mode === "agent" && args.autoCreatePR !== false && !rec.prUrl) {
        try {
          rec.prUrl = pushAndOpenPr(rec.cwd, `claude: ${rec.branch}`);
          saveClaudeRecord(rec);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          console.error("claude PR open failed", redactGitSecrets(detail));
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

/** Tests only: drop a temp clone. */
export function removeWorkspace(cwd: string): void {
  if (cwd.startsWith(tmpdir()) || cwd.startsWith(join(homedir(), "tmp"))) {
    rmSync(cwd, { recursive: true, force: true });
  }
}
