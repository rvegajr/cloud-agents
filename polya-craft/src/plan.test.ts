import assert from "node:assert/strict";
import { test } from "node:test";
import { ORACLE, commandOf, contractOf, oracleNote, parsePlan, parseProblem, problemGaps, renderPlan, renderProblem, validateUnits } from "./plan.js";

export const PROBLEM_MD = `# Problem: unknown routes answer 404
Kind: repair
Size: S

## Given
- the repo at main; \`src/app.js\` registers routes (owner: the file)

## Unknown
GET /nope answers 404.

## Condition
The suite stays green.

## Restated
The catch-all handler is registered before the not-found handler, so every miss falls through to it.

## Done-check
- D1: GET /nope answers 404 — Check: \`node --test test/notfound.test.js\` — Now: unmet
- D2: a stranger can start the app from the README — Check: a stranger follows the README and the app starts — Now: unmet

## Not this
- no other route changes

## Lessons consulted
- L-2026-09-18-01: not applicable because nothing is pasted into a unit

## Quality bar
| Purpose | Command |
| --- | --- |
| install | \`npm ci\` |
| test | \`npm test\` |
| start | \`npm start\` |

\`\`\`json problem
{ "kind": "repair", "size": "S", "done": [ { "id": "D1", "outer": true } ], "bar": { "test": "npm test" } }
\`\`\`
`;

export const PLAN_MD = `# Plan for: unknown routes answer 404

## Approach
Reorder the middleware; borrow from every Express not-found example.

## Shape
- L2 whole — check: the outer test passes
- L1:routes — check: \`npm test\`

## Outer test
1. \`curl /nope\` prints 404 (D1)
2. a stranger follows the README and the app starts (D2)

## Units

## U1: reorder the not-found handler
Serves:   D1
Level:    L1:routes
Produces: \`src/app.js\` with the not-found handler registered last
Given:    \`src/app.js\`; the red test \`test/notfound.test.js\`
Do:       1. Move the not-found handler below the catch-all.
          2. Run Check.
Touches:  src/app.js
Check:    \`node --test test/notfound.test.js\` — Now: unmet
Depends:  none
Not:      any other route.

## U2: document the start command
Serves:   D2
Level:    L1:routes
Produces: \`README.md\` with a Run section
Given:    package.json scripts
Do:       1. Add a Run section naming \`npm start\`.
Touches:  README.md
Check:    \`grep -q "npm start" README.md\` — Now: unmet
Depends:  U1
Not:      anything else.

## Order
U1 → U2

## Trace
- D1 → U1 → step 1
- D2 → U2 → step 2

\`\`\`json plan
{ "units": [ { "id": "U1" }, { "id": "U2" } ] }
\`\`\`
`;

test("parseProblem: title, kind, size, done-checks with commands, lessons, bar", () => {
  const p = parseProblem(PROBLEM_MD)!;
  assert.equal(p.title, "unknown routes answer 404");
  assert.equal(p.kind, "repair");
  assert.equal(p.size, "S");
  assert.deepEqual(p.done.map((d) => d.id), ["D1", "D2"]);
  assert.equal(p.done[0]!.command, "node --test test/notfound.test.js");
  assert.equal(p.done[0]!.outer, true);
  assert.equal(p.done[1]!.command, undefined);
  assert.equal(p.done[1]!.now, "unmet");
  assert.match(p.restated!, /catch-all/);
  assert.equal(p.given.length, 1);
  assert.deepEqual(p.lessons, [{ id: "L-2026-09-18-01", applied: false, how: "not applicable because nothing is pasted into a unit" }]);
  assert.deepEqual(p.bar, { install: "npm ci", test: "npm test", start: "npm start" });
});

test("parseProblem: markdown fallback when the block is absent; bare block when the markdown has no done-checks", () => {
  const md = "# Problem: x\nKind: build\n\n## Done-check\n- D1: it works — Check: `npm test` — Now: met\n";
  assert.equal(parseProblem(md)!.done[0]!.now, "met");
  const bare = "# Problem: y\n\n```json problem\n{ \"done\": [ { \"id\": \"D1\", \"text\": \"t\", \"check\": \"npm test\" } ], \"bar\": { \"test\": \"npm test\" } }\n```\n";
  const p = parseProblem(bare)!;
  assert.equal(p.done[0]!.command, "npm test");
  assert.equal(p.bar.test, "npm test");
  assert.equal(parseProblem("no title here"), undefined);
});

test("commandOf: backticked commands, bare commands, and prose", () => {
  assert.equal(commandOf("`npm test` exits 0"), "npm test");
  assert.equal(commandOf("npm run lint"), "npm run lint");
  assert.equal(commandOf("a reader holding the rubric scores it ≥ 4"), undefined);
  assert.equal(commandOf("npm start then curl and expect 200"), undefined);
  assert.equal(commandOf(undefined), undefined);
});

