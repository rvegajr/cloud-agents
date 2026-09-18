import assert from "node:assert/strict";
import { test } from "node:test";
import type { SendFn, SendOpts } from "../../src/lib/build-loop.js";
import { classifyPrompt } from "../../src/lib/routing.js";
import { lenientJson, materialiseRequirements, materialiseTasks, runBlueprintLoop, type BlueprintIO } from "./blueprint-loop.js";
import type { GateResult } from "./quality-gate.js";

/**
 * A fake architect, crew, QA analyst, and reviewer keyed on the prompt's kind,
 * plus an in-memory repo. Every stage's contract is exercised without a model,
 * a shell, or git.
 */

const REQ = `# Requirements
## Acceptance criteria
- **R1** WHEN a user posts a snippet THE SYSTEM SHALL store it.
  Check: POST -> 201
- **R2** WHILE restarted THE SYSTEM SHALL retain snippets.
  Check: restart, list
## Workflows
- **W1** post then restart (R1, R2)
  1. post a snippet (R1)
  2. restart; it is still listed (R2)
## Coverage
- M1: R1
- M2: R2
## Decisions
- Job kind: build
`;
const QUALITY = '```json quality\n{ "bar": { "install": "npm ci", "test": "npm test", "lint": "npm run lint" }, "start": { "command": "npm start", "probe": { "http": "/", "expect": 200 } } }\n```\n';
const DESIGN = "# Design\n## Layout\nsrc/store.js store\nsrc/app.js app\n## Ports\n### Store used by: app\n  put(x)\n## Wiring\ncreateApp({store})\n";
const TASKS = `## T1: store
Requirements: R1, R2
Files: src/store.js
Ports: Store
Tests: test/store.test.js
Commands: npm test
Parallel: no
Goal: store.

## T2: app
Requirements: R1
Files: src/app.js
Ports: Store
Tests: test/app.test.js
Commands: npm test
Parallel: no
Goal: app.
`;
const QA = "## Q1 (R1): create\nGiven: x\nWhen: y\nThen: z\nEvidence: e\n\n## Q2 (R2): restart\nGiven: x\nWhen: y\nThen: z\nEvidence: e\n\n## Q3 (W1): post then restart\nGiven: x\nWhen:\n  1. open http://localhost:3000/ and click the button named Save\n  2. restart\nThen: z\nEvidence: e\n";
const TESTS = [{ path: "test/store.test.js", text: 'test("R1: store", ...); test("R2: restart", ...)' }, { path: "test/app.test.js", text: 'test("R1: app", ...)' }];

const pass: GateResult = { passed: true, findings: [], seconds: 1, skipped: [] };
const fail = (rule: "quality-bar" | "ownership"): GateResult => ({
  passed: false,
  findings: [{ rule, ok: false, detail: `${rule} failed`, command: "npm test", output: "boom" }],
  seconds: 1,
  skipped: [],
});

function makeIO(overrides: Partial<BlueprintIO> & { files?: Record<string, string>; gates?: GateResult[] } = {}) {
  const files: Record<string, string> = {
    "REQUIREMENTS.md": REQ,
    "QUALITY.md": QUALITY,
    "DESIGN.md": DESIGN,
    "TASKS.md": TASKS,
    "QA.md": QA,
    "README.md": "# app\nnpm ci && npm start",
    ...(overrides.files ?? {}),
  };
  const gates = overrides.gates ?? [];
  const calls = { gate: [] as { kind: string; allowed?: string[]; base?: string; taskCommands?: string[] }[], commands: [] as string[], commits: [] as string[], clones: 0, writes: [] as string[] };
  let sha = 0;
  const io: BlueprintIO = {
    readFile: (rel) => files[rel],
    writeFile: (rel, text) => {
      files[rel] = text;
      calls.writes.push(rel);
    },
    listTests: () => TESTS,
    headSha: () => `sha${++sha}`,
    commit: (m) => {
      calls.commits.push(m);
      return true;
    },
    gate: async (kind, ctx) => {
      calls.gate.push({ kind, allowed: ctx.allowedFiles, base: ctx.baseSha, taskCommands: ctx.taskCommands });
      return gates.shift() ?? pass;
    },
    runCommand: async (command) => {
      calls.commands.push(command);
      // red suite before implementation; review checks pass; everything else exit 0
      if (command === "npm test" && calls.gate.length === 0) return { code: 1, output: "1 failing" };
      if (command.startsWith("fail:")) return { code: 1, output: "" };
      return { code: 0, output: "ok" };
    },
    freshClone: async () => {
      calls.clones++;
      return `/tmp/clone-${calls.clones}`;
    },
    diffStat: () => " 2 files changed",
    ...overrides,
  };
  return { io, calls };
}

