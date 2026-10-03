import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * The judgment rule: a decision model (System One API, `POST …/v1/systemone`) reads
 * each changed file's diff and answers literal yes/no questions about defects no
 * deterministic rule can see, the ones the blind review kept finding in local
 * builds: a test that asserts nothing, a check bent instead of code fixed, a DB
 * opened at import time, an error swallowed, a placeholder left in, a literal key.
 *
 * Providers speak the same API, so one client serves them all:
 *   DECIDER=jev    TypeSafe Jev   (TYPESAFE_API_KEY), billed per input token
 *   DECIDER=d1     Liquid d1      (LIQUID_API_KEY), d1:free
 *   DECIDER=local  any /v1/systemone server (DECIDER_URL, DECIDER_MODEL), e.g. Ollama ≥ 0.35
 *   DECIDER=off    (default) the rule does not run
 *
 * The model never writes code and never sees a prompt; it only flags. A flag
 * becomes a gate finding, which the loop already feeds back to the crew.
 */

export type DeciderProvider = "off" | "jev" | "d1" | "local";

export interface DeciderConfig {
  provider: DeciderProvider;
  url: string;
  model: string;
  /** Read from the environment the run was given; never logged. */
  apiKey?: string;
  /** Probability at or above which a question flags the file. */
  threshold: number;
  /** Per-file diff budget; Jev allows 32k tokens for state plus the longest question. */
  maxStateChars: number;
  /** USD cents per million input tokens, for the provider's own meter. */
  centsPerMTok: number;
  /** Ledger meter id, e.g. `typesafe:billed`. Empty for a meter with no card charge. */
  meter: string;
  timeoutMs: number;
  /** JSONL of every decision, for calibration against outcomes. */
  logFile: string;
  /** Extra tries on 429 and 5xx, with backoff (d1:free rate-limits a burst). */
  retries: number;
  /** Parallel requests; one file per request. */
  concurrency: number;
  /** Why the rule cannot run as configured (missing key or model); the gate reports it and passes. */
  problem?: string;
}

