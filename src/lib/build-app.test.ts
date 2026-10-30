import assert from "node:assert/strict";
import { test } from "node:test";
import { exitCodeForStopReason, MAX_REQUESTER_NOTE, planGateResumeError, planGateUsageError, printBuildResult, readRequesterNote, runBuildApp, saveBuildRecord, type BuildRecord } from "./build-app.js";
import { initialPolyaState } from "../../polya-craft/src/polya-loop.js";

test("exitCodeForStopReason matches the build-app CLI contract", () => {
  assert.equal(exitCodeForStopReason("complete"), 0);
  assert.equal(exitCodeForStopReason("blocked"), 3);
  assert.equal(exitCodeForStopReason("plan-ready"), 3);
  assert.equal(exitCodeForStopReason("run-failed"), 2);
  assert.equal(exitCodeForStopReason("startup-failed"), 2);
  assert.equal(exitCodeForStopReason("stalled"), 4);
});

test("runBuildApp require-cursor-app fails before Agent.create", async () => {
  const result = await runBuildApp({
    idea: "A tiny CLI.",
    createRepo: "farm-probe",
    createRepoFn: () => "https://github.com/acme/farm-probe",
    grantCursorApp: async () => ({ status: "missing-app" }),
    cursorApp: "require",
    log: () => {},
  });
  assert.equal(result.stopReason, "startup-failed");
  assert.equal(result.repo, "https://github.com/acme/farm-probe");
  assert.equal(result.grant?.status, "missing-app");
  assert.match(result.error ?? "", /No Cursor GitHub App/);
});

