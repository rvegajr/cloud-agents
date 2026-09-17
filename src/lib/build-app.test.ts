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