const PROVIDERS: Record<Exclude<DeciderProvider, "off">, { url: string; model: string; keyVar?: string; centsPerMTok: number; meter: string }> = {
  jev: { url: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", keyVar: "TYPESAFE_API_KEY", centsPerMTok: 4.2, meter: "typesafe:billed" },
  d1: { url: "https://api.liquid.ai/decisions/v1/systemone", model: "d1:free", keyVar: "LIQUID_API_KEY", centsPerMTok: 0, meter: "liquid:billed" },
  local: { url: "http://localhost:11434/v1/systemone", model: "", centsPerMTok: 0, meter: "" },
};

export function deciderConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DeciderConfig {
  const raw = env.DECIDER?.trim().toLowerCase() ?? "";
  const provider: DeciderProvider = raw === "jev" || raw === "d1" || raw === "local" ? raw : "off";
  const num = (name: string, fallback: number): number => {
    const n = Number(env[name]);
    return env[name]?.trim() && Number.isFinite(n) ? n : fallback;
  };
  const base = {
    threshold: Math.min(1, Math.max(0, num("DECIDER_THRESHOLD", 0.9))),
    maxStateChars: Math.max(1000, Math.floor(num("DECIDER_MAX_CHARS", 60_000))),
    timeoutMs: Math.max(1000, Math.floor(num("DECIDER_TIMEOUT_SEC", 30) * 1000)),
    logFile: env.DECIDER_LOG?.trim() || resolve(process.cwd(), ".runs", "decider.jsonl"),
    retries: Math.max(0, Math.floor(num("DECIDER_RETRIES", 4))),
  };
  const concurrency = Math.max(1, Math.floor(num("DECIDER_CONCURRENCY", provider === "d1" ? 2 : 4)));
  if (provider === "off") return { provider, url: "", model: "", centsPerMTok: 0, meter: "", concurrency, ...base };
  const p = PROVIDERS[provider];
  const apiKey = p.keyVar ? env[p.keyVar]?.trim() || undefined : undefined;
  const model = env.DECIDER_MODEL?.trim() || p.model;
  const cfg: DeciderConfig = { provider, url: env.DECIDER_URL?.trim() || p.url, model, apiKey, centsPerMTok: p.centsPerMTok, meter: p.meter, concurrency, ...base };
  if (p.keyVar && !apiKey) cfg.problem = `${p.keyVar} is not set (add it to the vault and the run's environment)`;
  else if (!model) cfg.problem = "DECIDER_MODEL is not set (name the decision model the local server should use)";
  return cfg;
}

// ---------------------------------------------------------------------------
// Questions. Jev reads literally: each states the exact condition, one way.
// ---------------------------------------------------------------------------

export interface JudgmentQuestion {
  id: string;
  /** Which files the question is asked about. */
  scope: "test" | "source" | "any";
  instructions: string;
  /** What the crew is told when the question flags a file. */
  feedback: string;
}

export const JUDGMENT_QUESTIONS: JudgmentQuestion[] = [
  {
    id: "test-skips-code",
    scope: "test",
    instructions:
      "At least one test added or changed in this diff never calls the project's own code. Instead it defines its own stand-in inside the test (its own server, function, or object) and checks that, so the test would still pass if the project's source files were deleted.",
    feedback: "a test checks a stand-in it defines itself, not the project's code; import the real module and test that",
  },
  {
    id: "vacuous-test",
    scope: "test",
    instructions:
      "At least one test added or changed in this diff has no assertion that compares the code's output or behavior with an expected value. Its only checks are that something exists, that a call does not throw, or that true is true.",
    feedback: "a test asserts nothing about behavior; make it compare real output with an expected value",
  },
  {
    id: "weakened-check",
    scope: "any",
    instructions:
      "This diff silences or loosens a check instead of fixing the code: it adds an eslint-disable, @ts-ignore, @ts-expect-error or noqa comment, turns off or relaxes a lint or compiler rule, marks a test as skipped or todo, or removes or weakens an existing assertion.",
    feedback: "a check was silenced or loosened instead of the code being fixed; fix the cause and restore the check",
  },
  {
    id: "import-side-effect",
    scope: "source",
    instructions:
      "This diff adds code at the top level of a module, outside any function or class, that opens a database, network connection or file handle, or starts a server or timer, so it runs as soon as the module is imported.",
    feedback: "a module opens a resource or starts work at import time; move it behind a function the caller invokes",
  },
  {
    id: "swallowed-error",
    scope: "source",
    instructions:
      "This diff adds a catch block or error handler that discards the error: it is empty, or it only logs, or it returns a default value, so the caller cannot tell that the operation failed.",
    feedback: "an error is caught and discarded; let it propagate or return a failure the caller can see",
  },
  {
    id: "placeholder",
    scope: "source",
    instructions:
      "This diff adds placeholder code in place of a real implementation: a TODO or FIXME standing in for logic, a function that throws 'not implemented', or a hardcoded return value standing in for a computation.",
    feedback: "placeholder code stands in for the real implementation; implement it",
  },
  {
    id: "hardcoded-secret",
    scope: "any",
    instructions:
      "This diff adds a literal credential written directly in code or config: an API key, access token, password, or private key, rather than a value read from the environment.",
    feedback: "a literal credential is committed; read it from the environment and remove it from the diff",
  },
];

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/;
/** Lockfiles, generated output, docs, and binaries: nothing for the questions to judge. */
const SKIP_PATH = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|poetry\.lock|Cargo\.lock|go\.sum)$|(^|\/)(dist|build|coverage|node_modules|\.next)\/|\.(min\.js|map|snap|md|png|jpe?g|gif|svg|ico|pdf|woff2?)$/;

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path);
}

/**
 * Questions that do not apply to the app's entry points: starting the server at the top level
 * is what `npm start`'s file is for.
 */
const NOT_FOR_ENTRY = new Set(["import-side-effect"]);

