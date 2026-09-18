import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHybridHandle, defaultExec, type ExecFn, type LocalCommand } from "../../src/lib/engine-local.js";
import { policyFromEnv } from "../../src/lib/routing.js";

/**
 * `createHybridHandle` end to end against a real bare git origin: real clone,
 * real gate (git/npm), a faked local-model harness so no Ollama is required.
 * Covers what quality-gate.test.ts cannot: seeding, baseline capture, the
 * retry-with-feedback loop, and the gate record on `ClaudeRecord`.
 */

function makeOrigin(): string {
  const root = mkdtempSync(join(tmpdir(), "gate-origin-"));
  const work = join(root, "work");
  mkdirSync(join(work, "src"), { recursive: true });
  mkdirSync(join(work, "test"), { recursive: true });
  writeFileSync(join(work, "README.md"), "# fixture\n");
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", private: true, type: "module", scripts: { test: "node --test test/*.test.js" } }, null, 2),
  );
  writeFileSync(join(work, ".gitignore"), "node_modules/\n");
  const git = (args: string[]) => execFileSync("git", args, { cwd: work, stdio: "ignore" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=fixture@test", "-c", "user.name=fixture", "commit", "-q", "-m", "initial"]);
  const bare = join(root, "origin");
  git(["clone", "-q", "--bare", work, bare]);
  return bare;
}

const GOOD_APP = `export function greet(name) {\n  if (!name) throw new Error("name required");\n  return \`hello, \${name}\`;\n}\n`;
const GOOD_TEST = `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { greet } from "../src/app.js";\n\ntest("greets", () => {\n  assert.equal(greet("world"), "hello, world");\n});\n`;
const BROKEN_APP = `export function greet(name) {\n  return undefined_symbol;\n}\n`;

/** Simulates a local coding agent: writes files into cwd, commits nothing (the orchestrator commits), returns a JSON report. */
function fakeCrew(scripted: (cwd: string, attempt: number) => void): ExecFn {
  let attempt = 0;
  return async (cmd: LocalCommand, cwd: string) => {
    void cmd;
    mkdirSync(join(cwd, "src"), { recursive: true });
    mkdirSync(join(cwd, "test"), { recursive: true });
    scripted(cwd, attempt);
    attempt++;
    return {
      stdout: 'Implemented the milestone.\n```json\n{"milestone_id":"M1","milestone_title":"skeleton","completed":true,"remaining":0,"blocked":false,"blocked_reason":null,"verification":[],"commits":[]}\n```',
      stderr: "",
      code: 0,
    };
  };
}

const baseGateCfg = { enabled: true, retries: 1, startTimeoutMs: 15_000, commandTimeoutMs: 60_000, vacuous: "" as const, startEvery: 0 };

test("createHybridHandle: a clean local turn passes the gate on the first attempt", async () => {
  const origin = makeOrigin();
  try {
    const exec = fakeCrew((cwd) => {
      writeFileSync(join(cwd, "src", "app.js"), GOOD_APP);
      writeFileSync(join(cwd, "test", "app.test.js"), GOOD_TEST);
    });
    const handle = await createHybridHandle({
      engine: "local",
      repo: origin,
      ref: "main",
      autoCreatePR: false,
      exec,
      gateExec: defaultExec,
      gateCfg: baseGateCfg,
      policy: policyFromEnv("local"),
      log: () => {},
    });
    const turn = await handle.send('# Build an app from an idea: iteration 1 of at most 12\n\nDo the thing.', { mode: "agent" });
    assert.equal(turn.status, "finished");
    assert.equal(turn.gate?.passed, true);
  } finally {
    rmSync(origin, { recursive: true, force: true });
  }
});

test("createHybridHandle: a failing turn gets a feedback retry, then succeeds", async () => {
  const origin = makeOrigin();
  try {
    const exec = fakeCrew((cwd, attempt) => {
      // First attempt writes broken code; the gate should fail and hand back a
      // continuation with the failing rule and output. Second attempt "reads"
      // that feedback (we don't parse it here, just simulate fixing it) and
      // writes good code.
      if (attempt === 0) {
        writeFileSync(join(cwd, "src", "app.js"), BROKEN_APP);
        writeFileSync(join(cwd, "test", "app.test.js"), GOOD_TEST);
      } else {
        writeFileSync(join(cwd, "src", "app.js"), GOOD_APP);
        writeFileSync(join(cwd, "test", "app.test.js"), GOOD_TEST);
      }
    });
    let sawFeedback = false;
    const wrappedExec: ExecFn = async (cmd, cwd, timeoutMs) => {
      if (cmd.args.at(-1)?.includes("Quality gate failed")) sawFeedback = true;
      return exec(cmd, cwd, timeoutMs);
    };
    const handle = await createHybridHandle({
      engine: "local",
      repo: origin,
      ref: "main",
      autoCreatePR: false,
      exec: wrappedExec,
      gateExec: defaultExec,
      gateCfg: baseGateCfg,
      policy: policyFromEnv("local"),
      log: () => {},
    });
    const turn = await handle.send('# Build an app from an idea: iteration 1 of at most 12\n\nDo the thing.', { mode: "agent" });
    assert.equal(sawFeedback, true, "second attempt should have received the gate feedback note");
    assert.equal(turn.status, "finished");
    assert.equal(turn.gate?.passed, true);
  } finally {
    rmSync(origin, { recursive: true, force: true });
  }
});

test("createHybridHandle: a persistently failing turn exhausts retries and reports an error with the gate attached", async () => {
  const origin = makeOrigin();
  try {
    const exec = fakeCrew((cwd) => {
      writeFileSync(join(cwd, "src", "app.js"), BROKEN_APP);
      writeFileSync(join(cwd, "test", "app.test.js"), GOOD_TEST);
    });
    const handle = await createHybridHandle({
      engine: "local",
      repo: origin,
      ref: "main",
      autoCreatePR: false,
      exec,
      gateExec: defaultExec,
      gateCfg: { ...baseGateCfg, retries: 1 },
      policy: policyFromEnv("local"),
      log: () => {},
    });
    const turn = await handle.send('# Build an app from an idea: iteration 1 of at most 12\n\nDo the thing.', { mode: "agent" });
    assert.equal(turn.status, "error");
    assert.equal(turn.gate?.passed, false);
    assert.equal(
      turn.gate?.findings.some((f) => f.rule === "quality-bar" && !f.ok),
      true,
    );
  } finally {
    rmSync(origin, { recursive: true, force: true });
  }
});

test("createHybridHandle: seeds AGENTS.md/QWEN.md/.gitignore once on a fresh clone", async () => {
  const origin = makeOrigin();
  try {
    const exec = fakeCrew((cwd) => {
      writeFileSync(join(cwd, "src", "app.js"), GOOD_APP);
      writeFileSync(join(cwd, "test", "app.test.js"), GOOD_TEST);
    });
    const handle = await createHybridHandle({
      engine: "local",
      repo: origin,
      ref: "main",
      autoCreatePR: false,
      exec,
      gateExec: defaultExec,
      gateCfg: baseGateCfg,
      policy: policyFromEnv("local"),
      log: () => {},
    });
    await handle.send('# Build an app from an idea: iteration 1 of at most 12\n\nDo the thing.', { mode: "agent" });
    const { loadClaudeRecord } = await import("../../src/lib/engine-claude.js");
    const rec = loadClaudeRecord(handle.agentId)!;
    const files = execFileSync("git", ["ls-files"], { cwd: rec.cwd, encoding: "utf8" }).split("\n");
    assert.ok(files.includes("QWEN.md"));
    assert.ok(rec.gates && rec.gates.length >= 1);
    assert.ok(rec.gateScriptsBaseline);
  } finally {
    rmSync(origin, { recursive: true, force: true });
  }
});