type Script = Partial<Record<string, (prompt: string, opts: SendOpts | undefined, n: number) => string>>;

function makeSend(script: Script) {
  const sent: { kind: string; opts: SendOpts | undefined; prompt: string }[] = [];
  const counts: Record<string, number> = {};
  const send: SendFn = async (prompt, opts) => {
    const kind = classifyPrompt(prompt);
    counts[kind] = (counts[kind] ?? 0) + 1;
    sent.push({ kind, opts, prompt });
    const fn = script[kind] ?? defaultScript[kind];
    const result = fn ? fn(prompt, opts, counts[kind]!) : "ok";
    return { status: "finished", result, runId: `${kind}-${counts[kind]}` };
  };
  return { send, sent };
}

const json = (o: unknown) => `done\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\``;
const defaultScript: Script = {
  requirements: () => json({ requirements: [], job_kind: "build" }),
  blueprint: () => json({ tasks: [], qa_scenarios: [] }),
  task: (p) => json({ task_id: p.match(/task (T\d+|QA-FIX|REVIEW-FIX)/)?.[1] ?? "?", done: true }),
  qa: () => json({ results: [{ id: "Q1", requirement: "R1", passed: true }, { id: "Q2", requirement: "R2", passed: true }, { id: "Q3", requirement: "W1", passed: true }], traceability: { covered: ["R1", "R2", "W1"], uncovered: [] } }),
  review: () => json({ verdict: "ship", summary: "fine", claims_disputed: [], findings: [] }),
};

const base = { job: "build a thing", repo: "https://example/repo" };

test("happy path: requirements -> blueprint -> two gated tasks -> finish gate -> QA in a fresh clone -> review ship -> complete", async () => {
  const { io, calls } = makeIO();
  const { send, sent } = makeSend({});
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "complete");
  assert.equal(out.phase, "done");
  assert.equal(out.jobKind, "build");
  assert.deepEqual(sent.map((s) => s.kind), ["requirements", "blueprint", "task", "task", "qa", "review"]);
  assert.deepEqual(out.taskRecords.map((r) => [r.id, r.gatePassed, r.attempts]), [["T1", true, 1], ["T2", true, 1]]);
  // task gates are scoped to the task's files and diffed from the sha before the turn
  assert.deepEqual(calls.gate[0], { kind: "task", allowed: ["src/store.js"], base: "sha2", taskCommands: ["npm test"] });
  // the second task's gate also re-runs the first task's commands (earlier green stays green); the finish gate carries none
  assert.deepEqual(calls.gate[1]!.taskCommands, ["npm test"]);
  assert.equal(calls.gate[2]!.taskCommands, undefined);
  assert.equal(calls.gate[2]!.kind, "finish");
  assert.deepEqual(calls.gate[2]!.allowed, ["src/store.js", "src/app.js"]);
  assert.equal(calls.gate[2]!.base, out.baselineSha);
  // QA ran in a fresh clone with a fresh session; review was read-only and fresh
  const qa = sent.find((s) => s.kind === "qa")!;
  assert.equal(qa.opts?.cwd, "/tmp/clone-1");
  assert.equal(qa.opts?.fresh, true);
  assert.match(qa.prompt, /## Q1 \(R1\)[\s\S]*## Q2 \(R2\)/, "both scenarios in one batch by default");
  const review = sent.find((s) => s.kind === "review")!;
  assert.deepEqual(review.opts, { mode: "agent", fresh: true });
  assert.match(review.prompt, /T1.*PASS/s);
  // the crew prompt carried the task block, its design excerpt, and the red output
  const t1 = sent.find((s) => s.kind === "task")!.prompt;
  assert.match(t1, /## T1: store/);
  assert.match(t1, /### Store/);
  assert.match(t1, /1 failing/);
  assert.doesNotMatch(t1, /src\/app\.js app/);
});

test("blueprint-incomplete: one targeted retry names the gap; still uncovered stops before any crew turn", async () => {
  const { io } = makeIO({ files: { "QA.md": "## Q1 (R1): create\nGiven: x\nWhen: y\nThen: z\n" } });
  const { send, sent } = makeSend({});
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "blueprint-incomplete");
  assert.match(out.stopDetail!, /R2: missing a QA scenario/);
  assert.deepEqual(sent.map((s) => s.kind), ["requirements", "blueprint", "blueprint"]);
  assert.match(sent[2]!.prompt, /^## Blueprint incomplete[\s\S]*R2: missing a QA scenario/);
});

test("blueprint traceability retry succeeds when the architect fills the gap", async () => {
  const files: Record<string, string> = { "QA.md": "## Q1 (R1): create\nGiven: x\nWhen: y\nThen: z\n" };
  const { io } = makeIO({ files });
  let n = 0;
  const { send } = makeSend({
    blueprint: () => {
      n++;
      if (n === 2) files["QA.md"] = QA; // the retry writes the missing scenario
      return json({ tasks: [], qa_scenarios: [] });
    },
  });
  // makeIO copies `files` into its own map; re-point readFile at the live object for this test
  io.readFile = (rel) => ({ "REQUIREMENTS.md": REQ, "QUALITY.md": QUALITY, "DESIGN.md": DESIGN, "TASKS.md": TASKS, "README.md": "r", ...files })[rel];
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "complete", out.stopDetail);
});

test("blueprint-incomplete when the suite is already green before implementation", async () => {
  const { io } = makeIO({ runCommand: async () => ({ code: 0, output: "all green" }) });
  const { send } = makeSend({});
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "blueprint-incomplete");
  assert.match(out.stopDetail!, /already green/);
});

