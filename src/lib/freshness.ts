/**
 * Is the latest version actually deployed?
 *
 * "Up" and "current" are different questions, and a status page only answers
 * the first. Answering the second needs three facts: the commit a service is
 * running, the commit it ought to be running, and enough patience to let a
 * fresh merge finish rolling out before calling it stale.
 *
 *   running   GET /health on the service, per the contract in target-repo-kit
 *   expected  the branch tip, from `gh api` — no clone, one call
 *   patience  graceSeconds, so a merge in flight reads `deploying`, not `stale`
 *
 * The IO lives at the bottom behind `checkFleet`; everything above it is pure
 * so the verdicts can be tested without a network.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_GRACE_SECONDS = 900;

export interface ServiceExpectation {
  /** The ref a healthy deploy should be sitting on. */
  branch: string;
}

export interface Service {
  name: string;
  env: string;
  health: string;
  repo: string;
  expect: ServiceExpectation;
  /** Seconds a fresh merge may take to roll out before it counts as stale. */
  graceSeconds?: number;
  /** Why this service cannot answer yet. Shown on an `unknown` row. */
  note?: string;
}

export interface Registry {
  services: Service[];
  graceSeconds: number;
}

/**
 * `current`     running the expected commit
 * `deploying`   behind, but the expected commit landed inside the grace window
 * `stale`       behind, and has had long enough to catch up
 * `unknown`     answered, but does not say which commit it is running
 * `unreachable` did not answer
 */
export type Verdict = "current" | "deploying" | "stale" | "unknown" | "unreachable";

export interface Row {
  service: Service;
  deployed?: string;
  expected?: string;
  /** When the expected commit was committed, ISO 8601. */
  expectedAt?: string;
  /** How many commits the deploy is behind, filled in only when it matters. */
  behind?: number;
  verdict: Verdict;
  detail?: string;
}

export function registryPath(): string {
  return join(ROOT, "services.json");
}

export function parseRegistry(raw: string): Registry {
  const parsed = JSON.parse(raw) as {
    defaults?: { graceSeconds?: number };
    services?: Service[];
  };
  const services = parsed.services ?? [];
  for (const s of services) {
    if (!s.name || !s.env || !s.health || !s.repo || !s.expect?.branch) {
      throw new Error(`services.json: every service needs name, env, health, repo and expect.branch (got ${JSON.stringify(s)})`);
    }
  }
  return { services, graceSeconds: parsed.defaults?.graceSeconds ?? DEFAULT_GRACE_SECONDS };
}

export function loadRegistry(path = registryPath()): Registry {
  return parseRegistry(readFileSync(path, "utf8"));
}

/** The field names a health endpoint might use, in the order we trust them. */
const COMMIT_KEYS = ["commit", "commitSha", "commit_sha", "sha", "gitCommit", "git_commit", "revision", "buildCommit"];

/**
 * Pull the commit out of whatever shape a service calls its health payload.
 *
 * Explicit fields win, then the same fields one level down under `git` or
 * `build` (Flight Deck reports `git.commit`). Failing that, we read a formatted version string —
 * this kit's own bot reports `v0.2.0 (abc123def456 on main)` — but only accept
 * a hex run that contains a letter, so a build number like `1234567` is not
 * mistaken for a short sha.
 */
export function commitFromHealth(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const obj = payload as Record<string, unknown>;
  const explicit = (o: Record<string, unknown>): string | undefined => {
    for (const key of COMMIT_KEYS) {
      const v = o[key];
      if (typeof v === "string" && /^[0-9a-f]{7,40}$/i.test(v.trim())) return v.trim().toLowerCase();
    }
    return undefined;
  };
  const top = explicit(obj);
  if (top) return top;
  for (const key of ["git", "build", "buildInfo", "version"]) {
    const v = obj[key];
    const nested = v && typeof v === "object" && !Array.isArray(v) ? explicit(v as Record<string, unknown>) : undefined;
    if (nested) return nested;
  }
  for (const key of ["version", "build", "buildInfo"]) {
    const v = obj[key];
    if (typeof v !== "string") continue;
    const m = v.match(/\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*[a-f][0-9a-f]*\b/i);
    if (m) return m[0].toLowerCase();
  }
  return undefined;
}

/** Short and long spellings of the same commit are the same commit. */
export function sameCommit(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const n = Math.min(x.length, y.length);
  if (n < 7) return false;
  return x.slice(0, n) === y.slice(0, n);
}

export function verdictFor(input: {
  reachable: boolean;
  deployed?: string;
  expected?: string;
  expectedAt?: string;
  graceSeconds: number;
  now?: Date;
}): Verdict {
  if (!input.reachable) return "unreachable";
  if (!input.deployed || !input.expected) return "unknown";
  if (sameCommit(input.deployed, input.expected)) return "current";
  const at = input.expectedAt ? Date.parse(input.expectedAt) : NaN;
  if (Number.isFinite(at)) {
    const ageSeconds = ((input.now ?? new Date()).getTime() - at) / 1000;
    if (ageSeconds >= 0 && ageSeconds < input.graceSeconds) return "deploying";
  }
  return "stale";
}