test("problemGaps: the rules of section 2.1", () => {
  const p = parseProblem(PROBLEM_MD)!;
  assert.deepEqual(problemGaps(p, { software: true, offeredLessons: ["L-2026-09-18-01"] }), []);
  assert.match(problemGaps(undefined).join("\n"), /missing/);
  const noChecks = { ...p, done: p.done.map((d) => ({ ...d, check: "" })) };
  assert.match(problemGaps(noChecks).join("\n"), /D1 has no Check/);
  assert.match(problemGaps({ ...p, done: [] }).join("\n"), /no done-checks/);
  assert.match(problemGaps({ ...p, done: Array.from({ length: 9 }, (_, i) => ({ ...p.done[0]!, id: `D${i + 1}` })) }).join("\n"), /at most 8/);
  assert.match(problemGaps({ ...p, size: "L" }).join("\n"), /Split/);
  assert.match(problemGaps({ ...p, size: "L", split: [{ name: "P1", done: ["D1"] }] }).join("\n"), /no row for D2/);
  assert.match(problemGaps({ ...p, bar: {} }, { software: true }).join("\n"), /test/);
  assert.match(problemGaps(p, { offeredLessons: ["L-0000-00-00-01"] }).join("\n"), /L-0000-00-00-01 was offered/);
  assert.match(problemGaps({ ...p, restated: undefined }).join("\n"), /Restated/);
});