test("a failing task gate is retried with the gate's feedback prepended, then passes", async () => {
  const { io } = makeIO({ gates: [fail("quality-bar"), pass] });
  const { send, sent } = makeSend({});
  const out = await runBlueprintLoop(send, { ...base, io, taskRetries: 2 });
  assert.equal(out.stopReason, "complete");
  assert.deepEqual(out.taskRecords[0], { id: "T1", attempts: 2, gatePassed: true, report: { task_id: "T1", done: true }, failing: [] });
  const tasks = sent.filter((s) => s.kind === "task");
  assert.equal(tasks.length, 3);
  assert.doesNotMatch(tasks[0]!.prompt, /Quality gate failed/);
  assert.match(tasks[1]!.prompt, /Quality gate failed \(attempt 1\)/);
  assert.match(tasks[1]!.prompt, /quality-bar failed/);
});

test("gate-failed after retries are exhausted; the crew's own 'done' is never consulted", async () => {
  const { io } = makeIO({ gates: [fail("ownership"), fail("ownership")] });
  const { send, sent } = makeSend({ task: () => json({ task_id: "T1", done: true, tests_green: ["all"] }) });
  const out = await runBlueprintLoop(send, { ...base, io, taskRetries: 1 });
  assert.equal(out.stopReason, "gate-failed");
  assert.match(out.stopDetail!, /T1 failed the gate after 2 attempt/);
  assert.equal(sent.filter((s) => s.kind === "task").length, 2);
  assert.equal(out.taskRecords[0]!.gatePassed, false);
});

test("QA defect -> one crew fix turn scoped to task files plus the defect's file -> QA re-run passes", async () => {
  const { io, calls } = makeIO();
  let qaRuns = 0;
  const { send, sent } = makeSend({
    qa: () => {
      qaRuns++;
      return qaRuns === 1
        ? json({ results: [{ id: "Q1", requirement: "R1", passed: false, evidence: "500", defect: { observed: "500", expected: "201", where: "src/app.js" } }, { id: "Q2", requirement: "R2", passed: true }, { id: "Q3", requirement: "W1", passed: true }] })
        : json({ results: [{ id: "Q1", requirement: "R1", passed: true }, { id: "Q2", requirement: "R2", passed: true }, { id: "Q3", requirement: "W1", passed: true }] });
    },
  });
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "complete");
  assert.equal(out.qaAttempts, 2);
  assert.equal(calls.clones, 2, "each QA attempt gets its own fresh clone");
  const fix = sent.find((s) => s.kind === "task" && /QA defects/.test(s.prompt))!;
  assert.match(fix.prompt, /Q1 \(R1\): observed "500"; expected "201"; where src\/app\.js/);
  assert.match(fix.prompt, /src\/store\.js, src\/app\.js/);
  const finishIdx = calls.gate.findIndex((g) => g.kind === "finish");
  const fixGate = calls.gate[finishIdx + 1];
  assert.equal(fixGate?.kind, "task", JSON.stringify(calls.gate));
  assert.deepEqual(fixGate?.allowed, ["src/store.js", "src/app.js"]);
});

