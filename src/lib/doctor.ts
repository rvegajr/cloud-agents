/**
 * Pure logic behind `npm run doctor` (src/08-doctor.ts): the verdict model, the
 * scope diffing, and the shape checks for every credential the kit reads.
 *
 * Nothing here does IO. The CLI does the fetching and hands the answers to
 * these functions, so the rules that decide "is this credential right" are
 * testable without a network or a token.
 *
 * Phases match IMPLEMENTATION-GUIDE.md: A bootstrap, B target repo, C Slack app,
 * D local run, E hosting, F deploy notifications, G Jam + ready-for-review.
 */

export const PHASES = ["A", "B", "C", "D", "E", "F", "G"] as const;
export type Phase = (typeof PHASES)[number];

/** fail blocks the phase; warn is a decision for the human; skip means "not configured". */
export type Verdict = "pass" | "warn" | "fail" | "skip";

export interface Check {
  phase: Phase;
  group: string;
  name: string;
  verdict: Verdict;
  detail: string;
  /** One line the reader can act on. Omitted when there is nothing to fix. */
  fix?: string;
}

export interface Summary {
  pass: number;
  warn: number;
  fail: number;
  skip: number;
  /** Non-zero when anything failed, so CI and agents can branch on it. */
  exitCode: number;
}

export function summarize(checks: Check[]): Summary {
  const s: Summary = { pass: 0, warn: 0, fail: 0, skip: 0, exitCode: 0 };
  for (const c of checks) s[c.verdict] += 1;
  s.exitCode = s.fail > 0 ? 1 : 0;
  return s;
}

/** `--phase A`, `--phase a,c`, `--phase A-D`; empty means every phase. */
export function parsePhaseFilter(raw: string | undefined): Set<Phase> {
  const all = new Set<Phase>(PHASES);
  if (!raw || raw.trim() === "" || raw.trim() === "true") return all;
  const wanted = new Set<Phase>();
  for (const part of raw.toUpperCase().split(/[,\s]+/).filter(Boolean)) {
    const range = part.match(/^([A-G])-([A-G])$/);
    if (range) {
      const from = PHASES.indexOf(range[1] as Phase);
      const to = PHASES.indexOf(range[2] as Phase);
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) wanted.add(PHASES[i]!);
      continue;
    }
    if ((PHASES as readonly string[]).includes(part)) wanted.add(part as Phase);
  }
  return wanted.size ? wanted : all;
}

// ---------------------------------------------------------------------------
// Repo identity

/**
 * Compare repo URLs the way a human would: `git@github.com:o/r.git`,
 * `https://github.com/o/r/`, and `https://github.com/O/R` are one repo.
 * Cursor's connected-repo list and `.env` rarely agree on the spelling.
 */
