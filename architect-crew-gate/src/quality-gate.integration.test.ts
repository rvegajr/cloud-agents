import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultExec } from "../../src/lib/engine-local.js";
import { gateConfigFromEnv, runQualityGate } from "./quality-gate.js";

/**
 * Runs real `npm`/`git` subprocesses against a throwaway fixture repo. No
 * network beyond `npm ci` against the local cache, no model in the loop.
 */

function makeFixtureRepo(opts: { vacuousTest?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-fixture-"));
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "test"), { recursive: true });
  writeFileSync(
    join(dir, "src", "app.js"),
    `export function greet(name) {\n  if (!name) throw new Error("name required");\n  return \`hello, \${name}\`;\n}\n`,
  );
  const testBody = opts.vacuousTest
    ? `import assert from "node:assert/strict";\nimport { test } from "node:test";\n\ntest("does not throw", () => {\n  assert.equal(1, 1);\n});\n`
    : `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { greet } from "../src/app.js";\n\ntest("greets", () => {\n  assert.equal(greet("world"), "hello, world");\n});\n`;
  writeFileSync(join(dir, "test", "app.test.js"), testBody);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      { name: "fixture", version: "0.0.0", private: true, type: "module", scripts: { test: "node --test test/*.test.js" } },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=fixture@test", "-c", "user.name=fixture", "commit", "-q", "-m", "initial"]);
  return dir;
}

test("runQualityGate passes on a clean fixture", async () => {
  const dir = makeFixtureRepo();
  try {
    const cfg = { ...gateConfigFromEnv({}), startEvery: 0, vacuous: "" as const };
    const result = await runQualityGate(dir, cfg, "iterate", { exec: defaultExec });
    assert.equal(result.passed, true, JSON.stringify(result.findings, null, 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runQualityGate hygiene fails when .qwen/ is committed", async () => {
  const dir = makeFixtureRepo();
  try {
    mkdirSync(join(dir, ".qwen", "pending-skills"), { recursive: true });
    writeFileSync(join(dir, ".qwen", "pending-skills", "x.md"), "junk");
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["-c", "user.email=fixture@test", "-c", "user.name=fixture", "commit", "-q", "-m", "add junk"], {
      cwd: dir,
      stdio: "ignore",
    });
    const cfg = { ...gateConfigFromEnv({}), startEvery: 0, vacuous: "" as const };
    const result = await runQualityGate(dir, cfg, "iterate", { exec: defaultExec });
    assert.equal(result.passed, false);
    assert.equal(result.findings.some((f) => f.rule === "hygiene" && !f.ok && f.detail.includes(".qwen")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runQualityGate vacuous-suite probe catches an architect test that asserts nothing about the app", async () => {
  // The vacuous test is part of the blueprint commit itself (architect's own mistake,
  // or a class of bug ownership diffing cannot see): the crew turn makes no edits at all
  // (HEAD~1..HEAD diff is empty), so only the vacuous-suite probe can catch it.
  const dir = makeFixtureRepo({ vacuousTest: true });
  execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "crew: no-op turn"], { cwd: dir, stdio: "ignore" });
  try {
    const cfg = { ...gateConfigFromEnv({}), startEvery: 0, vacuous: "every" as const };
    const result = await runQualityGate(dir, cfg, "finish", { exec: defaultExec });
    assert.equal(result.passed, false);
    assert.equal(
      result.findings.some((f) => f.rule === "vacuous-tests" && !f.ok),
      true,
      JSON.stringify(result.findings, null, 2),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runQualityGate reads QUALITY.md: a failing contract test command fails the gate even though package.json's own script passes", async () => {
  const dir = makeFixtureRepo();
  try {
    writeFileSync(
      join(dir, "QUALITY.md"),
      "# Quality standard\n\n```json quality\n{ \"bar\": { \"test\": \"sh -c 'exit 7'\" }, \"hygiene_never_tracked\": [\"node_modules/\"] }\n```\n",
    );
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["-c", "user.email=fixture@test", "-c", "user.name=fixture", "commit", "-q", "-m", "quality"], { cwd: dir, stdio: "ignore" });
    const cfg = { ...gateConfigFromEnv({}), startEvery: 0, vacuous: "" as const };
    const result = await runQualityGate(dir, cfg, "iterate", { exec: defaultExec });
    assert.equal(result.passed, false);
    const qb = result.findings.find((f) => f.rule === "quality-bar");
    assert.ok(qb && !qb.ok && /exited 7/.test(qb.detail), JSON.stringify(result.findings));
    // and with the contract's test pointing at the real suite, it passes
    writeFileSync(
      join(dir, "QUALITY.md"),
      "```json quality\n{ \"bar\": { \"test\": \"node --test test/*.test.js\" }, \"hygiene_never_tracked\": [\"node_modules/\"] }\n```\n",
    );
    execFileSync("git", ["-c", "user.email=fixture@test", "-c", "user.name=fixture", "commit", "-q", "-am", "quality2"], { cwd: dir, stdio: "ignore" });
    const ok = await runQualityGate(dir, cfg, "iterate", { exec: defaultExec });
    // QUALITY.md itself was modified this turn: that is an ownership violation by design, so filter it out to check the bar
    assert.equal(ok.findings.find((f) => f.rule === "quality-bar")?.ok, true, JSON.stringify(ok.findings));
    assert.ok(ok.findings.some((f) => f.rule === "ownership" && !f.ok), "editing QUALITY.md is architect-only");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