test("QA failing twice stops with qa-failed", async () => {
  const { io } = makeIO();
  const { send } = makeSend({ qa: () => json({ results: [{ id: "Q1", requirement: "R1", passed: false }, { id: "Q2", requirement: "R2", passed: true }] }) });
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "qa-failed");
  assert.match(out.stopDetail!, /Q1/);
});

test("review with a high finding -> fix turn -> gate -> check command decides", async () => {
  const finding = { id: "V1", severity: "high", class: "vacuous-test", file: "src/app.js", line: 3, problem: "p", fix: "f", check: { command: "grep -q createApp src/app.js", expect_exit: 0 } };
  const { io, calls } = makeIO();
  const { send, sent } = makeSend({ review: () => json({ verdict: "fix", summary: "s", claims_disputed: ["x"], findings: [finding] }) });
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "complete");
  assert.deepEqual(out.reviewChecks, [{ id: "V1", command: "grep -q createApp src/app.js", expected: 0, actual: 0 }]);
  const fix = sent.find((s) => /review findings/.test(s.prompt))!;
  assert.match(fix.prompt, /"id": "V1"/);
  assert.ok(calls.commands.includes("grep -q createApp src/app.js"));
});

test("review-unresolved when a finding's check still fails after the fix turn", async () => {
  const finding = { id: "V1", severity: "high", problem: "p", fix: "f", check: { command: "fail: still broken", expect_exit: 0 } };
  const { io } = makeIO();
  const { send } = makeSend({ review: () => json({ verdict: "fix", findings: [finding] }) });
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "review-unresolved");
  assert.match(out.stopDetail!, /V1/);
});

test("resume: a state saved in the tasks phase continues at taskIndex without re-running the architect", async () => {
  const { io } = makeIO();
  const { send, sent } = makeSend({});
  const first = await runBlueprintLoop(send, { ...base, io, onState: () => {} });
  const resumed = await runBlueprintLoop(send, { ...base, io }, { ...first, phase: "tasks", taskIndex: 1, taskRecords: first.taskRecords.slice(0, 1), stopReason: undefined });
  assert.equal(resumed.stopReason, "complete");
  const kindsAfter = sent.slice(6).map((s) => s.kind);
  assert.deepEqual(kindsAfter, ["task", "qa", "review"]);
  assert.deepEqual(resumed.taskRecords.map((r) => r.id), ["T1", "T2"], "one record per task after a resume");
});

test("an architect that only prints its answer is asked once more, then the report is materialised to disk", async () => {
  // Start with no stage-0 documents on disk; the fake architect never writes them.
  const { io, calls } = makeIO({ files: { "REQUIREMENTS.md": "", "QUALITY.md": "" } });
  const report = {
    requirements: [{ id: "R1", text: "unknown routes answer 404", check: "curl /nope -> 404" }, { id: "R2", text: "root unchanged", check: "curl / -> 200" }],
    quality: { bar: { install: "npm ci", test: "npm test" }, hygiene_never_tracked: ["node_modules/"] },
    job_kind: "repair",
    non_goals: ["new routes"],
    decisions: ["repair"],
  };
  const { send, sent } = makeSend({ requirements: () => json(report) });
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "complete", out.stopDetail);
  const reqTurns = sent.filter((s) => s.kind === "requirements");
  assert.equal(reqTurns.length, 2, "one retry");
  assert.match(reqTurns[1]!.prompt, /^## You did not write the files/);
  assert.deepEqual(calls.writes, ["REQUIREMENTS.md", "QUALITY.md"]);
  assert.equal(out.jobKind, "repair");
  assert.deepEqual(out.requirements.map((r) => r.id), ["R1", "R2"]);
  assert.equal(out.quality?.bar.test, "npm test");
});