export function normalizeRepoUrl(url: string): string {
  let s = url.trim().toLowerCase();
  s = s.replace(/^git\+/, "");
  s = s.replace(/^(?:ssh|git|https?):\/\//, "");
  // scp-style `git@host:owner/repo` and any surviving `user@host` prefix
  s = s.replace(/^([^/@]+)@/, "");
  s = s.replace(/^([^/:]+):/, "$1/");
  s = s.replace(/\.git$/, "");
  s = s.replace(/\/+$/, "");
  return s;
}

export interface RepoRef {
  repo: string;
  ref: string;
  /** Where the value came from, so a failure names the variable to edit. */
  source: string;
}

/** Every repo the bot could target: TARGET_REPO, SLACK_PROJECTS, SLACK_CHANNEL_REPOS. */
export function collectRepoRefs(opts: {
  targetRepo?: string;
  targetRef: string;
  projects: Map<string, { repo: string; ref: string }>;
  routes: Map<string, { repo: string; ref: string }>;
}): RepoRef[] {
  const out: RepoRef[] = [];
  const seen = new Set<string>();
  const add = (repo: string, ref: string, source: string) => {
    const key = `${normalizeRepoUrl(repo)}@${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ repo, ref, source });
  };
  if (opts.targetRepo?.trim()) add(opts.targetRepo.trim(), opts.targetRef, "TARGET_REPO");
  for (const [name, p] of opts.projects) add(p.repo, p.ref, `SLACK_PROJECTS ${name}`);
  for (const [channel, r] of opts.routes) add(r.repo, r.ref, `SLACK_CHANNEL_REPOS ${channel}`);
  return out;
}

// ---------------------------------------------------------------------------
// Slack scopes

export interface ScopeDiff {
  granted: string[];
  missing: string[];
  /** Granted but not in the manifest. Harmless; listed so a reader can trim. */
  extra: string[];
}

/** Bot scopes the manifest asks for — the list the install must actually grant. */
export function manifestBotScopes(manifest: unknown): string[] {
  const scopes = (manifest as { oauth_config?: { scopes?: { bot?: unknown } } })?.oauth_config?.scopes?.bot;
  if (!Array.isArray(scopes)) return [];
  return scopes.filter((s): s is string => typeof s === "string");
}

/** Slack returns granted scopes in the `x-oauth-scopes` response header. */
export function diffScopes(grantedHeader: string | undefined | null, required: string[]): ScopeDiff {
  const granted = (grantedHeader ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const have = new Set(granted);
  const want = new Set(required);
  return {
    granted,
    missing: required.filter((s) => !have.has(s)),
    extra: granted.filter((s) => !want.has(s)),
  };
}

/** Which of the manifest scopes the bot cannot do without, whatever else is trimmed. */
export const CRITICAL_BOT_SCOPES = ["app_mentions:read", "chat:write"] as const;

export function slackTokenKind(token: string | undefined): "bot" | "user" | "app" | "unknown" {
  const t = token?.trim() ?? "";
  if (t.startsWith("xoxb-")) return "bot";
  if (t.startsWith("xoxp-")) return "user";
  if (t.startsWith("xapp-")) return "app";
  return "unknown";
}

// ---------------------------------------------------------------------------
// GitHub tokens

export type GitHubTokenKind = "classic" | "fine-grained" | "app-installation" | "unknown";

/**
 * `markPullRequestReadyForReview` only accepts user-level OAuth tokens. The
 * prefix tells us the kind before we spend a request finding out the hard way;
 * see the header comment in github.ts.
 */
export function classifyGitHubToken(token: string | undefined): GitHubTokenKind {
  const t = token?.trim() ?? "";
  if (t.startsWith("ghp_")) return "classic";
  if (t.startsWith("github_pat_")) return "fine-grained";
  if (t.startsWith("ghs_") || t.startsWith("ghu_")) return "app-installation";
  // Pre-2021 classic PATs are a bare 40-char hex string.
  if (/^[0-9a-f]{40}$/i.test(t)) return "classic";
  return "unknown";
}

/** Classic PATs report their scopes in `x-oauth-scopes`; `repo` covers the mutation. */
export function hasRepoScope(scopeHeader: string | undefined | null): boolean {
  const scopes = (scopeHeader ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return scopes.includes("repo");
}

// ---------------------------------------------------------------------------
// Slack ids

/** Slack member ids: `U…` / `W…`, with a `<@…>` wrapper stripped. */
export function isSlackUserId(value: string): boolean {
  return /^[UW][A-Z0-9]{6,}$/i.test(value.replace(/^<@|>$/g, ""));
}

export function isSlackChannelId(value: string): boolean {
  return /^[CGD][A-Z0-9]{6,}$/i.test(value.trim());
}

// ---------------------------------------------------------------------------
// Output

const MARK: Record<Verdict, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" };

export function formatCheck(c: Check): string {
  const head = `  ${MARK[c.verdict]}  ${c.name}`;
  const detail = c.detail ? `: ${c.detail}` : "";
  const fix = c.verdict === "pass" || c.verdict === "skip" || !c.fix ? "" : `\n        → ${c.fix}`;
  return `${head}${detail}${fix}`;
}

export function formatReport(checks: Check[]): string {
  const lines: string[] = [];
  let group = "";
  for (const c of checks) {
    if (c.group !== group) {
      group = c.group;
      lines.push(`\n[${group}]`);
    }
    lines.push(formatCheck(c));
  }
  const s = summarize(checks);
  lines.push(`\n${s.pass} pass, ${s.warn} warn, ${s.fail} fail, ${s.skip} skip`);
  if (s.fail) lines.push("Fix the FAILs before moving to the next phase (IMPLEMENTATION-GUIDE.md).");
  return lines.join("\n");
}