/** `stale` and `unreachable` are failures. `unknown` is only one under --strict. */
export function exitCodeFor(rows: Row[], strict = false): number {
  const bad = rows.some((r) => r.verdict === "stale" || r.verdict === "unreachable");
  if (bad) return 1;
  if (strict && rows.some((r) => r.verdict === "unknown")) return 1;
  return 0;
}

function short(sha?: string): string {
  return sha ? sha.slice(0, 8) : "—";
}

export function formatVersionBoard(rows: Row[], now = new Date()): string {
  if (!rows.length) return "Version board: no services registered. Add them to services.json.";
  const header = ["SERVICE", "ENV", "DEPLOYED", "EXPECTED", "VERDICT", "DETAIL"];
  const body = rows.map((r) => [
    r.service.name,
    r.service.env,
    short(r.deployed),
    short(r.expected),
    r.verdict,
    r.detail ?? "",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const line = (cells: string[]) =>
    "  " + cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join("  ").trimEnd();

  const counts = new Map<Verdict, number>();
  for (const r of rows) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
  const order: Verdict[] = ["current", "deploying", "stale", "unknown", "unreachable"];
  const tally = order.filter((v) => counts.has(v)).map((v) => `${counts.get(v)} ${v}`).join(" · ");

  const lines = [
    `Version board  ${now.toISOString()}`,
    "",
    "Deployed is what /health says it is running. Expected is the branch tip.",
    "",
    line(header),
    ...body.map(line),
    "",
    tally,
  ];

  const stale = rows.filter((r) => r.verdict === "stale");
  if (stale.length) {
    lines.push("", "Stale:");
    for (const r of stale) {
      const behind = r.behind === undefined ? "behind" : `${r.behind} commit${r.behind === 1 ? "" : "s"} behind`;
      lines.push(`  ${r.service.name}/${r.service.env} is ${behind} ${r.service.expect.branch}. ${r.service.health}`);
    }
  }
  const unknown = rows.filter((r) => r.verdict === "unknown");
  if (unknown.length) {
    lines.push("", "Cannot answer yet (no commit in /health):");
    for (const r of unknown) {
      lines.push(`  ${r.service.name}/${r.service.env}${r.service.note ? ` — ${r.service.note}` : ""}`);
    }
  }
  const unreachable = rows.filter((r) => r.verdict === "unreachable");
  if (unreachable.length) {
    lines.push("", "Unreachable:");
    for (const r of unreachable) lines.push(`  ${r.service.name}/${r.service.env} — ${r.detail ?? r.service.health}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- IO below --

export interface HealthResult {
  reachable: boolean;
  payload?: unknown;
  error?: string;
}

export async function fetchHealth(url: string, timeoutMs = 10_000): Promise<HealthResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    const text = await res.text();
    try {
      return { reachable: true, payload: JSON.parse(text) };
    } catch {
      return { reachable: true, payload: { version: text.trim().slice(0, 200) } };
    }
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message.replace(/^.*abort.*$/i, "timed out") : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function gh(args: string[]): string | undefined {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export interface Tip {
  sha?: string;
  committedAt?: string;
}

/** The branch tip from GitHub. No clone, one call, works for private repos via `gh auth`. */
export function branchTip(repo: string, branch: string): Tip {
  const raw = gh(["api", `repos/${repo}/branches/${branch}`, "--jq", "[.commit.sha, .commit.commit.committer.date] | @tsv"]);
  if (!raw) return {};
  const [sha, committedAt] = raw.split("\t");
  return { sha: sha?.trim(), committedAt: committedAt?.trim() || undefined };
}

/** How far behind a deploy is. Only worth asking once a row is already stale. */
export function commitsBehind(repo: string, deployed: string, expected: string): number | undefined {
  const raw = gh(["api", `repos/${repo}/compare/${deployed}...${expected}`, "--jq", ".ahead_by"]);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export async function checkFleet(registry: Registry, now = new Date()): Promise<Row[]> {
  return await Promise.all(
    registry.services.map(async (service): Promise<Row> => {
      const graceSeconds = service.graceSeconds ?? registry.graceSeconds;
      const [health, tip] = await Promise.all([
        fetchHealth(service.health),
        Promise.resolve(branchTip(service.repo, service.expect.branch)),
      ]);
      const deployed = health.reachable ? commitFromHealth(health.payload) : undefined;
      const verdict = verdictFor({
        reachable: health.reachable,
        deployed,
        expected: tip.sha,
        expectedAt: tip.committedAt,
        graceSeconds,
        now,
      });
      const row: Row = { service, deployed, expected: tip.sha, expectedAt: tip.committedAt, verdict };
      if (verdict === "unreachable") row.detail = health.error;
      if (verdict === "deploying") row.detail = `${service.expect.branch} moved under ${Math.round(graceSeconds / 60)}m ago`;
      if (verdict === "unknown" && !tip.sha) row.detail = `no tip for ${service.expect.branch} (gh auth?)`;
      if (verdict === "stale" && deployed && tip.sha) {
        row.behind = commitsBehind(service.repo, deployed, tip.sha);
        if (row.behind !== undefined) row.detail = `${row.behind} behind ${service.expect.branch}`;
      }
      return row;
    }),
  );
}
