import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { makeRepoIO } from "./io.js";

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "io-fixture-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "test"), { recursive: true });
  writeFileSync(join(dir, "src", "app.js"), "export const x = 1;\n");
  writeFileSync(join(dir, "test", "app.test.js"), 'import { test } from "node:test";\ntest("R1: x", () => {});\n');
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "f", type: "module", scripts: { test: "node --test test/*.test.js" } }));
  const git = (a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "-m", "init"]);
  return dir;
}

test("makeRepoIO over a real checkout: files, tests, shas, commits, commands, fresh clone, diff stat", async () => {
  const dir = fixture();
  const work = mkdtempSync(join(tmpdir(), "io-work-"));
  try {
    const io = makeRepoIO(dir, { workRoot: work, gateCfg: { enabled: true, retries: 0, startTimeoutMs: 1000, commandTimeoutMs: 30_000, vacuous: "", startEvery: 0 } });
    assert.equal(io.readFile("README.md"), "# fixture\n");
    assert.equal(io.readFile("nope.md"), undefined);
    assert.deepEqual(io.listTests().map((t) => t.path), ["test/app.test.js"]);
    const base = io.headSha();
    assert.match(base, /^[0-9a-f]{40}$/);
    assert.equal(io.commit("nothing to commit"), false);
    writeFileSync(join(dir, "src", "app.js"), "export const x = 2;\n");
    assert.equal(io.commit("crew: change"), true);
    assert.notEqual(io.headSha(), base);
    assert.match(io.diffStat(base), /src\/app\.js/);
    const ok = await io.runCommand("exit 0");
    assert.equal(ok.code, 0);
    const bad = await io.runCommand("echo boom >&2; exit 3");
    assert.equal(bad.code, 3);
    assert.match(bad.output, /boom/);
    const clone = await io.freshClone();
    assert.ok(clone.startsWith(work));
    assert.ok(existsSync(join(clone, "src", "app.js")));
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: clone, encoding: "utf8" }).trim(), io.headSha());
    const gate = await io.gate("task", { allowedFiles: ["src/app.js"], baseSha: base });
    assert.equal(gate.passed, true, JSON.stringify(gate.findings));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});
