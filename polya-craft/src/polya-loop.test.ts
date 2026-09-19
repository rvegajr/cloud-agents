import assert from "node:assert/strict";
import { test } from "node:test";
import type { SendFn, SendOpts } from "../../src/lib/build-loop.js";
import { classifyPrompt } from "../../src/lib/routing.js";
import type { GateResult } from "../../architect-crew-gate/src/quality-gate.js";
import type { Lesson, LessonsStore, NewLesson } from "./lessons.js";
import { PLAN_MD, PROBLEM_MD } from "./plan.test.js";
import { parsePlan } from "./plan.js";
import { initialPolyaState, polyaResumePhase, runPolyaLoop, type PolyaIO, type PolyaState } from "./polya-loop.js";

/**
 * A fake Solver, Hand, Verifier, and reviewer keyed on the prompt's kind, plus
 * an in-memory repo and ledger. Every stage's contract is exercised without a
 * model, a shell, or git.
 */

const pass: GateResult = { passed: true, findings: [], seconds: 1, skipped: [] };
const fail = (rule: "quality-bar" | "ownership"): GateResult => ({ passed: false, findings: [{ rule, ok: false, detail: `${rule} failed`, command: "npm test", output: "boom" }], seconds: 1, skipped: [] });

/** What the fake Solver writes when its turn runs; a test may override either. */
let seed: { problem: string; plan: string } = { problem: PROBLEM_MD, plan: PLAN_MD };
let currentIO: PolyaIO | undefined;

function makeIO(overrides: Partial<PolyaIO> & { files?: Record<string, string>; gates?: GateResult[]; commands?: Record<string, number>; preload?: boolean } = {}) {
  const given = { ...(overrides.files ?? {}) };
  seed = { problem: given[".polya/PROBLEM.md"] ?? PROBLEM_MD, plan: given[".polya/PLAN.md"] ?? PLAN_MD };
  // The artifacts are written by the Solver's turns, not pre-loaded, unless a test resumes past them.
  if (overrides.preload) {
    given[".polya/PROBLEM.md"] = seed.problem;
    given[".polya/PLAN.md"] = seed.plan;
  } else {
    delete given[".polya/PROBLEM.md"];
    delete given[".polya/PLAN.md"];
  }
  const files: Record<string, string> = {
    "README.md": "# app\nnpm ci && npm start",
    "test/notfound.test.js": "test('D1 not found', ...)",
    ...given,
  };
  const gates = overrides.gates ?? [];
  const calls = { gate: [] as { kind: string; allowed?: string[]; base?: string; taskCommands?: string[] }[], commands: [] as { command: string; cwd?: string }[], commits: [] as string[], clones: 0, writes: [] as string[] };
  let sha = 0;
  const io: PolyaIO = {
    readFile: (rel) => files[rel],
    writeFile: (rel, text) => {
      files[rel] = text;
      calls.writes.push(rel);
    },
    listTests: () => [],
    headSha: () => `sha${++sha}`,
    commit: (m) => {
      calls.commits.push(m);
      return true;
    },
    gate: async (kind, ctx) => {
      calls.gate.push({ kind, allowed: ctx.allowedFiles, base: ctx.baseSha, taskCommands: ctx.taskCommands });
      return gates.shift() ?? pass;
    },
    runCommand: async (command, cwd) => {
      calls.commands.push({ command, cwd });
      if (overrides.commands && command in overrides.commands) return { code: overrides.commands[command]!, output: "scripted" };
      // The suite is red before any unit ran; everything else exits 0.
      if (command === "npm test" && calls.gate.length === 0) return { code: 1, output: "1 failing" };
      if (command.startsWith("fail:")) return { code: 1, output: "" };
      if (command.includes("red-until-fixed")) return { code: 1, output: "1 failing" };
      return { code: 0, output: "ok" };
    },
    freshClone: async () => {
      calls.clones++;
      return `/tmp/clone-${calls.clones}`;
    },
    diffStat: () => " 2 files changed",
    changedFiles: () => ["test/repair.red-until-fixed.test.js"],
    removeFile: (rel) => {
      if (!(rel in files)) return false;
      delete files[rel];
      calls.writes.push(`rm ${rel}`);
      return true;
    },
    ...overrides,
  };
  currentIO = io;
  return { io, calls, files };
}