export function questionsFor(
  path: string,
  questions: JudgmentQuestion[] = JUDGMENT_QUESTIONS,
  entryStems: ReadonlySet<string> = new Set(),
): JudgmentQuestion[] {
  if (SKIP_PATH.test(path)) return [];
  const test = isTestPath(path);
  const entry = entryStems.has(stem(path));
  return questions.filter((q) => (q.scope === "any" || (q.scope === "test") === test) && !(entry && NOT_FOR_ENTRY.has(q.id)));
}

/** `src/server.ts` and `dist/server.js` are the same entry: compare basenames without extension. */
function stem(path: string): string {
  return (path.split("/").at(-1) ?? path).replace(/\.[cm]?[jt]sx?$|\.py$/, "");
}

/** Basenames of the files package.json starts: `main`, `bin`, and what `start`/`dev` run. */
export function entryStemsOf(pkg: { main?: string; bin?: string | Record<string, string>; scripts?: Record<string, string> } | undefined): Set<string> {
  const files: string[] = [];
  if (pkg?.main) files.push(pkg.main);
  if (typeof pkg?.bin === "string") files.push(pkg.bin);
  else if (pkg?.bin) files.push(...Object.values(pkg.bin));
  for (const name of ["start", "dev", "serve"]) {
    const script = pkg?.scripts?.[name];
    if (!script) continue;
    for (const m of script.matchAll(/(?:^|\s)([\w./-]+\.[cm]?[jt]sx?)(?=\s|$)/g)) files.push(m[1]!);
  }
  return new Set(files.map(stem));
}

export interface FileDiff {
  path: string;
  diff: string;
}

/** Split a unified `git diff` into one entry per file; deleted files have nothing to judge. */
export function splitDiff(unified: string): FileDiff[] {
  const out: FileDiff[] = [];
  for (const chunk of unified.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    if (/^deleted file mode /m.test(chunk) || /^Binary files /m.test(chunk)) continue;
    const path = chunk.match(/^\+\+\+ b\/(.+)$/m)?.[1] ?? chunk.match(/^diff --git a\/.+ b\/(.+)$/m)?.[1];
    if (path && path !== "/dev/null") out.push({ path: path.trim(), diff: chunk });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------

export interface SystemOneResponse {
  model: string;
  nouls: Record<string, number>;
  inputTokens: number;
}

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export type SleepFn = (ms: number) => Promise<void>;
const sleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

export async function systemOne(
  cfg: DeciderConfig,
  state: unknown,
  questions: Record<string, string>,
  fetchFn: FetchFn = fetch as unknown as FetchFn,
  sleepFn: SleepFn = sleep,
): Promise<SystemOneResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const body = JSON.stringify({
    model: cfg.model,
    state,
    questions: Object.fromEntries(Object.entries(questions).map(([id, instructions]) => [id, { type: "noul", instructions }])),
  });
  let res = await fetchFn(cfg.url, { method: "POST", headers, body, signal: AbortSignal.timeout(cfg.timeoutMs) });
  for (let tryNo = 1; tryNo <= cfg.retries && (res.status === 429 || res.status >= 500); tryNo++) {
    const after = Number(res.headers?.get("retry-after"));
    await sleepFn(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 1000 * 2 ** (tryNo - 1));
    res = await fetchFn(cfg.url, { method: "POST", headers, body, signal: AbortSignal.timeout(cfg.timeoutMs) });
  }
  if (!res.ok) {
    // The body of an error never carries the key, but keep it short: it lands in logs.
    const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`${cfg.provider} ${res.status}${text ? `: ${text}` : ""}`);
  }
  const raw = (await res.json()) as { model?: string; answers?: Record<string, { noul?: number }>; usage?: { input_tokens?: number } };
  const nouls: Record<string, number> = {};
  for (const id of Object.keys(questions)) {
    const v = raw.answers?.[id]?.noul;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${cfg.provider}: no noul for ${id}`);
    nouls[id] = v;
  }
  return { model: raw.model ?? cfg.model, nouls, inputTokens: raw.usage?.input_tokens ?? 0 };
}

// ---------------------------------------------------------------------------
// Judging a diff
// ---------------------------------------------------------------------------

export interface Decision {
  file: string;
  question: string;
  p: number;
  flagged: boolean;
}

export interface Judgment {
  decisions: Decision[];
  /** Files over the budget were judged on their first `maxStateChars` characters. */
  truncated: string[];
  errors: string[];
  model?: string;
  inputTokens: number;
  cents: number;
  calls: number;
}

export async function judgeDiff(
  unified: string,
  cfg: DeciderConfig,
  deps: { fetchFn?: FetchFn; sleepFn?: SleepFn; concurrency?: number; questions?: JudgmentQuestion[]; entryStems?: ReadonlySet<string> } = {},
): Promise<Judgment> {
  const out: Judgment = { decisions: [], truncated: [], errors: [], inputTokens: 0, cents: 0, calls: 0 };
  const work = splitDiff(unified)
    .map((f) => ({ ...f, questions: questionsFor(f.path, deps.questions, deps.entryStems) }))
    .filter((f) => f.questions.length);
  let next = 0;
  const worker = async () => {
    while (next < work.length) {
      const f = work[next++]!;
      let diff = f.diff;
      if (diff.length > cfg.maxStateChars) {
        diff = `${diff.slice(0, cfg.maxStateChars)}\n… (diff truncated)`;
        out.truncated.push(f.path);
      }
      try {
        const r = await systemOne(cfg, { file: f.path, diff }, Object.fromEntries(f.questions.map((q) => [q.id, q.instructions])), deps.fetchFn, deps.sleepFn);
        out.calls++;
        out.model = r.model;
        out.inputTokens += r.inputTokens;
        for (const q of f.questions) out.decisions.push({ file: f.path, question: q.id, p: r.nouls[q.id]!, flagged: r.nouls[q.id]! >= cfg.threshold });
      } catch (err) {
        out.errors.push(`${f.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(deps.concurrency ?? cfg.concurrency, work.length)) }, worker));
  out.cents = (out.inputTokens / 1_000_000) * cfg.centsPerMTok;
  addSpend(cfg, out);
  return out;
}

