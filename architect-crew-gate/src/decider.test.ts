import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  deciderConfigFromEnv,
  drainDeciderSpend,
  entryStemsOf,
  judgeDiff,
  questionsFor,
  splitDiff,
  systemOne,
  type DeciderConfig,
  type FetchFn,
} from "./decider.js";
import { runQualityGate } from "./quality-gate.js";

const FAKE_KEY = "sk-test-not-a-real-key";

function cfg(over: Partial<DeciderConfig> = {}): DeciderConfig {
  return {
    provider: "jev",
    url: "https://decider.test/v1/systemone",
    model: "jev-latest",
    apiKey: FAKE_KEY,
    threshold: 0.85,
    maxStateChars: 60_000,
    centsPerMTok: 4.2,
    meter: "typesafe:billed",
    timeoutMs: 5000,
    retries: 2,
    concurrency: 4,
    logFile: join(mkdtempSync(join(tmpdir(), "decider-")), "decider.jsonl"),
    ...over,
  };
}

/** Answers every question with `p(file, id)`; records each request body. */
function fakeFetch(p: (file: string, id: string) => number, bodies: { headers: Record<string, string>; body: any }[] = []): FetchFn {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push({ headers: init.headers, body });
    const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "noul", noul: p(body.state.file, id) }]));
    return { ok: true, status: 200, json: async () => ({ model: "jev-1.13.0", answers, usage: { input_tokens: 1000, output_tokens: 0 } }), text: async () => "" };
  };
}

const DIFF = [
  "diff --git a/src/db.ts b/src/db.ts",
  "index 1..2 100644",
  "--- a/src/db.ts",
  "+++ b/src/db.ts",
  "@@ -1 +1,2 @@",
  "+export const db = openDatabase('app.sqlite');",
  "diff --git a/test/db.test.ts b/test/db.test.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/test/db.test.ts",
  "@@ -0,0 +1 @@",
  "+test('db', () => { assert.ok(true); });",
  "diff --git a/package-lock.json b/package-lock.json",
  "--- a/package-lock.json",
  "+++ b/package-lock.json",
  "@@ -1 +1 @@",
  "+{}",
  "diff --git a/src/old.ts b/src/old.ts",
  "deleted file mode 100644",
  "--- a/src/old.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-gone",
  "",
].join("\n");

