import assert from "node:assert/strict";
import { test } from "node:test";
import {
  designExcerptFor,
  extractTaggedJson,
  hygienePatternToRegex,
  jobKindOf,
  looksLikeProse,
  mustHavesOf,
  parseCoverage,
  parseQaScenarios,
  parseQuality,
  parseRequirements,
  parseTasks,
  parseWorkflows,
  requirementsGaps,
  traceability,
  validateTasks,
} from "./blueprint.js";

const REQ = `# Requirements

## Acceptance criteria

- **R1** WHEN a user posts a snippet THE SYSTEM SHALL store it and return it with an id.
  Check: \`POST /api/snippets\` -> 201 with \`id\`.
- **R2** WHILE the process restarts THE SYSTEM SHALL retain every snippet.
  Check: create, restart, list still has it.

## Decisions

- Job kind: repair
`;

test("parseRequirements: markdown form with ids and checks", () => {
  const r = parseRequirements(REQ);
  assert.deepEqual(r.map((x) => x.id), ["R1", "R2"]);
  assert.match(r[0]!.text, /store it and return it/);
  assert.match(r[0]!.check!, /201/);
  assert.equal(jobKindOf(REQ), "repair");
});

test("parseRequirements: machine block wins when present", () => {
  const md = REQ + '\n```json requirements\n{ "requirements": [ { "id": "R9", "text": "t", "check": "c" } ] }\n```\n';
  assert.deepEqual(parseRequirements(md), [{ id: "R9", text: "t", check: "c" }]);
  assert.equal(extractTaggedJson(md, "nope"), undefined);
});

test("parseQuality: machine block, placeholders dropped, defaults for hygiene", () => {
  const md = '```json quality\n{ "bar": { "install": "npm ci", "lint": "...", "test": "npm test", "build": "<none>" }, "start": { "command": "npm start", "probe": { "http": "/", "expect": 200 } }, "rubric_targets": { "tests": 4 } }\n```';
  const q = parseQuality(md)!;
  assert.deepEqual(q.bar, { install: "npm ci", test: "npm test" });
  assert.equal(q.start?.command, "npm start");
  assert.ok(q.hygieneNeverTracked.includes(".qwen/"));
  assert.equal(q.rubricTargets.tests, 4);
});

test("parseQuality: markdown table fallback", () => {
  const md = "| Purpose | Command |\n| --- | --- |\n| install | `uv sync` |\n| test | `pytest` |\n| start | `python -m app` |\n";
  const q = parseQuality(md)!;
  assert.deepEqual(q.bar, { install: "uv sync", test: "pytest" });
  assert.equal(q.start?.command, "python -m app");
  assert.equal(parseQuality("nothing here"), undefined);
});

test("hygienePatternToRegex", () => {
  assert.ok(hygienePatternToRegex("dist/").test("dist/app.js"));
  assert.ok(!hygienePatternToRegex("dist/").test("src/dist/x"));
  assert.ok(hygienePatternToRegex("*.db").test("data/snippets.db"));
  assert.ok(hygienePatternToRegex(".aider*").test(".aider.chat.history.md"));
  assert.ok(hygienePatternToRegex(".env").test(".env"));
  assert.ok(!hygienePatternToRegex(".env").test(".env.example"));
});

const TASKS = `# Tasks

## T1: SQLite store adapter
Requirements: R1, R2
Files: src/store/sqlite.js
Ports: SnippetReader, SnippetWriter
Tests: test/store.sqlite.test.js
Commands: npm test -- test/store.sqlite.test.js, npm run lint
Parallel: yes
Out of scope: routes, UI
Goal: make the store tests green.

## T2: routes
Requirements: R1
Files: src/routes/snippets.js, src/app.js
Ports: SnippetReader
Tests: test/routes.test.js
Commands: npm test
Parallel: no
Goal: wire the routes.

\`\`\`json tasks
{ "tasks": [ { "id": "T1", "title": "SQLite store adapter", "parallel_ok": true }, { "id": "T2", "title": "routes", "parallel_ok": false } ] }
\`\`\`
`;

