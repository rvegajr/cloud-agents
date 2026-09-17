import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SendFn, TurnResult } from "./build-loop.js";
import type { AgentHandle } from "./slack-fix.js";
import { parseAllowlist } from "./slack-thread.js";

export type EngineName = "cursor" | "claude";

export class MaxExhausted extends Error {
  constructor(public resetsAt?: number) {
    super("Max plan usage exhausted; not buying extra usage. Resume after reset or use --engine cursor.");
    this.name = "MaxExhausted";
  }
}

export function parseEngine(raw?: string): EngineName {
  const v = (raw ?? process.env.ENGINE ?? "cursor").trim().toLowerCase();
  return v === "claude" ? "claude" : "cursor";
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

/** Subprocess env: model credential only. No Slack, GitHub, Jam, or API keys. */
export function scrubbedEnv(): Record<string, string | undefined> {
  const { PATH, HOME, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CONFIG_DIR } = process.env;
  return { PATH, HOME, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CONFIG_DIR };
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

export function makeClaudeSend(opts: {
  cwd: string;
  model?: string;
  sessionId?: string;
  onSession?: (id: string) => void;
  onCost?: (usd: number) => void;
  queryFn?: ClaudeQueryFn;
}): SendFn {
  let sessionId = opts.sessionId;
  const run = opts.queryFn ?? query;
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

function saveClaudeRecord(rec: ClaudeRecord): void {
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

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
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
  let rec: ClaudeRecord;
  if (args.agentId) {
    const loaded = loadClaudeRecord(args.agentId);
    if (!loaded) throw new Error(`No Claude workspace for ${args.agentId}. Start a new job rather than resume.`);
    rec = loaded;
    if (!existsSync(rec.cwd)) {
      rec.cwd = cloneWorkspace(rec.repo, rec.ref);
      try {
        execFileSync("git", ["fetch", "origin", rec.branch], { cwd: rec.cwd, stdio: "inherit" });
        execFileSync("git", ["checkout", rec.branch], { cwd: rec.cwd, stdio: "inherit" });
      } catch {
        execFileSync("git", ["checkout", "-b", rec.branch], { cwd: rec.cwd, stdio: "inherit" });
      }
      saveClaudeRecord(rec);
    }
  } else {
    const agentId = newClaudeAgentId();
    const cwd = cloneWorkspace(args.repo, args.ref);
    const branch = `claude/${agentId.slice(3, 11)}`;
    execFileSync("git", ["checkout", "-b", branch], { cwd, stdio: "inherit" });
    rec = {
      agentId,
      cwd,
      repo: publicGithubUrl(args.repo),
      ref: args.ref,
      branch,
      apiEquivalentUsd: 0,
    };
    saveClaudeRecord(rec);
  }

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
    queryFn: args.queryFn,
  });

  return {
    agentId: rec.agentId,
    send: async (prompt, opts) => {
      const turn = await send(prompt, opts);
      if (opts?.mode === "agent" && args.autoCreatePR !== false && !rec.prUrl) {
        const dirty = git(rec.cwd, ["status", "--porcelain"]);
        if (dirty) {
          try {
            rec.prUrl = pushAndOpenPr(rec.cwd, `claude: ${rec.branch}`);
            saveClaudeRecord(rec);
          } catch (err) {
            console.error("claude PR open failed", err);
          }
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