test("deciderConfigFromEnv: off by default; each provider's endpoint, model, key, and meter", () => {
  assert.equal(deciderConfigFromEnv({}).provider, "off");
  assert.equal(deciderConfigFromEnv({ DECIDER: "nonsense" }).provider, "off");

  const jev = deciderConfigFromEnv({ DECIDER: "jev", TYPESAFE_API_KEY: FAKE_KEY });
  assert.equal(jev.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(jev.model, "jev-latest");
  assert.equal(jev.apiKey, FAKE_KEY);
  assert.equal(jev.meter, "typesafe:billed");
  assert.equal(jev.problem, undefined);
  assert.equal(jev.threshold, 0.9);
  assert.equal(jev.concurrency, 4);

  const d1 = deciderConfigFromEnv({ DECIDER: "D1", LIQUID_API_KEY: "liquid_x" });
  assert.equal(d1.url, "https://api.liquid.ai/decisions/v1/systemone");
  assert.equal(d1.model, "d1:free");
  assert.equal(d1.meter, "liquid:billed");
  assert.equal(d1.concurrency, 2, "d1:free rate-limits a burst");

  const local = deciderConfigFromEnv({ DECIDER: "local", DECIDER_MODEL: "nimble", DECIDER_THRESHOLD: "1.5" });
  assert.equal(local.url, "http://localhost:11434/v1/systemone");
  assert.equal(local.apiKey, undefined);
  assert.equal(local.meter, "", "a local model has no card meter");
  assert.equal(local.threshold, 1, "threshold is clamped to [0, 1]");
});

test("deciderConfigFromEnv names what is missing, and never the key's value", () => {
  const noKey = deciderConfigFromEnv({ DECIDER: "jev" });
  assert.match(noKey.problem ?? "", /TYPESAFE_API_KEY is not set/);
  assert.match(deciderConfigFromEnv({ DECIDER: "local" }).problem ?? "", /DECIDER_MODEL/);
  const withKey = deciderConfigFromEnv({ DECIDER: "d1", LIQUID_API_KEY: "liquid_secret" });
  assert.ok(!JSON.stringify({ ...withKey, apiKey: undefined }).includes("liquid_secret"));
});

test("splitDiff keeps one entry per changed file and drops deleted and binary files", () => {
  const files = splitDiff(`${DIFF}diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n`);
  assert.deepEqual(files.map((f) => f.path), ["src/db.ts", "test/db.test.ts", "package-lock.json"]);
  assert.ok(files[0]!.diff.includes("openDatabase"));
  assert.ok(!files[0]!.diff.includes("assert.ok(true)"), "a file's state carries only its own diff");
});

test("questionsFor asks test questions of tests, source questions of source, nothing of lockfiles or docs", () => {
  const ids = (p: string) => questionsFor(p).map((q) => q.id).sort();
  assert.deepEqual(ids("test/db.test.ts"), ["hardcoded-secret", "test-skips-code", "vacuous-test", "weakened-check"]);
  assert.deepEqual(ids("tests/test_app.py"), ["hardcoded-secret", "test-skips-code", "vacuous-test", "weakened-check"]);
  assert.deepEqual(ids("src/db.ts"), ["hardcoded-secret", "import-side-effect", "placeholder", "swallowed-error", "weakened-check"]);
  assert.deepEqual(ids("package-lock.json"), []);
  assert.deepEqual(ids("README.md"), []);
  assert.deepEqual(ids("dist/index.js"), []);
});

test("entry points are not asked about import-time side effects: starting the server is their job", () => {
  const stems = entryStemsOf({ main: "dist/index.js", bin: { tool: "bin/cli.mjs" }, scripts: { start: "node dist/server.js --port 3000", dev: "tsx watch src/server.ts", test: "node --test test/x.test.js" } });
  assert.deepEqual([...stems].sort(), ["cli", "index", "server"]);
  const ids = (p: string) => questionsFor(p, undefined, stems).map((q) => q.id);
  assert.ok(!ids("src/server.ts").includes("import-side-effect"));
  assert.ok(ids("src/server.ts").includes("swallowed-error"), "every other question still applies");
  assert.ok(ids("src/db.ts").includes("import-side-effect"));
  assert.deepEqual([...entryStemsOf(undefined)], []);
});

test("systemOne retries 429 and 5xx with backoff, honouring retry-after, then gives up", async () => {
  const waits: number[] = [];
  const sleepFn = async (ms: number) => void waits.push(ms);
  let n = 0;
  const busy: FetchFn = async (url, init) => {
    n++;
    if (n === 1) return { ok: false, status: 429, headers: { get: (h: string) => (h === "retry-after" ? "3" : null) }, json: async () => ({}), text: async () => "slow down" };
    if (n === 2) return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
    return fakeFetch(() => 0.4)(url, init);
  };
  const r = await systemOne(cfg({ retries: 2 }), {}, { q: "x" }, busy, sleepFn);
  assert.equal(r.nouls.q, 0.4);
  assert.deepEqual(waits, [3000, 2000]);

  const always: FetchFn = async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => "rate limited" });
  await assert.rejects(systemOne(cfg({ retries: 1 }), {}, { q: "x" }, always, async () => {}), /jev 429: rate limited/);
  const bad: FetchFn = async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => "bad" });
  let slept = 0;
  await assert.rejects(systemOne(cfg({ retries: 3 }), {}, { q: "x" }, bad, async () => void slept++), /400/);
  assert.equal(slept, 0, "a 400 is not retried");
});