test("parseTasks: markdown blocks with lists, verbatim body, parallel flag", () => {
  const t = parseTasks(TASKS);
  assert.equal(t.length, 2);
  assert.deepEqual(t[0]!.files, ["src/store/sqlite.js"]);
  assert.deepEqual(t[0]!.requirements, ["R1", "R2"]);
  assert.deepEqual(t[0]!.commands, ["npm test -- test/store.sqlite.test.js", "npm run lint"]);
  assert.equal(t[0]!.parallelOk, true);
  assert.equal(t[1]!.parallelOk, false);
  assert.deepEqual(t[1]!.files, ["src/routes/snippets.js", "src/app.js"]);
  assert.match(t[0]!.body, /^## T1: SQLite store adapter\n/);
  assert.doesNotMatch(t[0]!.body, /## T2/);
  assert.equal(t[1]!.goal, "wire the routes.");
});

test("parseTasks: machine block alone still yields tasks", () => {
  const t = parseTasks('```json tasks\n{ "tasks": [ { "id": "T1", "title": "x", "files": ["a.js"], "tests": ["t.js"], "commands": ["npm test"], "requirements": ["R1"], "parallel_ok": false } ] }\n```');
  assert.equal(t.length, 1);
  assert.deepEqual(t[0]!.files, ["a.js"]);
  assert.match(t[0]!.body, /Files: a\.js/);
});

const QA = `# QA scenarios

## Q1 (R1): create returns the snippet
Given: fresh clone
When: curl -s -X POST localhost:4571/api/snippets
Then: 201
Evidence: body

## Q2 (R2): survives restart
Given: Q1
When: restart
Then: still listed
Evidence: both responses

\`\`\`json qa
{ "scenarios": [ { "id": "Q1", "requirement": "R1" }, { "id": "Q2", "requirement": "R2" } ] }
\`\`\`
`;

test("parseQaScenarios", () => {
  const q = parseQaScenarios(QA);
  assert.deepEqual(q.map((x) => [x.id, x.requirement]), [["Q1", "R1"], ["Q2", "R2"]]);
  assert.match(q[0]!.body, /When: curl/);
  assert.doesNotMatch(q[0]!.body, /Q2/);
});

test("traceability: every R needs a test tag, a task, and a scenario", () => {
  const reqs = parseRequirements(REQ);
  const tasks = parseTasks(TASKS);
  const qa = parseQaScenarios(QA);
  const full = traceability(reqs, tasks, qa, [{ path: "test/a.test.js", text: 'test("R1: creates", ...)\ntest("R2: restart", ...)' }]);
  assert.deepEqual(full.covered, ["R1", "R2"]);
  const partial = traceability(reqs, tasks, qa.slice(0, 1), [{ path: "test/a.test.js", text: 'test("R1: creates", ...)' }]);
  assert.deepEqual(partial.uncovered, [{ id: "R2", missing: ["test", "qa"] }]);
});

test("designExcerptFor keeps the task's layout lines, its ports, and the shared sections", () => {
  const design = `# Design

## Layout
src/app.js        createApp(deps)
src/store/sqlite.js SnippetStore adapter
src/search/like.js  SearchIndex adapter

## Ports (one per consumer)
### SnippetReader   used by: routes
  get(id): Snippet | null
### SnippetWriter   used by: routes
  create(input): Snippet
### SearchIndex     used by: search
  query(q): Snippet[]

## Wiring
createApp({ reader, writer })

## Data model
Snippet { id: int }

## API contract
POST /api/snippets 201
`;
  const t = parseTasks(TASKS)[0]!;
  const ex = designExcerptFor(design, t);
  assert.match(ex, /src\/store\/sqlite\.js/);
  assert.doesNotMatch(ex, /src\/search\/like\.js/);
  assert.match(ex, /### SnippetReader/);
  assert.match(ex, /### SnippetWriter/);
  assert.doesNotMatch(ex, /### SearchIndex/);
  assert.match(ex, /## Wiring/);
  assert.match(ex, /## API contract/);
});

test("validateTasks: test files and architect docs under Files: are rejected, missing Tests: too", () => {
  const ok = parseTasks(TASKS);
  assert.deepEqual(validateTasks(ok), []);
  const bad = parseTasks("## T9: x\nRequirements: R1\nFiles: test/a.test.js, DESIGN.md, src/ok.js\nTests: \nCommands: npm test\nParallel: no\nGoal: g\n");
  const problems = validateTasks(bad).map((p) => p.problem);
  assert.ok(problems.some((p) => /names test file/.test(p)));
  assert.ok(problems.some((p) => /architect document/.test(p)));
  assert.ok(problems.some((p) => /names no tests/.test(p)));
});

test("looksLikeProse: instructions are rejected, shell lines are not", () => {
  assert.equal(looksLikeProse("npm start (background) then curl http://localhost:3000/ expect 200"), true);
  assert.equal(looksLikeProse("then stop it"), true);
  assert.equal(looksLikeProse("Manual verification per QA.md"), true);
  assert.equal(looksLikeProse("npm test -- test/x.test.js"), false);
  assert.equal(looksLikeProse("go test ./..."), false);
  assert.equal(looksLikeProse("sh -c 'npm start & sleep 2; curl -sf localhost:3000/; kill %1'"), false);
  const bad = parseTasks("## T6: docs\nRequirements: R1\nFiles: README.md\nTests: test/a.test.js\nCommands: npm test, npm start (background) then curl localhost:3000 expect 200\nParallel: no\nGoal: g\n");
  assert.ok(validateTasks(bad).some((p) => /Commands: contains prose/.test(p.problem)));
});

const JOB = `# Snippet vault

## Must have (v1)
- Create, edit, delete a snippet: title, language, body, tags.
- Full-text search across title, body, and tags.
* Copy-to-clipboard button on every snippet.

## Nice to have (later)
- Syntax highlighting.
`;

test("mustHavesOf: the job's Must have bullets in order, nothing from other sections", () => {
  assert.deepEqual(mustHavesOf(JOB), ["Create, edit, delete a snippet: title, language, body, tags.", "Full-text search across title, body, and tags.", "Copy-to-clipboard button on every snippet."]);
  assert.deepEqual(mustHavesOf("fix the 404 route"), []);
  assert.deepEqual(mustHavesOf("## Must-haves\n1. one\n2. two\n"), ["one", "two"]);
});

const REQ_WF = `# Requirements

## Acceptance criteria

- **R1** WHEN a user posts THE SYSTEM SHALL store.
  Check: POST -> 201
- **R2** WHEN a user edits in the browser THE SYSTEM SHALL save.
  Check: open /, click Edit, type, Save, card shows new title
- **R3** WHEN the box changes THE SYSTEM SHALL filter.
  Check: type, list shrinks

## Workflows

- **W1** create, find, edit (R1, R3)
  1. post a snippet (R1)
  2. type its title in the search box; one card (R3)
  3. click Edit on the card, change the title, Save (R2)
- **W2** orphan — no ids here
  1. do a thing

## Coverage

- M1: R1, R2
- **M2** → R3
- M3: R9

## Decisions

- Job kind: build
`;

test("parseWorkflows: markdown form collects ids from the heading and the steps; machine block wins", () => {
  const w = parseWorkflows(REQ_WF);
  assert.equal(w.length, 2);
  assert.equal(w[0]!.id, "W1");
  assert.equal(w[0]!.title, "create, find, edit");
  assert.deepEqual(w[0]!.requirements, ["R1", "R3", "R2"]);
  assert.equal(w[0]!.steps.length, 3);
  assert.deepEqual(w[1]!.requirements, []);
  const machine = REQ_WF + '\n```json requirements\n{ "requirements": [{ "id": "R1", "text": "t" }], "workflows": [{ "id": "W9", "title": "m", "requirements": ["R1"], "steps": ["s"] }], "coverage": { "M1": ["R1"] } }\n```\n';
  assert.deepEqual(parseWorkflows(machine), [{ id: "W9", title: "m", requirements: ["R1"], steps: ["s"] }]);
  assert.deepEqual(parseCoverage(machine), { M1: ["R1"] });
});

test("parseCoverage: markdown lines with colon or arrow, bold or plain ids", () => {
  assert.deepEqual(parseCoverage(REQ_WF), { M1: ["R1", "R2"], M2: ["R3"], M3: ["R9"] });
  assert.equal(parseCoverage("# nothing"), undefined);
});

test("requirementsGaps: uncovered must-haves, must-haves no workflow walks, workflows with bad ids, and a build with none", () => {
  const reqs = parseRequirements(REQ_WF);
  const workflows = parseWorkflows(REQ_WF);
  const coverage = parseCoverage(REQ_WF);
  const mustHaves = ["create/edit/delete", "search", "copy", "persist"];
  const gaps = requirementsGaps({ mustHaves, coverage, requirements: reqs, workflows, jobKind: "build" });
  assert.ok(gaps.some((g) => /M3 "copy" is covered by no requirement/.test(g)), gaps.join("\n"));
  assert.ok(gaps.some((g) => /M4 "persist" is covered by no requirement/.test(g)));
  assert.ok(gaps.some((g) => /W2 names no requirement ids/.test(g)));
  assert.ok(!gaps.some((g) => /M1|M2/.test(g)), "M1 and M2 are covered and walked");
  // a must-have covered by a requirement that no workflow walks
  const g2 = requirementsGaps({ mustHaves: ["x"], coverage: { M1: ["R1"] }, requirements: reqs, workflows: [{ id: "W1", title: "t", requirements: ["R3"], steps: ["s"] }], jobKind: "build" });
  assert.ok(g2.some((g) => /M1 "x" \(R1\) is walked by no workflow/.test(g)), g2.join("\n"));
  // no workflows at all: a build must have one; a repair without must-haves need not
  assert.ok(requirementsGaps({ mustHaves: [], requirements: reqs, workflows: [], jobKind: "build" }).some((g) => /no workflows/.test(g)));
  assert.deepEqual(requirementsGaps({ mustHaves: [], requirements: reqs, workflows: [], jobKind: "repair" }), []);
  // everything covered
  assert.deepEqual(requirementsGaps({ mustHaves: ["a"], coverage: { M1: ["R1"] }, requirements: reqs, workflows: [workflows[0]!], jobKind: "build" }), []);
});

test("QA scenarios reference a workflow id; traceability demands a scenario per workflow", () => {
  const qa = parseQaScenarios("## Q1 (R1): a\nWhen: x\n\n## Q7 (W1): walk\nWhen:\n  1. a\n  2. b\n");
  assert.deepEqual(qa.map((q) => [q.id, q.requirement]), [["Q1", "R1"], ["Q7", "W1"]]);
  const reqs = parseRequirements(REQ);
  const tasks = parseTasks(TASKS);
  const scenarios = parseQaScenarios(QA);
  const tests = [{ path: "test/a.test.js", text: 'test("R1: creates", ...)\ntest("R2: restart", ...)' }];
  const workflows = [{ id: "W1", title: "t", requirements: ["R1", "R2"], steps: ["s"] }];
  const t = traceability(reqs, tasks, scenarios, tests, workflows);
  assert.deepEqual(t.uncovered, [{ id: "W1", missing: ["qa"] }]);
  const withQa = traceability(reqs, tasks, [...scenarios, { id: "Q9", requirement: "W1", body: "" }], tests, workflows);
  assert.deepEqual(withQa.uncovered, []);
  assert.deepEqual(withQa.covered, ["R1", "R2", "W1"]);
});