test("materialiseRequirements and materialiseTasks round-trip through the parsers", async () => {
  const { parseRequirements, parseQuality, parseTasks, jobKindOf } = await import("./blueprint.js");
  const made = materialiseRequirements({
    requirements: [{ id: "R1", text: "t", check: "c" }],
    quality: { bar: { test: "pytest -q", install: "uv sync" }, hygiene_never_tracked: [".venv/"] },
    job_kind: "maintain",
  });
  assert.deepEqual(parseRequirements(made.requirements!), [{ id: "R1", text: "t", check: "c" }]);
  assert.equal(jobKindOf(made.requirements!), "maintain");
  assert.deepEqual(parseQuality(made.quality!)?.bar, { test: "pytest -q", install: "uv sync" });
  const tasks = materialiseTasks({ tasks: [{ id: "T1", title: "x", files: ["a.py"], tests: ["test_a.py"], commands: ["pytest -q"], requirements: ["R1"], parallel_ok: true }] })!;
  const parsed = parseTasks(tasks);
  assert.equal(parsed[0]!.id, "T1");
  assert.deepEqual(parsed[0]!.files, ["a.py"]);
  assert.equal(parsed[0]!.parallelOk, true);
  assert.equal(materialiseTasks({}), undefined);
});

test("lenientJson accepts a fenced block, bare JSON, or JSON with prose around it", () => {
  assert.deepEqual(lenientJson('x\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(lenientJson('{"a":1}'), { a: 1 });
  assert.deepEqual(lenientJson('Here you go:\n{"a":1}\nThanks'), { a: 1 });
  assert.equal(lenientJson("no json here"), undefined);
});

test("an unfenced JSON reply on the retry is still materialised (what gpt-oss via qwen-code actually does)", async () => {
  const { io, calls } = makeIO({ files: { "REQUIREMENTS.md": "", "QUALITY.md": "" } });
  const report = { requirements: [{ id: "R1", text: "t", check: "c" }, { id: "R2", text: "u", check: "d" }], quality: { bar: { test: "npm test" } }, job_kind: "repair" };
  const { send } = makeSend({ requirements: (_p, _o, n) => (n === 1 ? "I would write the files as follows." : JSON.stringify(report, null, 2)) });
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "complete", out.stopDetail);
  assert.deepEqual(calls.writes, ["REQUIREMENTS.md", "QUALITY.md"]);
  assert.equal(out.jobKind, "repair");
});

test("a task that names a test file under Files: is a blueprint gap, retried once, then blueprint-incomplete", async () => {
  const badTasks = TASKS.replace("Files: src/store.js", "Files: test/store.test.js");
  const { io } = makeIO({ files: { "TASKS.md": badTasks } });
  const { send, sent } = makeSend({});
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "blueprint-incomplete");
  assert.match(out.stopDetail!, /T1: names test file/);
  assert.equal(sent.filter((s) => s.kind === "blueprint").length, 2);
  assert.match(sent[2]!.prompt, /T1: names test file\(s\) under Files: \(test\/store\.test\.js\)/);
  assert.equal(sent.filter((s) => s.kind === "task").length, 0, "no crew turn on an unlawful task");
});

test("resume re-reads TASKS.md from disk: a corrected task list replaces the persisted one", async () => {
  const { io } = makeIO();
  const { send, sent } = makeSend({});
  const first = await runBlueprintLoop(send, { ...base, io });
  // Persisted tasks carry a prose command; the operator fixed TASKS.md on disk before resuming.
  const stale = first.tasks.map((t) => (t.id === "T2" ? { ...t, commands: ["npm start (background) then curl"] } : t));
  const resumed = await runBlueprintLoop(send, { ...base, io }, { ...first, tasks: stale, phase: "tasks", taskIndex: 1, taskRecords: first.taskRecords.slice(0, 1), stopReason: undefined });
  assert.equal(resumed.stopReason, "complete");
  assert.deepEqual(resumed.tasks[1]!.commands, ["npm test"], "disk wins over the persisted copy");
  assert.equal(sent.filter((s) => s.kind === "task").length, 3);
});

