import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stageAll } from "./engine-local.js";

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "stage-all-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
const staged = (cwd: string) => execFileSync("git", ["diff", "--cached", "--name-only"], { cwd, encoding: "utf8" }).trim().split("\n").filter(Boolean).sort();

test("stageAll stages the work, skips a file git cannot index, and names it", () => {
  const cwd = repo();
  writeFileSync(join(cwd, "app.py"), "print(1)\n");
  mkdirSync(join(cwd, "fixtures"));
  writeFileSync(join(cwd, "fixtures", "locked.txt"), "secret\n");
  chmodSync(join(cwd, "fixtures", "locked.txt"), 0o000);
  const lines: string[] = [];
  try {
    const skipped = stageAll(cwd, (l) => lines.push(l));
    assert.deepEqual(skipped, ["fixtures/locked.txt"]);
    assert.deepEqual(staged(cwd), ["app.py"]);
    assert.match(lines[0]!, /skipped what git cannot index: fixtures\/locked\.txt/);
  } finally {
    chmodSync(join(cwd, "fixtures", "locked.txt"), 0o644);
  }
});

test("stageAll keeps a check probe's mktemp scratch out of commits, without touching .gitignore", () => {
  const cwd = repo();
  writeFileSync(join(cwd, "dedupe.py"), "x = 1\n");
  mkdirSync(join(cwd, "tmp.V0dvOP"));
  writeFileSync(join(cwd, "tmp.V0dvOP", "a.txt"), "probe\n");
  writeFileSync(join(cwd, "tmp.5gy9pM"), "probe\n");
  writeFileSync(join(cwd, "tmp.config.js"), "export default {}\n");
  assert.deepEqual(stageAll(cwd), []);
  assert.deepEqual(staged(cwd), ["dedupe.py", "tmp.config.js"], "a real file named tmp.* with an extension is kept");
  assert.match(readFileSync(join(cwd, ".git", "info", "exclude"), "utf8"), /^\/tmp\.\?\?\?\?\?\?$/m);
  stageAll(cwd);
  const lines = readFileSync(join(cwd, ".git", "info", "exclude"), "utf8").split("\n").filter((l) => l.startsWith("/tmp."));
  assert.equal(lines.length, 3, "idempotent");
});