test("systemOne sends nouls with a bearer key only when there is one, and parses the answers", async () => {
  const bodies: { headers: Record<string, string>; body: any }[] = [];
  const r = await systemOne(cfg(), { file: "a.ts", diff: "+x" }, { q1: "is it so" }, fakeFetch(() => 0.25, bodies));
  assert.deepEqual(r.nouls, { q1: 0.25 });
  assert.equal(r.model, "jev-1.13.0");
  assert.equal(r.inputTokens, 1000);
  assert.equal(bodies[0]!.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.deepEqual(bodies[0]!.body.questions, { q1: { type: "noul", instructions: "is it so" } });
  assert.equal(bodies[0]!.body.model, "jev-latest");

  const local: { headers: Record<string, string>; body: any }[] = [];
  await systemOne(cfg({ provider: "local", apiKey: undefined }), { file: "a.ts" }, { q1: "x" }, fakeFetch(() => 0, local));
  assert.equal(local[0]!.headers.Authorization, undefined);
});

test("systemOne turns an HTTP error into a short message without the key", async () => {
  const fail: FetchFn = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '{"detail":"invalid api key"}' });
  await assert.rejects(systemOne(cfg(), {}, { q: "x" }, fail), (err: Error) => {
    assert.match(err.message, /^jev 401: .*invalid api key/);
    assert.ok(!err.message.includes(FAKE_KEY));
    return true;
  });
  const missing: FetchFn = async () => ({ ok: true, status: 200, json: async () => ({ answers: {} }), text: async () => "" });
  await assert.rejects(systemOne(cfg(), {}, { q: "x" }, missing), /no noul for q/);
});

test("judgeDiff flags at the threshold, prices input tokens, truncates big files, and collects errors", async () => {
  drainDeciderSpend();
  const p = (file: string, id: string) => (file === "src/db.ts" && id === "import-side-effect" ? 0.97 : file === "test/db.test.ts" && id === "vacuous-test" ? 0.85 : 0.1);
  const j = await judgeDiff(DIFF, cfg(), { fetchFn: fakeFetch(p) });
  assert.equal(j.calls, 2, "one call per judged file; the lockfile and the deleted file are not sent");
  assert.deepEqual(j.decisions.filter((d) => d.flagged).map((d) => `${d.file}:${d.question}`).sort(), ["src/db.ts:import-side-effect", "test/db.test.ts:vacuous-test"]);
  assert.equal(j.inputTokens, 2000);
  assert.ok(Math.abs(j.cents - 0.0084) < 1e-9, `2000 tokens at 4.2 c/Mtok, got ${j.cents}`);
  assert.deepEqual(drainDeciderSpend(), [{ meter: "typesafe:billed", cents: j.cents, inputTokens: 2000, calls: 2 }]);
  assert.deepEqual(drainDeciderSpend(), [], "drain clears");

  const bodies: { headers: Record<string, string>; body: any }[] = [];
  const small = await judgeDiff(DIFF, cfg({ maxStateChars: 1000 }), { fetchFn: fakeFetch(() => 0, bodies) });
  assert.deepEqual(small.truncated, []);
  const tiny = await judgeDiff(DIFF, { ...cfg(), maxStateChars: 40 }, { fetchFn: fakeFetch(() => 0) });
  assert.deepEqual(tiny.truncated.sort(), ["src/db.ts", "test/db.test.ts"]);

  let n = 0;
  const flaky: FetchFn = async (url, init) => (n++ === 0 ? Promise.reject(new Error("socket hang up")) : fakeFetch(() => 0)(url, init));
  const partial = await judgeDiff(DIFF, cfg(), { fetchFn: flaky, concurrency: 1 });
  assert.equal(partial.errors.length, 1);
  assert.match(partial.errors[0]!, /socket hang up/);
  assert.equal(partial.calls, 1);
  drainDeciderSpend();
});

function gitExec(diff: string) {
  const calls: string[] = [];
  const exec = async (cmd: { file: string; args: string[] }) => {
    calls.push(`${cmd.file} ${cmd.args.join(" ")}`);
    if (cmd.file === "git" && cmd.args[0] === "ls-files") return { stdout: "src/db.ts\ntest/db.test.ts\n", stderr: "", code: 0 };
    if (cmd.file === "git" && cmd.args.includes("--name-status")) return { stdout: "M\tsrc/db.ts\nA\ttest/db.test.ts\n", stderr: "", code: 0 };
    if (cmd.file === "git" && cmd.args[0] === "diff") return { stdout: diff, stderr: "", code: 0 };
    if (cmd.file === "git") return { stdout: "", stderr: "", code: 0 };
    return { stdout: "ok", stderr: "", code: 0 };
  };
  return { exec, calls };
}

const QUALITY = { bar: { test: "npm test" }, hygieneNeverTracked: [], rubricTargets: {} };
const GATE = { enabled: true, retries: 2, startTimeoutMs: 1000, commandTimeoutMs: 1000, vacuous: "" as const, startEvery: 0 };

