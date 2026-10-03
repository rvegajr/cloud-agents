import assert from "node:assert/strict";
import { test } from "node:test";
import { exitCodeForStopReason, runBuildApp } from "./build-app.js";

test("exitCodeForStopReason matches the build-app CLI contract", () => {
  assert.equal(exitCodeForStopReason("complete"), 0);
  assert.equal(exitCodeForStopReason("blocked"), 3);
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
