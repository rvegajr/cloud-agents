import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runQualityGate,
  detectAppType,
  discoverQualityBar,
  gateConfigFromEnv,
  gateFeedbackNote,
  hygieneFindings,
  ownershipFindings,
  tamperEslintFindings,
  tamperFindings,
  type GateResult,
} from "./quality-gate.js";

test("gateConfigFromEnv defaults and overrides", () => {
  const d = gateConfigFromEnv({});
  assert.equal(d.enabled, true);
  assert.equal(d.retries, 2);
  assert.equal(d.startTimeoutMs, 30_000);
  assert.equal(d.commandTimeoutMs, 10 * 60_000);
  assert.equal(d.vacuous, "finish");
  assert.equal(d.startEvery, 3);
  assert.equal(gateConfigFromEnv({ LOCAL_GATE: "0" }).enabled, false);
  assert.equal(gateConfigFromEnv({ LOCAL_GATE_VACUOUS: "every" }).vacuous, "every");
  assert.equal(gateConfigFromEnv({ LOCAL_GATE_VACUOUS: "0" }).vacuous, "");
  assert.equal(gateConfigFromEnv({ LOCAL_GATE_RETRIES: "5" }).retries, 5);
});

test("discoverQualityBar prefers package.json scripts and flags spec-promised-but-missing", () => {
  const pkg = { scripts: { test: "node --test", lint: "eslint ." } };
  const { toRun } = discoverQualityBar("/tmp/does-not-matter", pkg);
  assert.deepEqual(toRun.sort(), ["lint", "test"]);
});

test("detectAppType: bin -> cli, express dep -> http, plain lib -> library", () => {
  assert.deepEqual(detectAppType({ bin: "./bin/cli.js" }), { type: "cli", start: ["node", "./bin/cli.js", "--help"] });
  assert.deepEqual(detectAppType({ bin: { slug: "./bin/slug.js" } }), { type: "cli", start: ["node", "./bin/slug.js", "--help"] });
  const http = detectAppType({ dependencies: { express: "^4.0.0" } });
  assert.equal(http.type, "http");
  assert.equal(detectAppType({ scripts: { start: "node server.js" } }).type, "http");
  assert.equal(detectAppType({}).type, "library");
  assert.equal(detectAppType(undefined).type, "library");
});