test("the judgment rule blocks the first attempt with feedback, then only advises", async () => {
  const decider = cfg();
  const fetchFn = fakeFetch((file, id) => (id === "import-side-effect" ? 0.95 : 0.05));
  const { exec, calls } = gitExec(DIFF);
  const first = await runQualityGate("/tmp/nowhere", { ...GATE, decider }, "iterate", { exec, quality: QUALITY, baseSha: "abc123", attempt: 0, fetchFn });
  assert.equal(first.passed, false);
  const bad = first.findings.filter((f) => !f.ok);
  assert.equal(bad.length, 1);
  assert.equal(bad[0]!.rule, "judgment");
  assert.match(bad[0]!.detail, /^src\/db\.ts: a module opens a resource or starts work at import time.*p=0\.95, jev jev-1\.13\.0/);
  assert.ok(calls.includes("git diff --no-color --no-ext-diff -U5 abc123..HEAD"), calls.join("\n"));

  const second = await runQualityGate("/tmp/nowhere", { ...GATE, decider }, "iterate", { exec, quality: QUALITY, baseSha: "abc123", attempt: 1, fetchFn });
  assert.equal(second.passed, true, "a second flag on the same work never stops the build");
  assert.match(second.findings.find((f) => f.rule === "judgment")!.detail, /^still flagged on attempt 2, advisory only/);

  const log = readFileSync(decider.logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(log.length >= 2 * 8, "every decision is logged for calibration");
  assert.ok(log.some((r) => r.question === "test-skips-code" && r.file === "test/db.test.ts"));
  assert.ok(log.some((r) => r.question === "import-side-effect" && r.flagged && r.blocking && r.attempt === 0));
  assert.ok(log.some((r) => r.question === "import-side-effect" && r.flagged && !r.blocking && r.attempt === 1));
  assert.ok(!readFileSync(decider.logFile, "utf8").includes(FAKE_KEY), "the key never reaches the log");
  drainDeciderSpend();
});

test("the judgment rule waits for the deterministic rules, and never fails a turn on its own outage or misconfiguration", async () => {
  let asked = 0;
  const counting: FetchFn = async (url, init) => {
    asked++;
    return fakeFetch(() => 0.99)(url, init);
  };
  const red = async (cmd: { file: string; args: string[] }) => {
    if (cmd.file === "git" && cmd.args[0] === "ls-files") return { stdout: "src/db.ts\n", stderr: "", code: 0 };
    if (cmd.file === "git") return { stdout: "", stderr: "", code: 0 };
    return { stdout: "1 failing", stderr: "", code: 1 };
  };
  const r = await runQualityGate("/tmp/nowhere", { ...GATE, decider: cfg() }, "iterate", { exec: red, quality: QUALITY, fetchFn: counting });
  assert.equal(r.passed, false);
  assert.equal(asked, 0, "the model is not asked while a command already failed");
  assert.ok(r.skipped.includes("judgment"));

  const down: FetchFn = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "overloaded" });
  const out = await runQualityGate("/tmp/nowhere", { ...GATE, decider: cfg() }, "iterate", { exec: gitExec(DIFF).exec, quality: QUALITY, fetchFn: down });
  assert.equal(out.passed, true);
  assert.ok(out.findings.some((f) => f.rule === "judgment" && /judgment unavailable: .*503/.test(f.detail)));

  const noKey = await runQualityGate("/tmp/nowhere", { ...GATE, decider: deciderConfigFromEnv({ DECIDER: "jev" }) }, "iterate", { exec: gitExec(DIFF).exec, quality: QUALITY, fetchFn: counting });
  assert.equal(noKey.passed, true);
  assert.match(noKey.findings.find((f) => f.rule === "judgment")!.detail, /judgment skipped: TYPESAFE_API_KEY is not set/);

  const off = await runQualityGate("/tmp/nowhere", { ...GATE, decider: deciderConfigFromEnv({}) }, "iterate", { exec: gitExec(DIFF).exec, quality: QUALITY, fetchFn: counting });
  assert.ok(!off.findings.some((f) => f.rule === "judgment"));
  assert.equal(asked, 0);
  drainDeciderSpend();
});

test("decider log is written beside .runs by default", () => {
  const c = deciderConfigFromEnv({ DECIDER: "d1", LIQUID_API_KEY: "liquid_x" });
  assert.ok(c.logFile.endsWith(join(".runs", "decider.jsonl")));
});