test("parsePlan: units with continued fields, commands, depends, levels, outer test, trace", () => {
  const plan = parsePlan(PLAN_MD);
  assert.deepEqual(plan.units.map((u) => u.id), ["U1", "U2"]);
  const u1 = plan.units[0]!;
  assert.equal(u1.title, "reorder the not-found handler");
  assert.deepEqual(u1.serves, ["D1"]);
  assert.equal(u1.level, "L1:routes");
  assert.deepEqual(u1.touches, ["src/app.js"]);
  assert.equal(u1.check, "`node --test test/notfound.test.js`");
  assert.equal(u1.command, "node --test test/notfound.test.js");
  assert.match(u1.do, /1\. Move[\s\S]*2\. Run Check/);
  assert.deepEqual(u1.depends, []);
  assert.deepEqual(plan.units[1]!.depends, ["U1"]);
  assert.match(u1.body, /^## U1:/);
  assert.deepEqual(plan.levels, [{ id: "L2", check: "the outer test passes" }, { id: "L1:routes", check: "`npm test`" }]);
  assert.deepEqual(plan.outer.map((o) => o.d), ["D1", "D2"]);
  assert.match(plan.outerText, /curl \/nope/);
  assert.deepEqual(plan.trace, { D1: ["U1"], D2: ["U2"] });
});

test("parsePlan: a bare block with no markdown units still yields units with a body", () => {
  const md = "# Plan for: x\n\n```json plan\n{ \"units\": [ { \"id\": \"U1\", \"title\": \"t\", \"serves\": [\"D1\"], \"produces\": \"p\", \"given\": \"g\", \"do\": \"1. do\", \"touches\": [\"src/a.js\"], \"check\": \"npm test\", \"depends\": [] } ] }\n```\n";
  const plan = parsePlan(md);
  assert.equal(plan.units.length, 1);
  assert.equal(plan.units[0]!.command, "npm test");
  assert.match(plan.units[0]!.body, /Touches:\s+src\/a\.js/);
});

test("validateUnits: a lawful plan has no problems", () => {
  const p = parseProblem(PROBLEM_MD)!;
  const plan = parsePlan(PLAN_MD);
  assert.deepEqual(validateUnits(plan.units, p, { requireCommand: true, exists: (f) => f === "test/notfound.test.js" }), []);
});

test("validateUnits: each mechanical row of the stranger test", () => {
  const p = parseProblem(PROBLEM_MD)!;
  const base = parsePlan(PLAN_MD).units[0]!;
  const problems = (u: Partial<typeof base>, opts = {}) => validateUnits([{ ...base, ...u }], p, { requireCommand: true, ...opts }).map((x) => x.problem).join("\n");
  assert.match(problems({ touches: [] }), /no Touches/);
  assert.match(problems({ given: "" }), /no Given/);
  assert.match(problems({ touches: ["test/notfound.test.js"] }), /test file/);
  assert.match(problems({ touches: ["PLAN.md"] }), /plan artifact/);
  assert.match(problems({ touches: ["a", "b", "c", "d", "e", "f", "g"] }), /more than 6/);
  assert.match(problems({ check: "looks right to me", command: undefined }), /prose/);
  assert.match(problems({ do: "1. Choose the best handler order." }), /"Choose"/i);
  assert.match(problems({ do: Array.from({ length: 10 }, (_, i) => `${i + 1}. step`).join("\n") }), /10 steps/);
  assert.equal(problems({ do: "1. a\n```json\n1. not a step\n2. nor this\n```\n2. b" }).includes("steps"), false);
  assert.match(problems({ serves: [] }), /names no D/);
  assert.match(problems({ serves: ["D9"] }), /D9/);
  assert.match(problems({ depends: ["U7"] }), /U7/);
  assert.match(problems({ body: Array.from({ length: 650 }, () => "x").join("\n") }), /650 lines/);
  assert.ok(!problems({ body: Array.from({ length: 450 }, () => "x").join("\n") }).includes("lines"));
  assert.match(problems({}, { exists: () => false }), /not on disk/);
  assert.equal(problems({ check: "a stranger reads it", command: undefined }, { requireCommand: false }), "D2 is served by no unit");
});

test("validateUnits: plan-level rules — every D served; side-by-side units keep disjoint Touches", () => {
  const p = parseProblem(PROBLEM_MD)!;
  const [u1, u2] = parsePlan(PLAN_MD).units as [ReturnType<typeof parsePlan>["units"][0], ReturnType<typeof parsePlan>["units"][0]];
  assert.match(validateUnits([u1], p).map((x) => x.problem).join("\n"), /D2 is served by no unit/);
  const shared = validateUnits([u1, { ...u2, touches: ["src/app.js"], depends: [] }], p);
  assert.match(shared.map((x) => x.problem).join("\n"), /share Touches \(src\/app\.js\)/);
  assert.deepEqual(validateUnits([u1, { ...u2, touches: ["src/app.js"] }], p), []);
});

test("contractOf: the bar minus start, with defaults", () => {
  const c = contractOf(parseProblem(PROBLEM_MD))!;
  assert.deepEqual(c.bar, { install: "npm ci", test: "npm test" });
  assert.deepEqual(c.start, { command: "npm start" });
  assert.ok(c.hygieneNeverTracked.includes("node_modules/"));
  assert.equal(contractOf(undefined), undefined);
  assert.equal(contractOf({ ...parseProblem(PROBLEM_MD)!, bar: {} }), undefined);
});

test("renderProblem / renderPlan round-trip through the parsers", () => {
  const md = renderProblem({ title: "t", kind: "build", size: "M", restated: "r", done: [{ id: "D1", text: "works", check: "npm test" }], bar: { test: "npm test" }, lessons: [{ id: "L-1", applied: true, how: "x" }] })!;
  const p = parseProblem(md)!;
  assert.equal(p.title, "t");
  assert.equal(p.done[0]!.command, "npm test");
  assert.equal(p.bar.test, "npm test");
  assert.equal(p.lessons[0]!.applied, true);
  assert.equal(renderProblem({ title: "t" }), undefined);
  const plan = parsePlan(renderPlan({ title: "t", units: [{ id: "U1", title: "u", serves: ["D1"], produces: "p", given: "g", do: "1. x", touches: ["src/a.js"], check: "npm test" }], outer: [{ text: "run it", d: "D1" }] })!);
  assert.equal(plan.units[0]!.command, "npm test");
  assert.deepEqual(plan.trace, { D1: ["U1"] });
  assert.equal(plan.outer[0]!.d, "D1");
  assert.equal(renderPlan({}), undefined);
});

// The PROBLEM.md a live Claude Max Solver wrote on 2026-09-18 for the polya-live-404 repair: bold ids, three-line
// done-checks, "met (invariant)", a three-column bar table, and a json block with its own field names.
import { readFileSync } from "node:fs";
const LIVE = readFileSync(new URL("./fixtures-live-problem.md", import.meta.url), "utf8");

test("parseProblem: the live Solver's drifted format parses without a gap", () => {
  const p = parseProblem(LIVE)!;
  assert.equal(p.kind, "repair");
  assert.deepEqual(p.done.map((d) => d.id), ["D1", "D2", "D3", "D4", "D5"]);
  assert.equal(p.done[0]!.command, `test "$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/nope)" = "404" && test "$(curl -s localhost:4571/nope)" = "not found"`);
  assert.match(p.done[0]!.text, /^`GET \/nope` on the running app answers 404/);
  assert.equal(p.done[0]!.now, "unmet");
  assert.equal(p.done[2]!.now, "met");
  assert.equal(p.done[4]!.command, "npm test");
  assert.deepEqual(p.bar, { install: "npm install", test: "npm test", start: "npm start" });
  assert.match(p.restated!, /catch-all handler/);
  assert.deepEqual(p.split, []);
  assert.deepEqual(problemGaps(p, { software: true }), []);
});

test("parseProblem: a json block with aliases and a false split never throws", () => {
  const md = '# Problem: x\n\n```json problem\n{ "kind": "repair", "done_checks": [ { "id": "D1", "statement": "s", "check": "npm test", "status": "met (invariant)" } ], "quality_bar": { "test": "npm test" }, "split": false, "lessons": null }\n```\n';
  const p = parseProblem(md)!;
  assert.equal(p.done[0]!.text, "s");
  assert.equal(p.done[0]!.now, "met");
  assert.equal(p.bar.test, "npm test");
  assert.deepEqual(p.split, []);
  assert.deepEqual(p.lessons, []);
});

test("commandOf: several backticked commands are one check", () => {
  assert.equal(commandOf("`npm test` and `npm run lint`"), "npm test && npm run lint");
});

test("commandOf: a backticked path or glob is not a command; `test` needs an argument", () => {
  assert.equal(commandOf("`npm test` — now: unmet. This command is outside Touches (it runs `test/*.test.js`, and `src/app.js` is not a test file)."), "npm test");
  assert.equal(commandOf("`test/app.test.js`"), undefined);
  assert.equal(commandOf("test"), undefined);
  assert.equal(commandOf(`test "$(curl -s localhost:4571/nope)" = "not found"`), `test "$(curl -s localhost:4571/nope)" = "not found"`);
});

// The PLAN.md the same live Solver wrote: a fenced Given, multi-line Do with fenced blocks, prose in the Check field.
const LIVE_PLAN = readFileSync(new URL("./fixtures-live-plan.md", import.meta.url), "utf8");

test("parsePlan: the live Solver's plan yields one lawful unit whose Check is `npm test`", () => {
  const plan = parsePlan(LIVE_PLAN);
  assert.equal(plan.units.length, 1);
  const u = plan.units[0]!;
  assert.equal(u.id, "U1");
  assert.deepEqual(u.serves, ["D1", "D2", "D3", "D4", "D5"]);
  assert.deepEqual(u.touches, ["src/app.js"]);
  assert.equal(u.command, "npm test");
  const p = parseProblem(LIVE)!;
  assert.deepEqual(validateUnits(plan.units, p, { requireCommand: true }), []);
});

// The PLAN.md and PROBLEM.md a live Claude Max Solver wrote for the snippet-vault build ($2.84 of Max): h3 unit
// headings, `Do:` with steps on the next lines carrying whole files in fences, a trace of objects.
const LIVE_SV_PLAN = readFileSync(new URL("./fixtures-live-plan-sv.md", import.meta.url), "utf8");
const LIVE_SV_PROBLEM = readFileSync(new URL("./fixtures-live-problem-sv.md", import.meta.url), "utf8");

test("parsePlan: the live snippet-vault plan yields five lawful units", () => {
  const p = parseProblem(LIVE_SV_PROBLEM)!;
  assert.deepEqual(problemGaps(p, { software: true }), []);
  const plan = parsePlan(LIVE_SV_PLAN);
  assert.deepEqual(plan.units.map((u) => u.id), ["U1", "U2", "U3", "U4", "U5"]);
  const u1 = plan.units[0]!;
  assert.deepEqual(u1.serves, ["D2", "D8"]);
  assert.ok(u1.do.includes("Create `package.json`"), "Do starts on the next line");
  assert.ok(u1.do.includes('"name": "snippet-vault"'), "Do carries the fenced file");
  assert.ok(u1.touches.length >= 1 && u1.touches.every((t) => !/^\d+\./.test(t)));
  assert.ok(u1.command, `U1 check should be a command: ${u1.check.slice(0, 80)}`);
  assert.deepEqual(plan.trace.D1, ["U3", "U4", "U5"]);
  assert.deepEqual(plan.units[1]!.depends, ["U1"]);
  assert.deepEqual(validateUnits(plan.units, p, { requireCommand: true }), []);
});

test("commandOf: commands mentioned inside a sentence are an observation, not a command (live snippet-vault D1, D4, D5)", () => {
  assert.equal(commandOf("A stranger runs `npm ci`, then `npm run dev` or `npm start`, and opens the page"), undefined);
  assert.equal(commandOf("type `jq` in the box; `curl -s 'localhost:3000/api/snippets?q=id' | grep -q '\"id\"'` prints a match and `curl -s 'localhost:3000/api/snippets?q=jq'` lists it"), undefined);
  // One real command inside annotation is that command (the live 404 plan's U1).
  assert.equal(commandOf("`jq` appears; `curl -s 'localhost:3000/api/snippets?q=id' | grep -q '\"id\"'` prints a match"), `curl -s 'localhost:3000/api/snippets?q=id' | grep -q '"id"'`);
  assert.equal(commandOf("`ls <projectdir>/*.db` shows a file and `curl -sf localhost:3000/api/snippets/<id>` returns it"), undefined);
  assert.equal(commandOf("`npm test` and `npm run lint`"), "npm test && npm run lint");
  assert.equal(commandOf("`npm test`; `npm run lint`"), "npm test && npm run lint");
  assert.equal(commandOf("`jq`"), undefined);
});

test("parsePlan: a parenthetical note inside Touches is not a file", () => {
  const plan = parsePlan(PLAN_MD.replace("Touches:  src/app.js", "Touches:  `src/app.js`, `node_modules/` (generated, gitignored)"));
  assert.deepEqual(plan.units[0]!.touches, ["src/app.js", "node_modules/"]);
});

test("oracle: parsed from ## Oracle; every line needs a disposition, and an adopted line must name a real D", () => {
  const base = parseProblem(PROBLEM_MD)!;
  assert.deepEqual(base.oracle, {});
  const gaps = problemGaps(base, { oracle: true });
  assert.equal(gaps.filter((g) => /has no disposition under `## Oracle`/.test(g)).length, ORACLE.length);
  const withOracle = PROBLEM_MD.replace("## Not this", "## Oracle\n" + ORACLE.map((o) => (o.id === "O1" ? "- O1: adopted as D9" : `- ${o.id}: dismissed — not relevant here`)).join("\n") + "\n\n## Not this");
  const p = parseProblem(withOracle)!;
  assert.equal(Object.keys(p.oracle).length, ORACLE.length);
  assert.deepEqual(problemGaps(p, { oracle: true }), ["- O1 is adopted as D9, which is not a done-check"]);
  assert.deepEqual(problemGaps(parseProblem(withOracle.replace("adopted as D9", "adopted as D1"))!, { oracle: true }), []);
  assert.deepEqual(problemGaps(p), []);
  assert.match(oracleNote(), /^## Oracle: cases a done-check list forgets[\s\S]*\*\*O8\*\* A stranger installs and runs it from the repo's own documentation/);
});


// R0 (Sonnet, curated ledger, 2026-09-19): the Solver applied the sha256 lesson; each Check is one node -e command,
// followed by a multi-line `Now:` clause that quotes other commands.
const LIVE_R0_PLAN = readFileSync(new URL("./fixtures-live-plan-r0.md", import.meta.url), "utf8");
const LIVE_R0_PROBLEM = readFileSync(new URL("./fixtures-live-problem-r0.md", import.meta.url), "utf8");

test("parsePlan: a multi-line Now: clause is not part of the Check (live R0 plan)", () => {
  const plan = parsePlan(LIVE_R0_PLAN);
  assert.equal(plan.units.length, 6);
  for (const u of plan.units) {
    assert.ok(u.command, `${u.id} has no command: ${u.check.slice(0, 120)}`);
    assert.match(u.command!, /^node -e "const c=require\('crypto'\)/);
    assert.doesNotMatch(u.check, /Now:|Cannot find module/);
  }
  // Every unit parses to one command, and every one also inspects git status, which the git rule rejects.
  const gaps = validateUnits(plan.units, parseProblem(LIVE_R0_PROBLEM), { requireCommand: true });
  assert.deepEqual(gaps.map((p) => p.id), ["U1", "U2", "U3", "U4", "U5", "U6"]);
  assert.ok(gaps.every((p) => /inspects git/.test(p.problem)));
});

test("validateUnits: a Check that inspects git is not workable under the loop (live R0, U1)", () => {
  const u = parsePlan(PLAN_MD).units[0]!;
  const withGit = { ...u, check: "`node --test test/notfound.test.js && test -z \"$(git status --porcelain)\"`", command: 'node --test test/notfound.test.js && test -z "$(git status --porcelain)"' };
  assert.match(validateUnits([withGit], parseProblem(PROBLEM_MD)).map((p) => p.problem).join("\n"), /inspects git/);
  const r0 = parsePlan(LIVE_R0_PLAN).units[0]!;
  assert.match(validateUnits([r0], parseProblem(LIVE_R0_PROBLEM)).map((p) => p.problem).join("\n"), /inspects git/);
});

test("commandOf: one command inside a sentence about what a stranger does is the Verifier's (live R0, D1 and D5)", () => {
  assert.equal(commandOf("a stranger performs this after `npm ci && npm run dev`, opening `http://localhost:3000/` (this build's own documented default port/URL)."), undefined);
  assert.equal(commandOf("create a snippet, confirm a `*.db` file exists under the project directory, stop the server, start it again, `curl -sf localhost:3000/api/snippets/<id>` still returns it; `git status --porcelain` shows nothing for the db file"), undefined);
  assert.equal(commandOf("`npm test` exits 0"), "npm test");
  assert.equal(commandOf("`node --test test/db.test.js` passes"), "node --test test/db.test.js");
});


test("validateUnits: a Check may hash a file the unit writes whole, never one that already exists (live R0, U7)", () => {
  const u = parsePlan(PLAN_MD).units[0]!;
  const hashCmd = `node -e "const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('src/app.js')).digest('hex');if(h!=='45c0'){process.exit(1)}" && node --test test/notfound.test.js`;
  const unit = { ...u, check: `\`${hashCmd}\``, command: hashCmd };
  const problem = parseProblem(PROBLEM_MD);
  assert.match(validateUnits([unit], problem, { exists: (p) => p === "src/app.js" }).map((p) => p.problem).join("\n"), /hashes src\/app\.js, which already exists/);
  // A file this unit writes whole (not on disk yet) may be hashed.
  const creating = validateUnits([unit], problem, { exists: (p) => p === "test/notfound.test.js" }).map((p) => p.problem);
  assert.ok(!creating.some((p) => /hashes/.test(p)), creating.join("\n"));
});

test("validateUnits: a unit that runs an installer must own the lock file it writes (live R1a, U1)", () => {
  const u = parsePlan(PLAN_MD).units[0]!;
  const problem = parseProblem(PROBLEM_MD);
  const installs = { ...u, do: "1. Create `package.json`.\n2. Run `npm install` and confirm it exits 0.", touches: ["package.json"] };
  assert.match(validateUnits([installs], problem).map((p) => p.problem).join("\n"), /runs `npm install`, which writes a lock file/);
  // A command quoted inside a file the unit writes (a README's own instructions) is not a step that runs it.
  const documents = { ...installs, do: "1. Create `README.md` with exactly this content:\n```md\nnpm install\nnpm start\n```\n2. Save it." };
  assert.ok(!validateUnits([documents], problem).some((p) => /lock file/.test(p.problem)));
  assert.ok(!validateUnits([{ ...installs, touches: ["package.json", "package-lock.json"] }], problem).some((p) => /lock file/.test(p.problem)));
  // A unit that runs no installer is unaffected.
  assert.ok(!validateUnits([u], problem).some((p) => /lock file/.test(p.problem)));
});

test("validateUnits: knownUnitIds lets a single revised unit depend on the rest of the plan (live R1a, U3)", () => {
  const [u1, u2] = parsePlan(PLAN_MD).units as [ReturnType<typeof parsePlan>["units"][0], ReturnType<typeof parsePlan>["units"][0]];
  const problem = parseProblem(PROBLEM_MD);
  const alone = validateUnits([u2], problem, { doneIds: [] }).map((p) => p.problem).join("\n");
  assert.match(alone, /Depends: names unit\(s\) that do not exist: U1/);
  const withPlan = validateUnits([u2], problem, { doneIds: [], knownUnitIds: [u1.id, u2.id] }).map((p) => p.problem).join("\n");
  assert.ok(!/do not exist/.test(withPlan), withPlan);
});

test("validateUnits: a prose file is checked by what it says, not by its bytes (live R1b, U7)", () => {
  const u = parsePlan(PLAN_MD).units[0]!;
  const problem = parseProblem(PROBLEM_MD);
  const cmd = `test "$(sha256sum README.md | awk '{print $1}')" = "62f0" && grep -qF 'npm run dev' README.md`;
  const hashesProse = { ...u, check: `\`${cmd}\``, command: cmd, touches: ["README.md"] };
  assert.match(validateUnits([hashesProse], problem, { exists: () => false }).map((p) => p.problem).join("\n"), /hashes README\.md, which is prose/);
  const greps = `grep -qF 'npm run dev' README.md && grep -qF 'npm install' README.md`;
  assert.ok(!validateUnits([{ ...hashesProse, check: `\`${greps}\``, command: greps }], problem, { exists: () => false }).some((p) => /prose/.test(p.problem)));
  // Code the unit writes whole may still be hashed.
  const code = `test "$(sha256sum src/app.js | awk '{print $1}')" = "49c8"`;
  assert.ok(!validateUnits([{ ...hashesProse, check: `\`${code}\``, command: code, touches: ["src/app.js"] }], problem, { exists: () => false }).some((p) => /prose/.test(p.problem)));
});

test("contractOf: a command that serves or watches is the start probe, never a graded command (live R1b)", () => {
  const p = parseProblem(PROBLEM_MD)!;
  const withDev = { ...p, bar: { install: "npm ci", test: "npm test", dev: "node --watch server.js", lint: "npm run lint" } };
  const c = contractOf(withDev)!;
  assert.deepEqual(Object.keys(c.bar).sort(), ["install", "lint", "test"]);
  assert.deepEqual(c.start, { command: "node --watch server.js" });
  // A graded name whose command watches is caught too.
  const sneaky = contractOf({ ...p, bar: { test: "npm test", verify: "vite --watch" } })!;
  assert.deepEqual(Object.keys(sneaky.bar), ["test"]);
  assert.deepEqual(sneaky.start, { command: "vite --watch" });
  // A bar of nothing but long-running commands yields no contract rather than an empty bar.
  assert.equal(contractOf({ ...p, bar: { dev: "npm run dev" } }), undefined);
});

test("commandOf: a fragment inside a sentence is an observation (live R1b, D7)", () => {
  assert.equal(commandOf("`curl -X POST` with a missing `title` returns a 4xx status with a JSON error body, and the snippet count from `GET /api/snippets` is unchanged before and after"), undefined);
  assert.equal(commandOf("`npm test` exits 0 with 1 pass, 0 fail"), "npm test");
});

test("problemGaps: a done-check may not run a server in the foreground (live R1b, D5)", () => {
  const p = parseProblem(PROBLEM_MD)!;
  const serving = { ...p, done: [{ ...p.done[0]!, id: "D5", check: "`npm install && npm run dev`", command: "npm install && npm run dev" }] };
  assert.match(problemGaps(serving).join("\n"), /D5's Check runs a server in the foreground/);
  const backgrounded = { ...serving, done: [{ ...serving.done[0]!, command: "npm run dev & sleep 2; curl -sf localhost:3000/" }] };
  assert.ok(!problemGaps(backgrounded).some((g) => /foreground/.test(g)));
});

test("commandOf: a command that wraps across lines, or starts with rm or a subshell, is still a command (live R2, U7)", () => {
  const wrapped = "`rm -rf node_modules package-lock.json && npm install && (npm\n          run dev & sleep 2; curl -sf localhost:3000/)`";
  assert.equal(commandOf(wrapped), "rm -rf node_modules package-lock.json && npm install && (npm run dev & sleep 2; curl -sf localhost:3000/)");
  assert.equal(commandOf("`PORT=4000 npm start & sleep 1; curl -sf localhost:4000/`"), "PORT=4000 npm start & sleep 1; curl -sf localhost:4000/");
  assert.equal(commandOf("`for f in a b; do echo $f; done`"), "for f in a b; do echo $f; done");
});

// ---------------------------------------------------------------------------
// The requester's REQUEST.md: J/W/M items, their dispositions, and immovable paths
// ---------------------------------------------------------------------------

import { barPurposeOf, immovableOf, parseRequest, requestNote } from "./plan.js";

export const REQUEST_MD = `# Request: count JSON values on stdin

## Why
wc -l lies about pretty-printed JSON.

## I will judge it by
- I pipe a 200 MB file and it finishes without loading it all into memory.
- \`jsoncount < broken.json\` exits non-zero and prints one line on stderr.

## Wrong looks like
- An invalid line is skipped silently and the count still prints.

## Must not change
- \`test/cli.test.js\` (the CLI contract; the exit codes are fixed there)
- \`src/schema.sql\`

## Not this
- No NDJSON.
`;

test("parseRequest: the template's placeholders are not items; a filled request yields J/W/M ids in order", () => {
  assert.deepEqual(parseRequest(readFileSync(new URL("../templates/REQUEST.md", import.meta.url), "utf8")), []);
  assert.deepEqual(parseRequest(readFileSync(new URL("../../ideas/TEMPLATE.md", import.meta.url), "utf8")), []);
  const items = parseRequest(REQUEST_MD);
  assert.deepEqual(
    items.map((i) => [i.id, i.kind]),
    [["J1", "judge"], ["J2", "judge"], ["W1", "wrong"], ["M1", "immovable"], ["M2", "immovable"]],
  );
  assert.match(items[0]!.text, /200 MB/);
  assert.deepEqual(immovableOf(items), ["`test/cli.test.js` (the CLI contract; the exit codes are fixed there)", "`src/schema.sql`"]);
  assert.deepEqual(parseRequest("# Idea\n\n## Must have (v1)\n- a thing\n"), []);
  assert.equal(requestNote([]), "");
  assert.match(requestNote(items), /## The requester's own criteria[\s\S]*\*\*J1\*\* \(will judge it by\) I pipe[\s\S]*\*\*M2\*\* \(says must not change\)/);
});

test("problemGaps: every request item needs a disposition; adopted-as must name a D; an M line must be disposed immovable", () => {
  const items = parseRequest(REQUEST_MD);
  const p = parseProblem(PROBLEM_MD)!;
  const gaps = problemGaps(p, { request: items });
  assert.equal(gaps.filter((g) => /has no disposition under `## Request`/.test(g)).length, 5, gaps.join("\n"));
  const withRequest = parseProblem(
    `${PROBLEM_MD}\n\n## Request\n- J1: adopted as D1\n- J2: adopted as D9\n- W1: adopted as D2\n- M1: it lives in test/\n- M2: immovable — src/schema.sql, in Given\n`,
  )!;
  assert.deepEqual(withRequest.request.J1, "adopted as D1");
  const g2 = problemGaps(withRequest, { request: items });
  assert.ok(g2.some((g) => /J2 is adopted as D9, which is not a done-check/.test(g)), g2.join("\n"));
  assert.ok(g2.some((g) => /M1 must be disposed `immovable/.test(g)), g2.join("\n"));
  assert.ok(!g2.some((g) => /M2/.test(g)), g2.join("\n"));
  const clean = parseProblem(
    `${PROBLEM_MD}\n\n## Request\n- J1: adopted as D1\n- J2: dismissed — the CLI reads whole files by design; noted in Restated\n- W1: adopted as D2\n- M1: immovable — test/cli.test.js\n- M2: immovable — src/schema.sql\n`,
  )!;
  assert.deepEqual(problemGaps(clean, { request: items }).filter((g) => /[JWM]\d/.test(g)), []);
  // A disposition that is neither adopted nor dismissed is a gap.
  const vague = parseProblem(`${PROBLEM_MD}\n\n## Request\n- J1: noted\n`)!;
  assert.ok(problemGaps(vague, { request: items.slice(0, 1) }).some((g) => /J1's disposition is neither/.test(g)));
});

test("validateUnits: a unit whose Touches names a path the request says must not change is not workable", () => {
  const plan = parsePlan(PLAN_MD);
  const immovable = immovableOf(parseRequest(REQUEST_MD));
  assert.deepEqual(validateUnits(plan.units, parseProblem(PROBLEM_MD), { immovable }), []);
  const touching = parsePlan(PLAN_MD.replace("Touches:  src/app.js", "Touches:  src/app.js, src/schema.sql"));
  const problems = validateUnits(touching.units, parseProblem(PROBLEM_MD), { immovable });
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0]!.problem, /Touches: names src\/schema\.sql, which the request says must not change/);
  // A directory named immovable covers everything under it; a sibling path is untouched.
  const dir = validateUnits(parsePlan(PLAN_MD.replace("Touches:  src/app.js", "Touches:  config/app.json")).units, parseProblem(PROBLEM_MD), { immovable: ["the `config/` folder (ops owns it)"] });
  assert.equal(dir.length, 1, JSON.stringify(dir));
  assert.deepEqual(validateUnits(parsePlan(PLAN_MD.replace("Touches:  src/app.js", "Touches:  src/configure.js")).units, parseProblem(PROBLEM_MD), { immovable: ["`src/config.js`"] }), []);
  // A bare word in backticks is a name, not a directory (live jsoncount: "as the package `bin`" must not cover bin/cli.js);
  // written as a path, `bin/` does.
  const binUnit = parsePlan(PLAN_MD.replace("Touches:  src/app.js", "Touches:  bin/jsoncount.js, package.json")).units;
  assert.deepEqual(validateUnits(binUnit, parseProblem(PROBLEM_MD), { immovable: ["The command is `jsoncount`, as the package `bin` and the `npm run` script name"] }), []);
  assert.equal(validateUnits(binUnit, parseProblem(PROBLEM_MD), { immovable: ["`bin/` is generated"] }).length, 1);
  assert.equal(validateUnits(binUnit, parseProblem(PROBLEM_MD), { immovable: ["`package.json`"] }).length, 1);
});

test("templates: REQUEST.md and ACCEPT.md exist with the sections the loop and the requester rely on", () => {
  const req = readFileSync(new URL("../templates/REQUEST.md", import.meta.url), "utf8");
  for (const h of ["## I will judge it by", "## Wrong looks like", "## Must not change", "## The one walk-through"]) assert.ok(req.includes(h), h);
  const acc = readFileSync(new URL("../templates/ACCEPT.md", import.meta.url), "utf8");
  for (const h of ["## Before any unit runs", "## After look back", "## Lesson"]) assert.ok(acc.includes(h), h);
  const idea = readFileSync(new URL("../../ideas/TEMPLATE.md", import.meta.url), "utf8");
  for (const h of ["## I will judge it by", "## Wrong looks like", "## Must not change", "## Must have (v1)"]) assert.ok(idea.includes(h), h);
});

test("validateUnits: a repair for the finish check need not name a done-check (live R2, U8)", () => {
  const u = { ...parsePlan(PLAN_MD).units[0]!, serves: [] };
  const problem = parseProblem(PROBLEM_MD);
  assert.match(validateUnits([u], problem, { doneIds: [] }).map((p) => p.problem).join("\n"), /Serves: names no D/);
  assert.ok(!validateUnits([u], problem, { doneIds: [], requireServes: false }).some((p) => /Serves/.test(p.problem)));
});

test("live jsoncount (2026-09-20): a bar table with the columns swapped and prose purposes, and a json bar as a list of rows, both read", () => {
  const md = readFileSync(new URL("./fixtures-live-problem-jc.md", import.meta.url), "utf8");
  const p = parseProblem(md)!;
  assert.deepEqual(p.bar, { install: "npm ci", test: "npm test" });
  assert.equal(p.done.length, 8);
  assert.deepEqual(Object.keys(p.request), ["J1", "J2", "J3", "J4", "W1", "W2", "W3", "M1"]);
  assert.match(p.request.M1!, /^immovable/);
  assert.deepEqual(problemGaps(p, { software: true, request: parseRequest(readFileSync(new URL("../examples/request-json-count.md", import.meta.url), "utf8")) }).filter((g) => /Quality bar|[JWM]\d/.test(g)), []);
  // The block alone, as a list of rows, when the markdown table is absent.
  const blockOnly = parseProblem('# Problem: x\n\n## Done-check\n- D1: a — Check: `true` — Now: unmet\n\n```json problem\n{ "bar": [{ "command": "npm ci", "purpose": "install deps" }, { "command": "npm test", "purpose": "the suite" }, { "command": "npm run typecheck", "purpose": "types" }] }\n```\n')!;
  assert.deepEqual(blockOnly.bar, { install: "npm ci", test: "npm test", typecheck: "npm run typecheck" });
  // The canonical shape still reads, and a placeholder row is skipped.
  const canon = parseProblem("# Problem: x\n\n## Quality bar\n| Purpose | Command |\n| --- | --- |\n| install | `npm ci` |\n| test | `npm test` (no deps) |\n| lint | `<none>` |\n")!;
  assert.deepEqual(canon.bar, { install: "npm ci", test: "npm test" });
  assert.equal(barPurposeOf("run the automated suite", "node --test test/"), "test");
  assert.equal(barPurposeOf("a note", "make coffee"), undefined);
});

test("commandOf: a check that opens with a lower-case assignment or cd is a command (live jsoncount repair, U4)", () => {
  const live = "`d=$(mktemp -d) && (cd \"$d\" && printf '{\"a\":' > broken.json && npx jsoncount broken.json; test $? -ne 0)` — Now: unmet";
  assert.match(commandOf(live) ?? "", /^d=\$\(mktemp -d\) && \(cd/);
  assert.equal(commandOf("`cd /tmp && npm test`"), "cd /tmp && npm test");
  assert.equal(commandOf("`export N=22 && nvm exec $N npm test`"), "export N=22 && nvm exec $N npm test");
  assert.equal(commandOf("`src/app.js`"), undefined);
});

test("commandOf: a fenced script is one command, without its language tag (live jsoncount-depth, 2026-09-20)", () => {
  const plan = parsePlan(readFileSync(new URL("./fixtures-live-plan-jc-depth.md", import.meta.url), "utf8"));
  const u1 = plan.units[0]!;
  assert.ok(u1.command, "U1 has a command");
  assert.match(u1.command!, /^set -e\n/);
  assert.doesNotMatch(u1.command!, /^bash\n/);
  assert.equal(commandOf("```sh\n$ npm test\n```"), "npm test");
  assert.equal(commandOf("```\nsome prose about running things\n```"), undefined);
});