export function logJudgment(cfg: DeciderConfig, j: Judgment, ctx: { cwd: string; kind: string; attempt: number; base?: string; blocking: boolean }): void {
  try {
    mkdirSync(dirname(cfg.logFile), { recursive: true });
    const at = new Date().toISOString();
    const lines = j.decisions.map((d) =>
      JSON.stringify({ at, provider: cfg.provider, model: j.model ?? cfg.model, threshold: cfg.threshold, repo: ctx.cwd, kind: ctx.kind, attempt: ctx.attempt, base: ctx.base, blocking: ctx.blocking && d.flagged, ...d }),
    );
    if (j.errors.length) lines.push(JSON.stringify({ at, provider: cfg.provider, repo: ctx.cwd, kind: ctx.kind, attempt: ctx.attempt, errors: j.errors }));
    if (lines.length) appendFileSync(cfg.logFile, `${lines.join("\n")}\n`);
  } catch {
    /* the log is for calibration; never fail a gate over it */
  }
}

// ---------------------------------------------------------------------------
// Spend: the decider is its own meter, never folded into the engine's.
// ---------------------------------------------------------------------------

export interface DeciderSpend {
  meter: string;
  cents: number;
  inputTokens: number;
  calls: number;
}

const spend = new Map<string, DeciderSpend>();

function addSpend(cfg: DeciderConfig, j: Judgment): void {
  if (!cfg.meter || !j.calls) return;
  const s = spend.get(cfg.meter) ?? { meter: cfg.meter, cents: 0, inputTokens: 0, calls: 0 };
  s.cents += j.cents;
  s.inputTokens += j.inputTokens;
  s.calls += j.calls;
  spend.set(cfg.meter, s);
}

/** What this process has spent on decision models since the last drain, per meter. */
export function drainDeciderSpend(): DeciderSpend[] {
  const all = [...spend.values()];
  spend.clear();
  return all;
}