function memLessons(seed: Lesson[] = []): LessonsStore & { added: NewLesson[]; confirmed: string[] } {
  const store = {
    path: "(memory)",
    added: [] as NewLesson[],
    confirmed: [] as string[],
    list: () => seed,
    select: () => seed,
    append: (entries: NewLesson[]) => {
      store.added.push(...entries);
      return entries.map((e, i) => ({ id: `L-new-${store.added.length - entries.length + i + 1}`, tags: e.tags, when: e.when, lesson: e.lesson, evidence: e.evidence, status: "candidate" as const, confirmations: 0 }));
    },
    confirm: (ids: string[]) => {
      store.confirmed.push(...ids);
    },
  };
  return store;
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
const defaultDevise = (p: string): string => defaultScript.devise!(p, undefined, 1);
const defaultScript: Script = {
  understand: () => {
    currentIO?.writeFile(".polya/PROBLEM.md", seed.problem);
    return json({ written: [".polya/PROBLEM.md"], done_ids: ["D1", "D2"] });
  },
  devise: (p) => {
    if (/^# Devise a repair/m.test(p)) {
      const next = p.match(/numbered from (U\d+)/)?.[1] ?? "U9";
      const d = p.match(/^- (D\d+):/m)?.[1] ?? "D1";
      const plan = currentIO?.readFile(".polya/PLAN.md") ?? "";
      currentIO?.writeFile(".polya/PLAN.md", `${plan}\n\n## Repairs\n\n## ${next}: repair what look back found\nServes:   ${d}\nLevel:    L1:repair\nProduces: \`src/app.js\` fixed\nGiven:    the evidence line for ${d}\nDo:       1. Fix the cause in src/app.js.\nTouches:  src/app.js\nCheck:    \`node --test test/repair.red-until-fixed.test.js\` — Now: unmet\nDepends:  none\nNot:      anything else.\n`);
      currentIO?.writeFile("test/repair.red-until-fixed.test.js", "test('red until fixed', ...)");
      return json({ written: [".polya/PLAN.md"], units: [next], check_wrong: false });
    }
    currentIO?.writeFile(".polya/PLAN.md", seed.plan);
    return json({ written: [".polya/PLAN.md"], units: ["U1", "U2"] });
  },
  "carry-out": (p) => json({ unit_id: p.match(/unit (U[\w-]+)/)?.[1] ?? "?", done: true, blocked: false, check_passed: true }),
  walk: () => json({ started: true, results: [{ step: 2, d: "D2", passed: true, evidence: "started on :3000" }] }),
  "look-back": () => json({ verdict: "done", answers_problem: true, another_check: "the access log", findings: [], worked: ["U1 first time"], did_not: [], confirmed: ["L-2026-09-18-01"], lessons: [{ tags: ["kind:repair", "stage:devise"], when: "a middleware order bug", lesson: "check the static handler after any middleware change", evidence: "this repair, U1" }] }),
};

const base = { problem: "GET /nope answers 200; it should be 404", repo: "https://example/repo" };

test("happy path: understand → devise → two gated units → finish check → done-checks in a fresh clone → review → LOOKBACK.md + ledger", async () => {
  const { io, calls, files } = makeIO();
  const lessons = memLessons();
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons });
  assert.equal(out.stopReason, "complete");
  assert.equal(out.phase, "done");
  assert.deepEqual(sent.map((s) => s.kind), ["understand", "devise", "carry-out", "carry-out", "walk", "look-back"]);
  // The Solver saw the ledger slot; the Hand's packet carries the unit block and the D lines it serves.
  assert.match(sent[0]!.prompt, /\(no prior lessons\)/);
  assert.match(sent[2]!.prompt, /## U1: reorder the not-found handler/);
  assert.match(sent[2]!.prompt, /D1: GET \/nope answers 404/);
  assert.doesNotMatch(sent[2]!.prompt, /## U2:/);
  // Unit gates: U2's task commands include U1's Check; the finish check covers every Touches from the baseline.
  assert.equal(calls.gate.length, 3);
  assert.deepEqual(calls.gate[0]!.allowed, ["src/app.js"]);
  assert.deepEqual(calls.gate[0]!.taskCommands, ["node --test test/notfound.test.js"]);
  assert.deepEqual(calls.gate[1]!.taskCommands, ["node --test test/notfound.test.js", 'grep -q "npm start" README.md']);
  assert.equal(calls.gate[2]!.kind, "finish");
  assert.deepEqual(calls.gate[2]!.allowed, ["src/app.js", "README.md", ".polya/PROBLEM.md", ".polya/PLAN.md", ".polya/LOOKBACK.md"]);
  assert.equal(calls.gate[2]!.base, out.baselineSha);
  // (b): D1 ran mechanically in the clone; D2 went to the Verifier in the same clone, fresh.
  assert.equal(calls.clones, 1);
  assert.ok(calls.commands.some((c) => c.command === "node --test test/notfound.test.js" && c.cwd === "/tmp/clone-1"));
  assert.equal(sent[4]!.opts?.cwd, "/tmp/clone-1");
  assert.equal(sent[4]!.opts?.fresh, true);
  assert.deepEqual(out.checks!.map((c) => [c.id, c.passed, c.how]), [["D1", true, "mechanical"], ["D2", true, "verifier"]]);
  // (c) fresh session; (d) written by the loop, lessons appended, consulted lesson confirmed.
  assert.equal(sent[5]!.opts?.fresh, true);
  assert.match(sent[5]!.prompt, /L-2026-09-18-01: not applicable/);
  assert.ok(calls.writes.includes(".polya/LOOKBACK.md"));
  assert.match(files[".polya/LOOKBACK.md"]!, /# Look back: unknown routes answer 404/);
  assert.match(files[".polya/LOOKBACK.md"]!, /\| D1 \| yes \|/);
  assert.match(files[".polya/LOOKBACK.md"]!, /## L-new-1\nTags:     kind:repair stage:devise/);
  assert.equal(lessons.added.length, 1);
  assert.deepEqual(lessons.confirmed, ["L-2026-09-18-01"]);
  assert.deepEqual(out.lookback, { written: true, lessons: 1, confirmed: 1 });
  assert.ok(calls.commits.includes("look back: LOOKBACK.md"));
});

test("understanding-incomplete: a PROBLEM.md with no done-checks gets one targeted retry, then stops", async () => {
  const { io } = makeIO({ files: { ".polya/PROBLEM.md": "# Problem: x\nKind: repair\n\n## Restated\nr\n" } });
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "understanding-incomplete");
  assert.deepEqual(sent.map((s) => s.kind), ["understand", "understand"]);
  assert.match(sent[1]!.prompt, /^## Understanding incomplete[\s\S]*no done-checks/);
  assert.match(out.stopDetail!, /test/);
});

test("plan-not-workable: a unit naming a test file under Touches is sent back once, then stops", async () => {
  const { io } = makeIO({ files: { ".polya/PLAN.md": PLAN_MD.replace("Touches:  src/app.js", "Touches:  src/app.js, test/notfound.test.js") } });
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "plan-not-workable");
  assert.deepEqual(sent.map((s) => s.kind), ["understand", "devise", "devise"]);
  assert.match(sent[2]!.prompt, /^## Plan not workable[\s\S]*U1: Touches: names test file/);
});

test("plan-not-workable: a suite that is already green means no Check is unmet", async () => {
  const { io } = makeIO({ commands: { "npm test": 0 } });
  const { send } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "plan-not-workable");
  assert.match(out.stopDetail!, /already green/);
});

test("unit gate: a failing gate feeds its findings back and the second attempt passes", async () => {
  const { io } = makeIO({ gates: [fail("quality-bar"), pass] });
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  const u1 = out.unitRecords.find((r) => r.id === "U1")!;
  assert.equal(u1.attempts, 2);
  assert.equal(u1.passed, true);
  assert.match(sent[3]!.prompt, /^## Quality gate failed \(attempt 1\)[\s\S]*quality-bar failed/);
  assert.match(sent[3]!.prompt, /# Carry out: unit U1/);
});

test("unit-gate-failed: the Hand's done:true is a claim; three failing gates stop the run", async () => {
  const { io } = makeIO({ gates: [fail("ownership"), fail("ownership"), fail("ownership")] });
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "unit-gate-failed");
  assert.equal(sent.filter((s) => s.kind === "carry-out").length, 3);
  assert.deepEqual(out.unitRecords[0]!.failing, ["ownership"]);
  assert.equal(polyaResumePhase(out), "carry-out");
});

test("unit-not-workable: a Hand that asks a question stops the run, drafts a candidate lesson, and resumes at devise with the question", async () => {
  const { io } = makeIO();
  const lessons = memLessons();
  const { send, sent } = makeSend({ "carry-out": (p) => (/unit U2/.test(p) ? json({ unit_id: "U2", done: false, blocked: true, question: "which README section?" }) : json({ unit_id: "U1", done: true })) });
  const out = await runPolyaLoop(send, { ...base, io, lessons });
  assert.equal(out.stopReason, "unit-not-workable");
  assert.match(out.stopDetail!, /U2 asked: which README section\?/);
  assert.equal(out.unitRecords.find((r) => r.id === "U2")!.question, "which README section?");
  assert.equal(lessons.added.length, 1);
  assert.match(lessons.added[0]!.lesson, /U2 was not workable/);
  assert.equal(polyaResumePhase(out), "devise");
  // Resume: the devise prompt carries the question; U1's record is kept.
  const { send: send2, sent: sent2 } = makeSend({});
  const again = await runPolyaLoop(send2, { ...base, io, lessons }, { ...out, phase: "devise", stopReason: undefined });
  assert.equal(again.stopReason, "complete");
  assert.match(sent2[0]!.prompt, /^## Re-plan[\s\S]*U2 asked: "which README section\?"/);
  // U1 passed before the question; it is kept, not re-run.
  assert.deepEqual(sent2.map((s) => s.kind), ["devise", "carry-out", "walk", "look-back"]);
  assert.match(sent2[1]!.prompt, /unit U2/);
  assert.equal(sent.length, 4);
});

test("look back (b): an unmet done-check gets one fix turn and a second run in a new clone", async () => {
  const { io, calls } = makeIO();
  const { send, sent } = makeSend({ walk: (_p, _o, n) => json({ results: [{ step: 2, d: "D2", passed: n === 1 ? false : true, evidence: n === 1 ? "no Run section" : "started", where: n === 1 ? "README.md" : undefined }] }) });
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  assert.equal(out.verifyAttempts, 2);
  assert.equal(calls.clones, 2);
  // The Solver got the evidence and wrote U3; the Hand carried out U3, not an orchestrator-written brief.
  const rep = sent.find((s) => /^# Devise a repair/m.test(s.prompt))!;
  assert.equal(rep.kind, "devise");
  assert.match(rep.prompt, /- D2: [\s\S]*Observed \(verifier\): no Run section\n  Where: README\.md/);
  assert.match(rep.prompt, /numbered from U3/);
  assert.ok(sent.some((s) => /# Carry out: unit U3/.test(s.prompt)));
  assert.ok(!sent.some((s) => /U-FIX/.test(s.prompt)));
  assert.deepEqual(out.units.map((u) => u.id), ["U1", "U2", "U3"]);
  assert.match(out.checks!.find((c) => c.id === "D2")!.evidence!, /started/);
});

test("verify-failed: still unmet after the fix turn and the second run", async () => {
  const { io } = makeIO();
  const { send } = makeSend({ walk: () => json({ results: [{ step: 2, d: "D2", passed: false, evidence: "nope" }] }) });
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "verify-failed");
  assert.match(out.stopDetail!, /D2/);
  assert.equal(polyaResumePhase(out), "look-back");
});

test("verifier silent twice → the fallback tier; silent again → unparseable-report", async () => {
  const { io } = makeIO();
  const { send, sent } = makeSend({ walk: (_p, o) => (o?.tier === "claude" ? json({ results: [{ step: 2, d: "D2", passed: true }] }) : "no block here") });
  const out = await runPolyaLoop(send, { ...base, io, lessons: null, verifyFallbackTier: "claude" });
  assert.equal(out.stopReason, "complete");
  const verifies = sent.filter((s) => s.kind === "walk");
  assert.equal(verifies.length, 3);
  assert.equal(verifies[2]!.opts?.tier, "claude");
  assert.match(verifies[1]!.prompt, /^## Your previous reply had no results block/);
  const { io: io2 } = makeIO();
  const { send: s2 } = makeSend({ walk: () => "nothing" });
  assert.equal((await runPolyaLoop(s2, { ...base, io: io2, lessons: null })).stopReason, "unparseable-report");
});

test("the Verifier is skipped when every done-check is a command", async () => {
  const problem = PROBLEM_MD.replace(/- D2:.*\n/, "");
  const plan = PLAN_MD.replace("Serves:   D2", "Serves:   D1");
  const { io } = makeIO({ files: { ".polya/PROBLEM.md": problem, ".polya/PLAN.md": plan } });
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  assert.ok(!sent.some((s) => s.kind === "walk"));
  assert.deepEqual(out.checks!.map((c) => c.how), ["mechanical"]);
});

test("finish check fails → one fix turn → re-check; still failing → finish-check-failed, and LOOKBACK.md is still written", async () => {
  const { io, calls, files } = makeIO({ gates: [pass, pass, fail("quality-bar"), fail("quality-bar"), fail("quality-bar"), fail("quality-bar")] });
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "finish-check-failed");
  assert.match(out.stopDetail!, /repair U3 failed the gate after 3 attempt/);
  assert.equal(sent.filter((s) => /# Carry out: unit U3/.test(s.prompt)).length, 3);
  assert.equal(calls.gate.filter((g) => g.kind === "finish").length, 1);
  assert.equal(out.unitRecords.find((r) => r.id === "U3")!.passed, false);
  // A fix turn that passes its gate gets the finish check run again.
  const { io: io2, calls: calls2 } = makeIO({ gates: [pass, pass, fail("quality-bar"), pass] });
  const ok = await runPolyaLoop(makeSend({}).send, { ...base, io: io2, lessons: null });
  assert.equal(ok.stopReason, "complete");
  assert.equal(calls2.gate.filter((g) => g.kind === "finish").length, 2);
  assert.ok(files[".polya/LOOKBACK.md"]);
  assert.match(files[".polya/LOOKBACK.md"]!, /Outcome: finish-check-failed/);
  assert.match(files[".polya/LOOKBACK.md"]!, /No lesson/);
});

test("review: a high finding gets one fix turn and its own check decides; a failing check is review-unresolved", async () => {
  const { io, files } = makeIO();
  const { send, sent } = makeSend({ "look-back": () => json({ verdict: "fix", answers_problem: true, findings: [{ severity: "high", where: "src/app.js", what: "the 404 body leaks the path", fix: "constant body", check: { command: "fail:grep", expect_exit: 0 } }], lessons: [] }) });
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "review-unresolved");
  assert.match(out.stopDetail!, /fail:grep -> 1, expected 0/);
  const rep = sent.find((s) => /^# Devise a repair/m.test(s.prompt))!;
  assert.match(rep.prompt, /- \[high\] src\/app\.js: the 404 body leaks the path\n  Suggested fix: constant body\n  Its check: `fail:grep` should exit 0/);
  assert.match(files[".polya/LOOKBACK.md"]!, /\[high\] src\/app\.js — the 404 body leaks the path/);
  // A passing check completes.
  const { io: io2 } = makeIO();
  const { send: s2 } = makeSend({ "look-back": () => json({ verdict: "fix", findings: [{ severity: "high", where: "src/app.js", what: "x", check: { command: "grep ok", expect_exit: 0 } }] }) });
  const ok = await runPolyaLoop(s2, { ...base, io: io2, lessons: null });
  assert.equal(ok.stopReason, "complete");
  assert.deepEqual(ok.reviewChecks, [{ command: "grep ok", expected: 0, actual: 0 }]);
});

test("review: the result does not answer the restated problem → review-unresolved without a fix turn", async () => {
  const { io } = makeIO();
  const { send, sent } = makeSend({ "look-back": () => json({ verdict: "stop", answers_problem: false, findings: [], lessons: [] }) });
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "review-unresolved");
  assert.match(out.stopDetail!, /done-checks were wrong/);
  assert.ok(!sent.some((s) => /^# Devise a repair/m.test(s.prompt)));
});

test("materialise: a Solver that only reports bare JSON gets a reminder, then PROBLEM.md is written from its report", async () => {
  const { io, calls } = makeIO();
  const report = { title: "unknown routes answer 404", kind: "repair", size: "S", restated: "the handler order is wrong", done: [{ id: "D1", text: "404", check: "node --test test/notfound.test.js" }, { id: "D2", text: "README works", check: "a stranger follows the README" }], bar: { test: "npm test" } };
  const { send, sent } = makeSend({ understand: () => JSON.stringify(report) });
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  assert.deepEqual(sent.slice(0, 2).map((s) => s.kind), ["understand", "understand"]);
  assert.match(sent[1]!.prompt, /^## You did not write \.polya\/PROBLEM\.md/);
  assert.ok(calls.writes.includes(".polya/PROBLEM.md"));
  assert.equal(out.problem!.done[0]!.command, "node --test test/notfound.test.js");
});

test("resume at carry-out re-attempts the unit that stopped and never re-runs understand or devise; PLAN.md on disk wins", async () => {
  const { io } = makeIO({ preload: true, files: { ".polya/PLAN.md": PLAN_MD.replace("## U2: document the start command", "## U2: document the start command (edited by hand)") } });
  const { send, sent } = makeSend({});
  const stale: PolyaState = { ...initialPolyaState(), phase: "carry-out", units: [], unitIndex: 1, unitRecords: [{ id: "U1", attempts: 1, passed: true }], baselineSha: "sha0" };
  const out = await runPolyaLoop(send, { ...base, io, lessons: null }, stale);
  assert.equal(out.stopReason, "complete");
  assert.deepEqual(sent.map((s) => s.kind), ["carry-out", "walk", "look-back"]);
  assert.match(sent[0]!.prompt, /edited by hand/);
  assert.equal(out.unitRecords.length, 2);
});

test("a unit marked Owner: strong is sent with tier claude", async () => {
  const { io } = makeIO({ files: { ".polya/PLAN.md": PLAN_MD.replace("Level:    L1:routes\nProduces: `src/app.js`", "Level:    L1:routes\nOwner:    strong\nProduces: `src/app.js`") } });
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  assert.equal(sent[2]!.opts?.tier, "claude");
  assert.equal(sent[3]!.opts?.tier, undefined);
});

test("polyaResumePhase: every stop reason maps to the stage that stopped", () => {
  const s = (stopReason: PolyaState["stopReason"], extra: Partial<PolyaState> = {}): PolyaState => ({ ...initialPolyaState(), phase: "stopped", stopReason, ...extra });
  assert.equal(polyaResumePhase(s("understanding-incomplete")), "understand");
  assert.equal(polyaResumePhase(s("plan-not-workable")), "devise");
  assert.equal(polyaResumePhase(s("unit-not-workable")), "devise");
  assert.equal(polyaResumePhase(s("unit-gate-failed")), "carry-out");
  assert.equal(polyaResumePhase(s("finish-check-failed")), "look-back");
  assert.equal(polyaResumePhase(s("verify-failed")), "look-back");
  assert.equal(polyaResumePhase(s("review-unresolved")), "look-back");
  assert.equal(polyaResumePhase(s("unparseable-report")), "understand");
  assert.equal(polyaResumePhase(s("unparseable-report", { problem: { title: "x" } as PolyaState["problem"] })), "devise");
  assert.equal(polyaResumePhase(s("unparseable-report", { units: [{ id: "U1" }] as PolyaState["units"], unitIndex: 1 })), "look-back");
  assert.equal(polyaResumePhase({ ...initialPolyaState(), phase: "devise" }), "devise");
});

test("browser: a unit that names a page is sent with browser:true when the run has one, told it is absent when not, and never asked for by a library unit", async () => {
  const plan = PLAN_MD.replace("Do:       1. Add a Run section naming `npm start`.", "Do:       1. Open the page and click the button named Save. 2. Add a Run section naming `npm start`.");
  const { io } = makeIO({ files: { ".polya/PLAN.md": plan } });
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null, browser: true });
  assert.equal(out.stopReason, "complete");
  const [u1, u2] = sent.filter((s) => s.kind === "carry-out");
  assert.equal(u1!.opts?.browser, undefined);
  assert.match(u1!.prompt, /no browser is attached/);
  assert.equal(u2!.opts?.browser, true);
  assert.match(u2!.prompt, /You have a real headless browser/);
  // The Verifier's D2 does not name a page here, so no browser for it.
  assert.equal(sent.find((s) => s.kind === "walk")!.opts?.browser, undefined);
  // Without a browser in the run, the unit is told so and is not sent the flag.
  const { io: io2 } = makeIO({ files: { ".polya/PLAN.md": plan } });
  const { send: s2, sent: sent2 } = makeSend({});
  await runPolyaLoop(s2, { ...base, io: io2, lessons: null });
  const u2b = sent2.filter((s) => s.kind === "carry-out")[1]!;
  assert.equal(u2b.opts?.browser, undefined);
  assert.match(u2b.prompt, /No browser tool is available in this run/);
});

test("browser: a prose done-check that names a page sends the Verifier with browser:true", async () => {
  const problem = PROBLEM_MD.replace("Check: a stranger follows the README and the app starts", "Check: a stranger opens the page in a browser and clicks Start");
  const { io } = makeIO({ files: { ".polya/PROBLEM.md": problem } });
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null, browser: true });
  assert.equal(out.stopReason, "complete");
  const v = sent.find((s) => s.kind === "walk")!;
  assert.equal(v.opts?.browser, true);
  assert.equal(v.opts?.cwd, "/tmp/clone-1");
  assert.match(v.prompt, /browser_navigate/);
});


test("look back (b): a done-check that curls localhost starts the bar's start command in the clone and stops it after", async () => {
  const problem = PROBLEM_MD.replace("- D1: GET /nope answers 404 — Check: `node --test test/notfound.test.js` — Now: unmet", "- D1: GET /nope answers 404 — Check: `test \"$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/nope)\" = 404` — Now: unmet");
  const started: { command: string; cwd: string; stopped: boolean }[] = [];
  const { io, calls } = makeIO({ files: { ".polya/PROBLEM.md": problem } });
  io.start = async (command, cwd) => {
    const rec = { command, cwd, stopped: false };
    started.push(rec);
    return { stop: () => { rec.stopped = true; } };
  };
  const { send } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  assert.deepEqual(started, [{ command: "npm start", cwd: "/tmp/clone-1", stopped: true }]);
  const check = calls.commands.find((c) => c.command.startsWith("test \"$(curl"));
  assert.equal(check?.cwd, "/tmp/clone-1");
  // Without a server-shaped check, nothing is started.
  const { io: io2 } = makeIO();
  let startedAgain = false;
  io2.start = async () => { startedAgain = true; return { stop: () => {} }; };
  await runPolyaLoop(makeSend({}).send, { ...base, io: io2, lessons: null });
  assert.equal(startedAgain, false);
});

test("look back (d): a \"No lesson\" entry stays in LOOKBACK.md and is not appended to the ledger", async () => {
  const { io, files } = makeIO();
  const lessons = memLessons();
  const { send } = makeSend({ "look-back": () => json({ verdict: "done", findings: [], lessons: [{ tags: ["kind:repair"], when: "w", lesson: "No lesson: the plan held.", evidence: "e" }] }) });
  const out = await runPolyaLoop(send, { ...base, io, lessons });
  assert.equal(out.stopReason, "complete");
  assert.equal(lessons.added.length, 0);
  assert.equal(out.lookback?.lessons, 0);
  assert.match(files[".polya/LOOKBACK.md"]!, /No lesson: the plan held/);
});


test("a PROBLEM.md or PLAN.md already on disk and workable skips the Solver turn; a re-plan note does not", async () => {
  const { io } = makeIO({ preload: true });
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  assert.deepEqual(sent.map((s) => s.kind), ["carry-out", "carry-out", "walk", "look-back"]);
  // A plan on disk with a gap still gets the (one) Solver turn.
  const { io: io2 } = makeIO({ preload: true, files: { ".polya/PLAN.md": PLAN_MD.replace("Given:    `src/app.js`; the red test `test/notfound.test.js`", "Given:") } });
  const { send: s2, sent: sent2 } = makeSend({});
  await runPolyaLoop(s2, { ...base, io: io2, lessons: null });
  assert.equal(sent2[0]!.kind, "devise");
  assert.match(sent2[0]!.prompt, /^## Plan not workable/);
  // A resume after a Hand's question always re-plans.
  const { io: io3 } = makeIO({ preload: true });
  const { send: s3, sent: sent3 } = makeSend({});
  await runPolyaLoop(s3, { ...base, io: io3, lessons: null }, { phase: "devise", replanNote: "U2 asked: which?", unitRecords: [{ id: "U1", attempts: 1, passed: true }] });
  assert.equal(sent3[0]!.kind, "devise");
  assert.match(sent3[0]!.prompt, /^## Re-plan/);
});

test("ownership failure: the orchestrator reverts what the Hand wrote outside Touches and tells it", async () => {
  const { io } = makeIO({ gates: [fail("ownership"), pass] });
  const reverts: { base?: string; allowed: string[] }[] = [];
  io.revertOutside = (base, allowed) => {
    reverts.push({ base, allowed });
    return ["src/main.ts"];
  };
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  assert.deepEqual(reverts, [{ base: "sha2", allowed: ["src/app.js"] }]);
  assert.match(sent[3]!.prompt, /^## Files outside Touches were reverted\n\nThe orchestrator put src\/main\.ts back/);
  assert.match(sent[3]!.prompt, /## Quality gate failed \(attempt 1\)/);
  assert.equal(out.unitRecords[0]!.attempts, 2);
});

test("look back: a stale LOOKBACK.md from an earlier pass is cleared first; a high finding about the record spawns no fix turn", async () => {
  const { io, calls, files } = makeIO({ preload: true, files: { ".polya/LOOKBACK.md": "# Look back: old\n\nOutcome: verify-failed\n" } });
  const { send, sent } = makeSend({ "look-back": () => json({ verdict: "done", answers_problem: true, findings: [{ severity: "high", where: ".polya/LOOKBACK.md", what: "the record says verify-failed", check: { command: "grep -q done LOOKBACK.md", expect_exit: 0 } }], lessons: [] }) });
  const out = await runPolyaLoop(send, { ...base, io, lessons: null }, { phase: "look-back", units: parsePlan(PLAN_MD).units, unitRecords: [{ id: "U1", attempts: 1, passed: true }, { id: "U2", attempts: 1, passed: true }], baselineSha: "sha0" });
  assert.equal(out.stopReason, "complete");
  assert.ok(calls.commits.includes("look back: clear the previous pass's LOOKBACK.md"));
  assert.ok(!sent.some((s) => /^# Devise a repair/m.test(s.prompt)), "no repair for a finding about the record");
  assert.equal(out.reviewChecks, undefined);
  assert.match(files[".polya/LOOKBACK.md"]!, /\[high\] \.polya\/LOOKBACK\.md — the record says verify-failed/);
  assert.match(files[".polya/LOOKBACK.md"]!, /Outcome: complete/);
});

test("a Hand turn that rewrote history is discarded and retried; the gate never sees it", async () => {
  const { io, calls } = makeIO();
  let turns = 0;
  const resets: string[] = [];
  io.isAncestor = () => turns !== 1; // the first U1 turn rebased
  io.resetTo = (sha) => resets.push(sha);
  const { send, sent } = makeSend({ "carry-out": (p) => { if (/unit U1/.test(p)) turns++; return json({ unit_id: p.match(/unit (U\d+)/)?.[1], done: true }); } });
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  assert.equal(out.unitRecords.find((r) => r.id === "U1")!.attempts, 2);
  assert.deepEqual(resets, ["sha2"]);
  assert.match(sent[3]!.prompt, /rewrote git history/);
  // Only one task gate ran for U1: the discarded turn was never judged.
  assert.equal(calls.gate.filter((g) => g.kind === "task" && g.allowed?.includes("src/app.js")).length, 1);
});

test("understand removes the kit's unmodified seeded AGENTS.md and QWEN.md; a person's AGENTS.md stays", async () => {
  const seededAgents = "# AGENTS.md\n\n<!--\nCopy this file to the root of any repository you want cloud agents to work on,\n-->\n";
  const seededQwen = "@AGENTS.md\n\n## Orchestrator quality gate\n\nrules\n";
  const { io, files, calls } = makeIO({ files: { "AGENTS.md": seededAgents, "QWEN.md": seededQwen } });
  const out = await runPolyaLoop(makeSend({}).send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  assert.equal(files["AGENTS.md"], undefined);
  assert.equal(files["QWEN.md"], undefined);
  assert.ok(calls.commits.some((c) => /remove the kit's seeded AGENTS\.md and QWEN\.md/.test(c)));
  const mine = "# AGENTS.md\n\nThis repo: run npm test.\n";
  const { io: io2, files: f2 } = makeIO({ files: { "AGENTS.md": mine } });
  await runPolyaLoop(makeSend({}).send, { ...base, io: io2, lessons: null });
  assert.equal(f2["AGENTS.md"], mine);
});

test("the artifacts live under .polya/, and a unit whose Touches names .polya/ is not workable", async () => {
  const { io, files } = makeIO();
  await runPolyaLoop(makeSend({}).send, { ...base, io, lessons: null });
  assert.ok(files[".polya/PROBLEM.md"] && files[".polya/PLAN.md"] && files[".polya/LOOKBACK.md"]);
  assert.equal(files["PROBLEM.md"], undefined);
  const { io: io2 } = makeIO({ files: { ".polya/PLAN.md": PLAN_MD.replace("Touches:  src/app.js", "Touches:  src/app.js, .polya/notes.md") } });
  const out = await runPolyaLoop(makeSend({}).send, { ...base, io: io2, lessons: null });
  assert.equal(out.stopReason, "plan-not-workable");
  assert.match(out.stopDetail!, /plan artifact/);
});

test("the Verifier walks prose done-checks two per turn, each batch in the same clone, a silent batch falling back alone", async () => {
  const problem = PROBLEM_MD.replace(
    "- D2: a stranger can start the app from the README — Check: a stranger follows the README and the app starts — Now: unmet",
    ["D2", "D3", "D4", "D5", "D6"].map((id) => `- ${id}: ${id} holds — Check: a stranger observes ${id} — Now: unmet`).join("\n"),
  );
  const plan = PLAN_MD.replace("Serves:   D2", "Serves:   D2 D3 D4 D5 D6");
  const { io } = makeIO({ files: { ".polya/PROBLEM.md": problem, ".polya/PLAN.md": plan } });
  const { send, sent } = makeSend({
    walk: (p, o) => {
      const ids = [...p.matchAll(/^- (D\d+): D\d+ holds/gm)].map((m) => m[1]!);
      // The second batch's local turns stay silent; its frontier fallback reports.
      if (ids.includes("D4") && o?.tier !== "claude") return "no block";
      return json({ results: ids.map((d, i) => ({ step: i + 1, d, passed: true, evidence: `saw ${d}` })) });
    },
  });
  const out = await runPolyaLoop(send, { ...base, io, lessons: null, verifyFallbackTier: "claude" });
  assert.equal(out.stopReason, "complete");
  const walks = sent.filter((s) => s.kind === "walk");
  // Three batches (D2 D3 | D4 D5 | D6); batch 2 took two local tries and one fallback.
  assert.equal(walks.length, 5);
  assert.deepEqual(walks.map((w) => w.opts?.tier ?? "local"), ["local", "local", "local", "claude", "local"]);
  assert.ok(walks.every((w) => w.opts?.cwd === "/tmp/clone-1"));
  assert.doesNotMatch(walks[0]!.prompt, /D4 holds/);
  assert.deepEqual(out.checks!.filter((c) => c.how === "verifier").map((c) => c.id), ["D2", "D3", "D4", "D5", "D6"]);
});

test("look back (d): the ledger takes at most two lessons per run; the rest, and any without a When, stay in LOOKBACK.md labelled", async () => {
  const { io, files } = makeIO();
  const lessons = memLessons();
  const l = (n: number, when = "w") => ({ tags: ["kind:repair"], when, lesson: `lesson number ${n}`, evidence: "e" });
  const { send } = makeSend({ "look-back": () => json({ verdict: "done", findings: [], lessons: [l(1), l(2, ""), l(3), l(4)] }) });
  const out = await runPolyaLoop(send, { ...base, io, lessons });
  assert.equal(out.stopReason, "complete");
  assert.deepEqual(lessons.added.map((x) => x.lesson), ["lesson number 1", "lesson number 3"]);
  assert.equal(out.lookback?.lessons, 2);
  const lb = files[".polya/LOOKBACK.md"]!;
  assert.match(lb, /## L-new-1\n[\s\S]*lesson number 1/);
  assert.match(lb, /## \(not appended: no When\)\n[\s\S]*lesson number 2/);
  assert.match(lb, /## \(not appended: over the per-run cap\)\n[\s\S]*lesson number 4/);
});

test("oracle on: the understand prompt carries the checklist, and a PROBLEM.md without dispositions gets the targeted retry", async () => {
  const { io } = makeIO();
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null, oracle: true });
  assert.match(sent[0]!.prompt, /## Oracle: cases a done-check list forgets/);
  assert.match(sent[1]!.prompt, /^## Understanding incomplete[\s\S]*O1 has no disposition/);
  assert.equal(out.stopReason, "understanding-incomplete");
  const { sent: off } = makeSend({});
  const { send: s2, sent: sent2 } = makeSend({});
  await runPolyaLoop(s2, { ...base, io: makeIO().io, lessons: null });
  assert.doesNotMatch(sent2[0]!.prompt, /## Oracle/);
  void off;
});

test("look back (b): a check that starts its own server runs before the loop starts the app; runCheck is used when present", async () => {
  const problem = PROBLEM_MD.replace(
    "- D1: GET /nope answers 404 — Check: `node --test test/notfound.test.js` — Now: unmet",
    "- D1: GET /nope answers 404 — Check: `test \"$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/nope)\" = 404` — Now: unmet\n- D3: npm run dev serves — Check: `git clone . scratch && cd scratch && npm ci && npm run dev & sleep 2; test \"$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4571/)\" = 200` — Now: unmet",
  );
  const order: string[] = [];
  const { io } = makeIO({ files: { ".polya/PROBLEM.md": problem, ".polya/PLAN.md": PLAN_MD.replace("Serves:   D2", "Serves:   D2 D3") } });
  io.start = async () => {
    order.push("app started");
    return { stop: () => order.push("app stopped") };
  };
  io.runCheck = async (command) => {
    order.push(/npm run dev/.test(command) ? "D3 (self-serving)" : "D1 (curl)");
    return { code: 0, output: "ok" };
  };
  const out = await runPolyaLoop(makeSend({}).send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  assert.deepEqual(order, ["D3 (self-serving)", "app started", "D1 (curl)", "app stopped"]);
  // PROBLEM.md in this test lists D1, D3, D2; results follow that order.
  assert.deepEqual(out.checks!.map((c) => c.id), ["D1", "D3", "D2"]);
});

test("look back (b): a bar with no start falls back to the repo's npm start for checks that curl the app (live R0)", async () => {
  const problem = PROBLEM_MD.replace("| start | `npm start` |\n", "").replace(
    "- D1: GET /nope answers 404 — Check: `node --test test/notfound.test.js` — Now: unmet",
    "- D1: GET /nope answers 404 — Check: `test \"$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/nope)\" = 404` — Now: unmet",
  );
  const started: string[] = [];
  const { io } = makeIO({ files: { ".polya/PROBLEM.md": problem, "package.json": '{ "scripts": { "start": "node src/server.js", "test": "node --test" } }' } });
  io.start = async (command) => {
    started.push(command);
    return { stop: () => {} };
  };
  const out = await runPolyaLoop(makeSend({}).send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "complete");
  assert.equal(out.problem!.bar.start, undefined);
  assert.deepEqual(started, ["npm start"]);
});

test("repair: the Solver may say the check is wrong; an unworkable repair gets one retry; a repair Check that already passes measures nothing", async () => {
  const failing = () => json({ results: [{ step: 2, d: "D2", passed: false, evidence: "nope" }] });
  // The Solver says the check itself is wrong: no unit, a stop that names why.
  const { io } = makeIO();
  const { send, sent } = makeSend({ walk: failing, devise: (p) => (/^# Devise a repair/m.test(p) ? json({ units: [], check_wrong: true, notes: "D2 asks for a port the problem never names" }) : (defaultDevise(p))) });
  const out = await runPolyaLoop(send, { ...base, io, lessons: null });
  assert.equal(out.stopReason, "verify-failed");
  assert.match(out.stopDetail!, /the check is wrong, not the product: D2 asks for a port/);
  assert.ok(!sent.some((s) => /# Carry out: unit U3/.test(s.prompt)));
  // A repair unit with a decision in it is sent back once, then the run stops.
  const { io: io2 } = makeIO();
  const bad = (p: string) => {
    if (!/^# Devise a repair/m.test(p)) return defaultDevise(p);
    const plan = currentIO!.readFile(".polya/PLAN.md")!;
    currentIO!.writeFile(".polya/PLAN.md", `${plan}\n\n## Repairs\n\n## U3: repair\nServes:   D2\nProduces: x\nGiven:    y\nDo:       1. Choose the best fix.\nTouches:  src/app.js\nCheck:    \`node --test test/notfound.test.js\`\nDepends:  none\nNot:      z\n`);
    return json({ units: ["U3"] });
  };
  const { send: s2, sent: sent2 } = makeSend({ walk: failing, devise: bad });
  const out2 = await runPolyaLoop(s2, { ...base, io: io2, lessons: null });
  assert.equal(out2.stopReason, "verify-failed");
  assert.match(out2.stopDetail!, /repair not workable: .*"Choose"/);
  assert.equal(sent2.filter((s) => /^## Repair not workable/m.test(s.prompt)).length, 1);
  // A repair whose Check already passes measures nothing.
  const { io: io3 } = makeIO();
  const green = (p: string) => {
    if (!/^# Devise a repair/m.test(p)) return defaultDevise(p);
    const plan = currentIO!.readFile(".polya/PLAN.md")!;
    currentIO!.writeFile(".polya/PLAN.md", `${plan}\n\n## Repairs\n\n## U3: repair\nServes:   D2\nProduces: x\nGiven:    y\nDo:       1. Edit src/app.js.\nTouches:  src/app.js\nCheck:    \`node --test test/notfound.test.js\`\nDepends:  none\nNot:      z\n`);
    return json({ units: ["U3"] });
  };
  const out3 = await runPolyaLoop(makeSend({ walk: failing, devise: green }).send, { ...base, io: io3, lessons: null });
  assert.equal(out3.stopReason, "verify-failed");
  assert.match(out3.stopDetail!, /U3's Check already passes; it measures nothing/);
});

test("look back: an unfinished unit runs before the finish check, and the Solver's repair test is allowed there", async () => {
  const plan = `${PLAN_MD}\n\n## Repairs\n\n## U3: repair\nServes:   D1\nProduces: x\nGiven:    y\nDo:       1. Fix src/app.js.\nTouches:  src/app.js\nCheck:    \`node --test test/repair.red-until-fixed.test.js\`\nDepends:  none\nNot:      z\n`;
  const { io, calls } = makeIO({ preload: true, files: { ".polya/PLAN.md": plan } });
  const { send, sent } = makeSend({});
  const out = await runPolyaLoop(send, { ...base, io, lessons: null }, {
    phase: "look-back",
    units: parsePlan(plan).units,
    unitRecords: [{ id: "U1", attempts: 1, passed: true }, { id: "U2", attempts: 1, passed: true }, { id: "U3", attempts: 3, passed: false }],
    baselineSha: "sha0",
    solverFiles: ["test/repair.red-until-fixed.test.js"],
  });
  assert.equal(out.stopReason, "complete");
  assert.ok(sent.some((s) => /# Carry out: unit U3/.test(s.prompt)), "the unfinished repair unit ran first");
  assert.equal(out.unitRecords.find((r) => r.id === "U3")!.passed, true);
  const finish = calls.gate.find((g) => g.kind === "finish")!;
  assert.ok(finish.allowed!.includes("test/repair.red-until-fixed.test.js"), finish.allowed!.join(", "));
  assert.ok(finish.allowed!.includes("src/app.js"));
});


test("a unit's gate skips an earlier unit's hash Check for a file this unit may change (live R0, U3 vs U7)", async () => {
  const hashApp = `node -e "const h=require('crypto').createHash('sha256').update(require('fs').readFileSync('src/app.js')).digest('hex');if(h!=='abc'){process.exit(1)}"`;
  const plan = PLAN_MD.replace("Check:    `node --test test/notfound.test.js`", `Check:    \`${hashApp}\``);
  const { io, calls } = makeIO({ preload: true, files: { ".polya/PLAN.md": `${plan}\n\n## Repairs\n\n## U3: repair the saved file\nServes:   D1\nProduces: x\nGiven:    y\nDo:       1. Edit src/app.js.\nTouches:  src/app.js\nCheck:    \`node --test test/repair.red-until-fixed.test.js\`\nDepends:  none\nNot:      z\n` } });
  const out = await runPolyaLoop(makeSend({}).send, { ...base, io, lessons: null }, {
    phase: "look-back",
    units: parsePlan(`${plan}\n\n## Repairs\n\n## U3: repair the saved file\nServes:   D1\nProduces: x\nGiven:    y\nDo:       1. Edit src/app.js.\nTouches:  src/app.js\nCheck:    \`node --test test/repair.red-until-fixed.test.js\`\nDepends:  none\nNot:      z\n`).units,
    unitRecords: [{ id: "U1", attempts: 1, passed: true }, { id: "U2", attempts: 1, passed: true }, { id: "U3", attempts: 1, passed: false }],
    baselineSha: "sha0",
  });
  assert.equal(out.stopReason, "complete");
  const u3gate = calls.gate.find((g) => g.kind === "task" && g.allowed?.includes("src/app.js"))!;
  assert.ok(!u3gate.taskCommands!.some((c) => c.includes("createHash")), `U1's hash of src/app.js must not run for U3: ${u3gate.taskCommands!.join(" | ")}`);
  assert.ok(u3gate.taskCommands!.includes("node --test test/repair.red-until-fixed.test.js"));
  // A hash Check for a file this unit cannot touch still runs.
  assert.ok(calls.gate.some((g) => g.kind === "task" && (g.taskCommands ?? []).some((c) => c.includes("createHash")) === false));
});