test("ownershipFindings: new tests/config are fine, modifying an existing one is not, architect docs are hard-owned", () => {
  const clean = ownershipFindings([{ path: "src/routes/snippets.js", status: "M" }], ["src/routes/snippets.js"]);
  assert.deepEqual(clean, [{ rule: "ownership", ok: true, detail: "diff stayed within owned files" }]);

  // M1 creating a fresh eslint config and a fresh test is normal and allowed.
  const created = ownershipFindings([
    { path: "eslint.config.js", status: "A" },
    { path: "test/app.test.js", status: "A" },
    { path: "src/app.js", status: "A" },
  ]);
  assert.deepEqual(created, [{ rule: "ownership", ok: true, detail: "diff stayed within owned files" }]);

  // Going back later to change an existing eslint config or test is the "bend the gate" pattern.
  const configEdit = ownershipFindings([{ path: "eslint.config.js", status: "M" }, { path: "src/app.js", status: "M" }]);
  assert.equal(configEdit.some((f) => !f.ok && /modified an existing test or tooling config/.test(f.detail)), true);

  const testEdit = ownershipFindings([{ path: "test/snippets.test.js", status: "M" }]);
  assert.equal(testEdit.some((f) => !f.ok && /modified an existing test or tooling config/.test(f.detail)), true);

  // ROADMAP.md is not architect-owned: iterate.md requires the crew to tick its own status lines.
  const roadmap = ownershipFindings([{ path: "ROADMAP.md", status: "M" }]);
  assert.deepEqual(roadmap, [{ rule: "ownership", ok: true, detail: "diff stayed within owned files" }]);

  // SPEC.md and a blueprint's TASKS.md/QA.md are hard-owned regardless of A or M.
  const specTouch = ownershipFindings([{ path: "SPEC.md", status: "A" }]);
  assert.equal(specTouch.some((f) => !f.ok && /architect-owned document/.test(f.detail)), true);

  const outOfScope = ownershipFindings([{ path: "src/other.js", status: "A" }], ["src/routes/snippets.js"]);
  assert.equal(outOfScope.some((f) => !f.ok && /outside this task's scope/.test(f.detail)), true);
});

test("hygieneFindings catches the exact snippet-vault offenders", () => {
  const files = [
    ".qwen/pending-skills/x/SKILL.md",
    "dist/server.js",
    "data.db",
    "src/app.js",
  ];
  const findings = hygieneFindings(files, "node_modules/\n");
  const rules = findings.filter((f) => !f.ok).map((f) => f.detail);
  assert.equal(rules.some((d) => d.includes(".qwen/")), true);
  assert.equal(rules.some((d) => d.includes("build output")), true);
  assert.equal(rules.some((d) => d.includes("database file")), true);

  const clean = hygieneFindings(["src/app.js", "README.md"], "node_modules/\ndist/\n");
  assert.deepEqual(clean, [{ rule: "hygiene", ok: true, detail: "no tool state, build output, or secrets tracked" }]);
});

test("tamperFindings: script drift, vacuous test file, .only/.skip, stub server", () => {
  const scriptDrift = tamperFindings({
    scriptsBefore: { test: "node --test" },
    scriptsAfter: { test: "echo ok" },
    testSources: [],
    srcModules: [],
  });
  assert.equal(scriptDrift.some((f) => !f.ok && /scripts changed/.test(f.detail)), true);

  const vacuous = tamperFindings({
    testSources: [{ path: "test/server.test.js", text: 'import http from "node:http";\nconst s = http.createServer((req,res)=>res.end());\ntest("ok", ()=>{ s.close(); });' }],
    srcModules: ["src/app.js", "src/db.js"],
  });
  assert.equal(vacuous.some((f) => !f.ok && /imports no app module/.test(f.detail)), true);
  assert.equal(vacuous.some((f) => !f.ok && /stub server/.test(f.detail)), true);

  const skipped = tamperFindings({
    testSources: [{ path: "test/x.test.js", text: 'import "../src/app.js";\ntest.skip("x", ()=>{});' }],
    srcModules: ["src/app.js"],
  });
  assert.equal(skipped.some((f) => !f.ok && /skipped\/only/.test(f.detail)), true);

  const clean = tamperFindings({
    testSources: [{ path: "test/app.test.js", text: 'import { createApp } from "../src/app.js";\ntest("works", () => {});' }],
    srcModules: ["src/app.js"],
  });
  assert.deepEqual(clean, [{ rule: "tamper", ok: true, detail: "no config drift or vacuous test file detected" }]);
});

test("tamperEslintFindings flags a varsIgnorePattern bent around a specific variable", () => {
  const bent = tamperEslintFindings('rules: { "no-unused-vars": ["error", { varsIgnorePattern: "^_|updatedSnippet" }] }');
  assert.equal(bent.length, 1);
  assert.match(bent[0]!.detail, /updatedSnippet/);

  const standard = tamperEslintFindings('rules: { "no-unused-vars": ["error", { varsIgnorePattern: "^_" }] }');
  assert.deepEqual(standard, []);

  assert.deepEqual(tamperEslintFindings(undefined), []);
});

test("gateFeedbackNote embeds failing rules, commands, and output tail", () => {
  const result: GateResult = {
    passed: false,
    seconds: 12,
    skipped: [],
    findings: [
      { rule: "quality-bar", ok: false, detail: "npm test exited 1", command: "npm test", output: "line1\nline2" },
      { rule: "hygiene", ok: true, detail: "clean" },
    ],
  };
  const note = gateFeedbackNote(2, result);
  assert.match(note, /attempt 2/);
  assert.match(note, /npm test exited 1/);
  assert.match(note, /`npm test`/);
  assert.match(note, /line1/);
  assert.doesNotMatch(note, /clean/);
});

test("hygieneFindings honours a QUALITY.md pattern list instead of the defaults", () => {
  const py = hygieneFindings([".venv/bin/python", "src/app.py", "__pycache__/x.pyc"], "", [".venv/", "__pycache__/", "*.pyc"]);
  const bad = py.filter((f) => !f.ok).map((f) => f.detail);
  assert.equal(bad.length, 3);
  assert.ok(bad.some((d) => d.startsWith(".venv/")));
  // node_modules is not in the custom list, so it is not flagged by it
  const custom = hygieneFindings(["node_modules/x.js"], "", [".venv/"]);
  assert.equal(custom[0]!.ok, true);
});

test("runQualityGate runs QUALITY.md bar commands through sh, in order, and probes start from the contract", async () => {
  const calls: string[] = [];
  const exec = async (cmd: { file: string; args: string[] }) => {
    calls.push(`${cmd.file} ${cmd.args.join(" ")}`);
    if (cmd.file === "git" && cmd.args[0] === "ls-files") return { stdout: "src/app.py\n", stderr: "", code: 0 };
    if (cmd.file === "git" && cmd.args[0] === "diff") return { stdout: "M\tsrc/app.py\n", stderr: "", code: 0 };
    if (cmd.file === "git") return { stdout: "", stderr: "", code: 0 };
    return { stdout: "ok", stderr: "", code: 0 };
  };
  const quality = { bar: { install: "uv sync", test: "pytest -q", lint: "ruff check ." }, hygieneNeverTracked: [".venv/"], rubricTargets: {} };
  const cfg = { enabled: true, retries: 0, startTimeoutMs: 1000, commandTimeoutMs: 1000, vacuous: "" as const, startEvery: 0 };
  const r = await runQualityGate("/tmp/nowhere", cfg, "iterate", { exec, quality, allowedFiles: ["src/app.py"], baseSha: "abc123" });
  assert.equal(r.passed, true, JSON.stringify(r.findings));
  assert.ok(calls.includes("git diff --name-status abc123..HEAD"), calls.join("\n"));
  const sh = calls.filter((c) => c.startsWith("sh -c "));
  assert.deepEqual(sh, ["sh -c ruff check .", "sh -c pytest -q"], "lint before test, install never run as a bar command");
});

test("runQualityGate: ownership scope from allowedFiles fails an out-of-scope edit", async () => {
  const exec = async (cmd: { file: string; args: string[] }) => {
    if (cmd.file === "git" && cmd.args[0] === "diff") return { stdout: "M\tsrc/other.py\n", stderr: "", code: 0 };
    return { stdout: "", stderr: "", code: 0 };
  };
  const quality = { bar: { test: "pytest -q" }, hygieneNeverTracked: [".venv/"], rubricTargets: {} };
  const cfg = { enabled: true, retries: 0, startTimeoutMs: 1000, commandTimeoutMs: 1000, vacuous: "" as const, startEvery: 0 };
  const r = await runQualityGate("/tmp/nowhere", cfg, "iterate", { exec, quality, allowedFiles: ["src/app.py"] });
  assert.equal(r.passed, false);
  assert.ok(r.findings.some((f) => f.rule === "ownership" && !f.ok && /outside this task's scope/.test(f.detail)));
});

test("task profile: taskCommands replace the bar's test command; lint still runs; finish runs the full bar", async () => {
  const calls: string[] = [];
  const exec = async (cmd: { file: string; args: string[] }) => {
    calls.push(`${cmd.file} ${cmd.args.join(" ")}`);
    if (cmd.file === "git" && cmd.args[0] === "diff") return { stdout: "M\tsrc/a.js\n", stderr: "", code: 0 };
    return { stdout: "", stderr: "", code: 0 };
  };
  const quality = { bar: { lint: "npm run lint", test: "npm test" }, hygieneNeverTracked: [".venv/"], rubricTargets: {} };
  const cfg = { enabled: true, retries: 0, startTimeoutMs: 1000, commandTimeoutMs: 1000, vacuous: "" as const, startEvery: 0 };
  await runQualityGate("/tmp/nowhere", cfg, "iterate", { exec, quality, allowedFiles: ["src/a.js"], taskCommands: ["npm test -- test/a.test.js"] });
  const sh = calls.filter((c) => c.startsWith("sh -c "));
  assert.deepEqual(sh, ["sh -c npm run lint", "sh -c npm test -- test/a.test.js"]);
  calls.length = 0;
  await runQualityGate("/tmp/nowhere", { ...cfg, startEvery: 0 }, "finish", { exec, quality, taskCommands: ["npm test -- test/a.test.js"] });
  const shFinish = calls.filter((c) => c.startsWith("sh -c "));
  assert.deepEqual(shFinish.slice(0, 2), ["sh -c npm run lint", "sh -c npm test"], "finish ignores taskCommands and runs the whole bar");
});

test("task profile never runs the clean-start probe, even with startEvery=1", async () => {
  const calls: string[] = [];
  const exec = async (cmd: { file: string; args: string[] }) => {
    calls.push(`${cmd.file} ${cmd.args.join(" ")}`);
    return { stdout: "", stderr: "", code: 0 };
  };
  const quality = { bar: { test: "npm test" }, start: { command: "npm start", probe: { http: "/", expect: 200 } }, hygieneNeverTracked: [], rubricTargets: {} };
  const cfg = { enabled: true, retries: 0, startTimeoutMs: 500, commandTimeoutMs: 1000, vacuous: "" as const, startEvery: 1 };
  const r = await runQualityGate("/tmp/nowhere", cfg, "iterate", { exec, quality, taskCommands: ["npm test -- x"] });
  assert.ok(!calls.some((c) => /git clone/.test(c)), calls.join("\n"));
  assert.ok(r.skipped.includes("clean-start"));
});

test("finish profile: architect documents in the job-wide diff are not ownership violations; out-of-scope code still is", () => {
  const changes = [
    { path: "TASKS.md", status: "M" },
    { path: "REQUIREMENTS.md", status: "A" },
    { path: "src/app.js", status: "M" },
  ];
  const finish = ownershipFindings(changes, ["src/app.js"], { finish: true });
  assert.deepEqual(finish, [{ rule: "ownership", ok: true, detail: "diff stayed within owned files" }]);
  const stray = ownershipFindings([...changes, { path: "src/other.js", status: "A" }], ["src/app.js"], { finish: true });
  assert.ok(stray.some((f) => !f.ok && /outside this task's scope/.test(f.detail)));
  const task = ownershipFindings(changes, ["src/app.js"]);
  assert.ok(task.some((f) => !f.ok && /architect-owned document/.test(f.detail)), "a task turn still may not touch them");
});
