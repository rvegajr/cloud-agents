import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SendFn } from "../../src/lib/build-loop.js";
import { defaultExec, type ExecFn } from "../../src/lib/engine-local.js";
import { classifyPrompt } from "../../src/lib/routing.js";
import { makePolyaIO } from "./io.js";
import { fileLessonsStore } from "./lessons.js";
import { runPolyaLoop } from "./polya-loop.js";

/**
 * The loop end to end against a real bare git origin: a real clone, the real
 * borrowed gate (git and node), a real fresh clone for the done-checks, a real
 * ledger file, and a faked model that writes fixture files per turn.
 */

function makeOrigin(): string {
  const root = mkdtempSync(join(tmpdir(), "polya-origin-"));
  const work = join(root, "work");
  mkdirSync(join(work, "src"), { recursive: true });
  writeFileSync(join(work, "README.md"), "# fixture\n\nnpm test\n");
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0", private: true, type: "module", scripts: { test: "node --test test/*.test.js" } }, null, 2));
  writeFileSync(join(work, ".gitignore"), "node_modules/\n");
  const git = (args: string[]) => execFileSync("git", args, { cwd: work, stdio: "ignore" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=fixture@test", "-c", "user.name=fixture", "commit", "-q", "-m", "initial"]);
  const bare = join(root, "origin");
  git(["clone", "-q", "--bare", work, bare]);
  return bare;
}

const PROBLEM = `# Problem: greet returns a greeting
Kind: build
Size: S

## Given
- the repo at main; \`src/greet.js\` is the owner of the greeting

## Unknown
\`greet("world")\` returns \`hello, world\`.

## Condition
The suite stays green.

## Restated
There is no greet function; the test that defines it is red.

## Done-check
- D1: greet works — Check: \`node --test test/greet.test.js\` — Now: unmet

## Not this
- no CLI

## Lessons consulted
- (none offered)

## Quality bar
| Purpose | Command |
| --- | --- |
| test | \`npm test\` |
`;

const PLAN = `# Plan for: greet returns a greeting

## Approach
One function.

## Shape
- L2 whole — check: the outer test passes

## Outer test
1. \`node --test test/greet.test.js\` exits 0 (D1)

## Units

## U1: implement greet
Serves:   D1
Level:    L1:lib
Produces: \`src/greet.js\` exporting greet(name)
Given:    the red test \`test/greet.test.js\`; the stub \`src/greet.js\`
Do:       1. Return \`hello, <name>\`. 2. Throw on an empty name. 3. Run Check.
Touches:  src/greet.js
Check:    \`node --test test/greet.test.js\` — Now: unmet
Depends:  none
Not:      any other file.

## Order
U1

## Trace
- D1 → U1 → step 1
`;

const RED_TEST = `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { greet } from "../src/greet.js";\n\ntest("D1: greets", () => {\n  assert.equal(greet("world"), "hello, world");\n});\n`;
const STUB = `export function greet() {\n  throw new Error("not implemented");\n}\n`;
const BROKEN = `export function greet(name) {\n  return undefined_symbol;\n}\n`;
const GOOD = `export function greet(name) {\n  if (!name) throw new Error("name required");\n  return \`hello, \${name}\`;\n}\n`;

const json = (o: unknown) => `done\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\``;

test("polya loop end to end: real clone, real gate, a faked model that writes files, LOOKBACK.md and the ledger on disk", async () => {
  const origin = makeOrigin();
  const workRoot = mkdtempSync(join(tmpdir(), "polya-work-"));
  const clone = join(workRoot, "clone");
  execFileSync("git", ["clone", "-q", origin, clone], { stdio: "ignore" });
  const ledger = join(workRoot, "LESSONS.md");
  const ran: string[] = [];
  const exec: ExecFn = async (cmd, cwd, timeout) => {
    ran.push(`${cmd.file} ${cmd.args.join(" ")}`);
    return defaultExec(cmd, cwd, timeout);
  };
  const io = makePolyaIO(clone, { gateCfg: { enabled: true, retries: 1, startTimeoutMs: 15_000, commandTimeoutMs: 60_000, vacuous: "", startEvery: 0 }, exec, workRoot });
  let carry = 0;
  const kinds: string[] = [];
  const send: SendFn = async (prompt, opts) => {
    const kind = classifyPrompt(prompt);
    kinds.push(kind);
    const cwd = opts?.cwd ?? clone;
    switch (kind) {
      case "understand":
        writeFileSync(join(cwd, "PROBLEM.md"), PROBLEM);
        return { status: "finished", result: json({ written: ["PROBLEM.md"] }) };
      case "devise":
        mkdirSync(join(cwd, "test"), { recursive: true });
        mkdirSync(join(cwd, "src"), { recursive: true });
        writeFileSync(join(cwd, "PLAN.md"), PLAN);
        writeFileSync(join(cwd, "test", "greet.test.js"), RED_TEST);
        writeFileSync(join(cwd, "src", "greet.js"), STUB);
        return { status: "finished", result: json({ written: ["PLAN.md"] }) };
      case "carry-out":
        carry++;
        writeFileSync(join(cwd, "src", "greet.js"), carry === 1 ? BROKEN : GOOD);
        return { status: "finished", result: json({ unit_id: "U1", done: true, blocked: false }) };
      case "look-back":
        return { status: "finished", result: json({ verdict: "done", answers_problem: true, findings: [], worked: ["U1 on the second try"], did_not: ["U1: a typo the gate caught"], lessons: [{ tags: ["kind:build", "stage:carry-out"], when: "a one-function unit", lesson: "run the Check before reporting", evidence: "this fixture, U1" }] }) };
      default:
        return { status: "finished", result: "unexpected" };
    }
  };
  const log: string[] = [];
  const out = await runPolyaLoop(send, { problem: "make greet work", repo: origin, io, lessons: fileLessonsStore(ledger), log: (l) => log.push(l) });
  assert.equal(out.stopReason, "complete", log.join("\n"));
  assert.deepEqual(kinds, ["understand", "devise", "carry-out", "carry-out", "look-back"]);
  const u1 = out.unitRecords[0]!;
  assert.equal(u1.attempts, 2);
  assert.equal(u1.passed, true);
  // The unit gate ran the unit's Check, not the whole suite; the finish check ran the bar.
  assert.ok(ran.some((c) => c.includes("node --test test/greet.test.js")), ran.join("\n"));
  assert.ok(ran.some((c) => /npm test/.test(c)), ran.join("\n"));
  assert.equal(out.finish?.passed, true);
  assert.deepEqual(out.checks?.map((c) => [c.id, c.passed, c.how]), [["D1", true, "mechanical"]]);
  const history = execFileSync("git", ["log", "--format=%s"], { cwd: clone, encoding: "utf8" });
  assert.match(history, /look back: LOOKBACK\.md/);
  assert.match(history, /carry out: U1 attempt 2/);
  assert.match(history, /devise: PLAN\.md/);
  assert.match(history, /understand: PROBLEM\.md/);
  const lookback = readFileSync(join(clone, "LOOKBACK.md"), "utf8");
  assert.match(lookback, /\| D1 \| yes \|/);
  assert.match(lookback, /U1: 2 attempt\(s\)/);
  assert.match(lookback, /run the Check before reporting/);
  assert.ok(existsSync(ledger));
  assert.match(readFileSync(ledger, "utf8"), /## L-\d{4}-\d{2}-\d{2}-01\nTags:     kind:build stage:carry-out/);
  assert.equal(out.lookback?.lessons, 1);
});
