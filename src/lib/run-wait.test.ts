import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunResult } from "@cursor/sdk";
import { isStreamLoss, waitForRun } from "./run-wait.js";

const lost: RunResult = { id: "r1", status: "error", error: { message: "Run stream is no longer available", code: "stream_unavailable" } };
const done: RunResult = { id: "r1", status: "finished", result: "M2 complete" };
const realError: RunResult = { id: "r1", status: "error", error: { message: "boom", code: "internal" } };

function run(first: RunResult) {
  return { id: "r1", agentId: "bc-1", wait: async () => first };
}

test("a finished run is returned without re-attaching", async () => {
  let fetched = 0;
  const r = await waitForRun(run(done), { getRun: async () => (fetched++, { wait: async () => done }), delayMs: 0 });
  assert.equal(r.status, "finished");
  assert.equal(fetched, 0);
});

test("a lost stream re-attaches and returns the run's real result", async () => {
  const calls: string[] = [];
  const r = await waitForRun(run(lost), {
    getRun: async (runId, agentId) => (calls.push(`${runId}@${agentId}`), { wait: async () => done }),
    delayMs: 0,
  });
  assert.equal(r.status, "finished");
  assert.equal(r.result, "M2 complete");
  assert.deepEqual(calls, ["r1@bc-1"]);
});

test("a real error is not retried", async () => {
  let fetched = 0;
  const r = await waitForRun(run(realError), { getRun: async () => (fetched++, { wait: async () => done }), delayMs: 0 });
  assert.equal(r.error?.code, "internal");
  assert.equal(fetched, 0);
});

test("re-attach is bounded and survives getRun throwing", async () => {
  let fetched = 0;
  const logs: string[] = [];
  const r = await waitForRun(run(lost), {
    getRun: async () => {
      fetched++;
      if (fetched === 1) throw new Error("network");
      return { wait: async () => lost };
    },
    retries: 3,
    delayMs: 0,
    log: (l) => logs.push(l),
  });
  assert.ok(isStreamLoss(r));
  assert.equal(fetched, 3);
  assert.ok(logs.some((l) => l.includes("re-attach failed: network")));
});