test("QA runs in batches, retries a batch that reports nothing, then falls back to the frontier tier when allowed", async () => {
  const { io } = makeIO();
  let calls = 0;
  const { send, sent } = makeSend({
    qa: (p, o) => {
      calls++;
      const ids = [...p.matchAll(/## (Q\d) \(([RW]\d)\)/g)].map((m) => ({ id: m[1]!, requirement: m[2]! }));
      // batch 1 (Q1) reports fine; batch 2 (Q2) fails twice locally and only reports on the claude fallback
      if (ids[0]?.id === "Q2" && o?.tier !== "claude") return "Q2 passed. Q3:";
      return json({ results: ids.map((i) => ({ ...i, passed: true })) });
    },
  });
  const out = await runBlueprintLoop(send, { ...base, io, qaBatch: 1, qaFallbackTier: "claude" });
  assert.equal(out.stopReason, "complete", out.stopDetail);
  const qaSends = sent.filter((s) => s.kind === "qa");
  assert.equal(qaSends.length, 5, "Q1 once; Q2 local, local retry, claude; Q3 (W1) once");
  assert.equal(qaSends[2]!.opts?.tier, undefined);
  assert.match(qaSends[2]!.prompt, /^## Your previous reply had no results block/);
  assert.equal(qaSends[3]!.opts?.tier, "claude");
  assert.deepEqual(out.qa?.results.map((r) => r.id), ["Q1", "Q2", "Q3"]);
  assert.equal(calls, 5);
});

test("QA with no fallback tier stops with unparseable-report after the retry", async () => {
  const { io } = makeIO();
  const { send } = makeSend({ qa: () => "nothing useful" });
  const out = await runBlueprintLoop(send, { ...base, io, qaBatch: 4 });
  assert.equal(out.stopReason, "unparseable-report");
  assert.match(out.stopDetail!, /QA batch 1 returned no results block/);
});

test("QA duplicates collapse by id and a passing duplicate never erases a failure; attempts count reports", async () => {
  const { io } = makeIO();
  const { send } = makeSend({
    qa: () => json({ results: [{ id: "Q1", requirement: "R1", passed: false, defect: { observed: "x", expected: "y", where: "src/app.js" } }, { id: "Q1", requirement: "R1", passed: true }, { id: "Q2", requirement: "R2", passed: true }] }),
  });
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "qa-failed");
  assert.equal(out.qaAttempts, 2);
  assert.deepEqual(out.qa?.results.map((r) => [r.id, r.passed]), [["Q1", false], ["Q2", true]]);
});

const JOB_WITH_MUST_HAVES = "# Vault\n\n## Must have (v1)\n- Create a snippet.\n- Edit a snippet in the browser.\n\n## Shape\n- web app\n";

test("stage 0: a must-have no requirement covers is a gap; one retry names it; still uncovered stops with requirements-incomplete before any blueprint turn", async () => {
  // REQ maps M1 -> R1 and M2 -> R2, but this job's M2 is "edit", which the fixture's R2 (restart) does not cover: make the fixture's coverage miss M2.
  const req = REQ.replace("- M2: R2\n", "");
  const { io } = makeIO({ files: { "REQUIREMENTS.md": req } });
  const { send, sent } = makeSend({});
  const out = await runBlueprintLoop(send, { ...base, job: JOB_WITH_MUST_HAVES, io });
  assert.equal(out.stopReason, "requirements-incomplete", out.stopDetail);
  assert.match(out.stopDetail!, /M2 "Edit a snippet in the browser\." is covered by no requirement/);
  assert.deepEqual(sent.map((s) => s.kind), ["requirements", "requirements"], "retried once, no blueprint turn");
  assert.match(sent[1]!.prompt, /^## Requirements incomplete[\s\S]*M2 "Edit a snippet in the browser\."/);
  assert.match(sent[0]!.prompt, /- \*\*M1\*\* Create a snippet\.\n- \*\*M2\*\* Edit a snippet in the browser\./, "the must-haves are numbered in the prompt");
  assert.deepEqual(out.mustHaves, ["Create a snippet.", "Edit a snippet in the browser."]);
});

test("stage 0: the retry that adds the missing coverage lets the job proceed; workflows are parsed into state", async () => {
  const req = REQ.replace("- M2: R2\n", "");
  const { io } = makeIO({ files: { "REQUIREMENTS.md": req } });
  const { send, sent } = makeSend({
    requirements: (_p, _o, n) => {
      if (n === 2) io.writeFile("REQUIREMENTS.md", REQ);
      return json({ requirements: [], job_kind: "build" });
    },
  });
  const out = await runBlueprintLoop(send, { ...base, job: JOB_WITH_MUST_HAVES, io });
  assert.equal(out.stopReason, "complete", out.stopDetail);
  assert.equal(sent.filter((s) => s.kind === "requirements").length, 2);
  assert.deepEqual(out.workflows.map((w) => [w.id, w.requirements]), [["W1", ["R1", "R2"]]]);
});

test("stage 1: a workflow with no QA scenario is a blueprint gap naming the workflow", async () => {
  const qaNoWorkflow = QA.replace(/\n## Q3 \(W1\)[\s\S]*$/, "\n");
  const { io } = makeIO({ files: { "QA.md": qaNoWorkflow } });
  const { send, sent } = makeSend({});
  const out = await runBlueprintLoop(send, { ...base, io });
  assert.equal(out.stopReason, "blueprint-incomplete");
  assert.match(out.stopDetail!, /W1: missing a QA scenario headed `## Qn \(W1\)` that walks every step/);
  assert.equal(sent.filter((s) => s.kind === "blueprint").length, 2);
});

test("QA turns ask the engine for a browser when the loop has one, and the prompt says which tools; without one the prompt forbids browser claims", async () => {
  const withBrowser = makeIO();
  const a = makeSend({});
  await runBlueprintLoop(a.send, { ...base, io: withBrowser.io, browser: true });
  const qa = a.sent.find((s) => s.kind === "qa")!;
  assert.equal(qa.opts?.browser, true);
  assert.match(qa.prompt, /## Browser\n\nYou have a real headless browser[\s\S]*`browser_snapshot`/);
  assert.match(qa.prompt, /## Q3 \(W1\)/, "the workflow scenario is executed with the others");
  const without = makeIO();
  const b = makeSend({});
  await runBlueprintLoop(b.send, { ...base, io: without.io });
  const qa2 = b.sent.find((s) => s.kind === "qa")!;
  assert.equal(qa2.opts?.browser, undefined);
  assert.match(qa2.prompt, /No browser tool is available/);
  // an ETL, database, CLI, or library job: no scenario happens on a page, so no server is attached even when the run has one
  const etl = makeIO({ files: { "QA.md": QA.replace("open http://localhost:3000/ and click the button named Save", "run the loader; count rows") } });
  const c0 = makeSend({});
  await runBlueprintLoop(c0.send, { ...base, io: etl.io, browser: true });
  const qa3 = c0.sent.find((s) => s.kind === "qa")!;
  assert.equal(qa3.opts?.browser, undefined, "no page steps: no browser asked for");
  assert.match(qa3.prompt, /None of these scenarios happens on a page; no browser is attached/);
  assert.doesNotMatch(qa3.prompt, /browser_navigate/);
  // with batching, only the batch that has a page step gets the browser
  const c1 = makeSend({});
  await runBlueprintLoop(c1.send, { ...base, io: makeIO().io, browser: true, qaBatch: 2 });
  const batches = c1.sent.filter((s) => s.kind === "qa");
  assert.deepEqual(batches.map((s) => s.opts?.browser), [undefined, true], "Q1+Q2 no browser; Q3 (W1) browser");
  // a workflow the analyst never reported is uncovered in the traceability record
  const c = makeSend({ qa: () => json({ results: [{ id: "Q1", requirement: "R1", passed: true }, { id: "Q2", requirement: "R2", passed: true }] }) });
  const out = await runBlueprintLoop(c.send, { ...base, io: makeIO().io });
  assert.equal(out.stopReason, "qa-failed");
  assert.deepEqual(out.qa?.traceability?.uncovered, ["W1"]);
});

test("materialiseRequirements writes workflows and coverage the parsers read back", () => {
  const made = materialiseRequirements({
    requirements: [{ id: "R1", text: "t", check: "c" }],
    workflows: [{ id: "W1", title: "walk", requirements: ["R1"], steps: ["one", "two"] }],
    coverage: { M1: ["R1"] },
    job_kind: "build",
  });
  assert.match(made.requirements!, /## Workflows\n\n- \*\*W1\*\* walk \(R1\)\n  1\. one\n  2\. two/);
  assert.match(made.requirements!, /## Coverage\n\n- M1: R1/);
});