test("closeDeciderCost: the decision model is its own meter, cumulative across resumes, silent at zero", async () => {
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { closeDeciderCost } = await import("./build-app.js");
  const stateDir = mkdtempSync(join(tmpdir(), "decider-cost-"));
  const record = { agentId: "cc-test", repo: "https://github.com/me/app", ref: "main", idea: "x", state: {} as never, updatedAt: "" };
  const first = closeDeciderCost(record, stateDir, "build-app", [{ meter: "typesafe:billed", cents: 0.5, inputTokens: 119_048, calls: 40 }]);
  assert.equal(first.length, 1);
  assert.match(first[0]!, /^COST decider: \$0\.0050 this run, \$0\.0050 this job {2}Typesafe billed \(119,048 input tokens, 40 calls\)$/);
  const resumed = closeDeciderCost(record, stateDir, "build-app", [{ meter: "typesafe:billed", cents: 0.25, inputTokens: 1, calls: 1 }]);
  assert.match(resumed[0]!, /\$0\.0025 this run, \$0\.0075 this job/);
  assert.deepEqual(closeDeciderCost(record, stateDir, "build-app", [{ meter: "liquid:billed", cents: 0, inputTokens: 900, calls: 3 }]), [], "a free meter prints nothing");
  const ledger = readFileSync(join(stateDir, "cost-ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(ledger.map((e) => [e.meter, e.cents, e.agentId]), [["typesafe:billed", 0.5, "cc-test"], ["typesafe:billed", 0.75, "cc-test"]]);
});

test("plan gate flags: what each needs among the others, before anything is cloned", () => {
  assert.equal(planGateUsageError({ planGate: true }, "polya"), undefined);
  assert.equal(planGateUsageError({ resume: "cc-1", approve: true }, "milestone"), undefined);
  assert.equal(planGateUsageError({ resume: "cc-1", noteFile: "n.md" }, "milestone"), undefined);
  assert.match(planGateUsageError({ planGate: true }, "blueprint")!, /^usage: --plan-gate needs --loop polya/);
  assert.match(planGateUsageError({ planGate: true, resume: "cc-1" }, "polya")!, /^usage: --plan-gate starts a new run/);
  assert.match(planGateUsageError({ approve: true }, "polya")!, /^usage: --approve needs --resume/);
  assert.match(planGateUsageError({ noteFile: "n.md" }, "polya")!, /^usage: --note-file needs --resume/);
  assert.match(planGateUsageError({ resume: "cc-1", approve: true, noteFile: "n.md" }, "polya")!, /do not go together/);
});

test("plan gate flags against the run: --approve only at plan-ready, a note only where Understand or Devise runs next", () => {
  const run = (polya: Partial<BuildRecord["polya"]> | undefined, loop: BuildRecord["loop"] = "polya"): Pick<BuildRecord, "agentId" | "loop" | "polya"> => ({ agentId: "cc-1", loop, polya: polya && { ...initialPolyaState(), ...polya } });
  const ready = run({ phase: "stopped", stopReason: "plan-ready", planGate: true });
  assert.equal(planGateResumeError(ready, {}), undefined);
  assert.equal(planGateResumeError(ready, { approve: true }), undefined);
  assert.equal(planGateResumeError(ready, { noteFile: "n.md" }), undefined);
  assert.equal(planGateResumeError(run({ phase: "stopped", stopReason: "understanding-incomplete" }), { noteFile: "n.md" }), undefined);
  assert.equal(planGateResumeError(run({ phase: "stopped", stopReason: "unit-not-workable", units: [{ id: "U1" }] as never }), { noteFile: "n.md" }), undefined);
  assert.match(planGateResumeError(run({ phase: "stopped", stopReason: "plan-not-workable" }), { approve: true })!, /not waiting for approval \(plan-not-workable\)/);
  assert.match(planGateResumeError(run({ phase: "stopped", stopReason: "unit-gate-failed" }), { noteFile: "n.md" })!, /resumes at carry-out; a note reaches only Understand or Devise/);
  assert.match(planGateResumeError(run(undefined, "milestone"), { approve: true })!, /cc-1 is not a polya run/);
});

test("readRequesterNote: trimmed; empty, unreadable or too long is a usage error", () => {
  assert.deepEqual(readRequesterNote("n.md", () => "  merge U1 and U2\n"), { note: "merge U1 and U2" });
  assert.match((readRequesterNote("n.md", () => " \n") as { error: string }).error, /^usage: --note-file n.md is empty/);
  assert.match((readRequesterNote("n.md", () => { throw new Error("ENOENT"); }) as { error: string }).error, /^usage: --note-file n.md: cannot read it/);
  assert.match((readRequesterNote("n.md", () => "x".repeat(MAX_REQUESTER_NOTE + 1)) as { error: string }).error, /keep it under 4000/);
});

test("runBuildApp: --approve on a run that is not waiting stops before its workspace is touched", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const stateDir = mkdtempSync(join(tmpdir(), "plan-gate-"));
  const record: BuildRecord = {
    agentId: "cc-00000000-0000-4000-8000-000000000001",
    repo: "https://github.com/acme/app",
    ref: "main",
    idea: "a problem",
    engine: "hybrid",
    loop: "polya",
    state: { phase: "spec", iteration: 0, runIds: [], history: [] },
    polya: { ...initialPolyaState(), phase: "stopped", stopReason: "unit-gate-failed", units: [{ id: "U1" }] as never },
    updatedAt: new Date().toISOString(),
  };
  saveBuildRecord(record, stateDir);
  const approve = await runBuildApp({ resume: record.agentId, approve: true, stateDir, log: () => {} });
  assert.equal(approve.stopReason, "startup-failed");
  assert.match(approve.error!, /is not waiting for approval \(unit-gate-failed\)/);
  const usage = await runBuildApp({ idea: "x", repo: "https://github.com/acme/app", loop: "milestone", planGate: true, stateDir, log: () => {} });
  assert.match(usage.error!, /^usage: --plan-gate needs --loop polya/);
});

test("printBuildResult: a plan-ready run names the plan and the two ways on; other planning stops offer a note", () => {
  const lines: string[] = [];
  const polya = { ...initialPolyaState(), phase: "stopped" as const, stopReason: "plan-ready" as const, stopDetail: "2 unit(s) planned and checked; nothing is built until the requester approves" };
  printBuildResult({ agentId: "cc-1", engine: "hybrid", stopReason: "plan-ready", polya }, (l) => lines.push(l));
  const out = lines.join("\n");
  assert.match(out, /RESULT: plan-ready/);
  assert.match(out, /\.runs\/polya-cc-1\/PLAN\.md/);
  assert.match(out, /Build it: {3}npm run build-app -- --resume cc-1 --approve/);
  assert.match(out, /Change it: {2}npm run build-app -- --resume cc-1 --note-file <note\.md>/);
  assert.doesNotMatch(out, /Resume with/);
  const other: string[] = [];
  printBuildResult({ agentId: "cc-2", engine: "hybrid", stopReason: "plan-not-workable", polya: { ...polya, stopReason: "plan-not-workable" } }, (l) => other.push(l));
  assert.match(other.join("\n"), /Resume with: npm run build-app -- --resume cc-2\nOr answer it: npm run build-app -- --resume cc-2 --note-file <note\.md>/);
  const gate: string[] = [];
  printBuildResult({ agentId: "cc-3", engine: "hybrid", stopReason: "unit-gate-failed", polya: { ...polya, stopReason: "unit-gate-failed" } }, (l) => gate.push(l));
  assert.doesNotMatch(gate.join("\n"), /--note-file/);
});
