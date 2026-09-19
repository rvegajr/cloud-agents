import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileLessonsStore, formatLesson, parseLessons, priorLessonsNote, selectLessons, tagsForProblem, type Lesson } from "./lessons.js";

const LEDGER = `# Lessons

<!-- preamble a person wrote -->

## L-2026-09-18-01
Tags:     kind:build stage:devise domain:software
When:     a unit pastes content that also lives in a file
Lesson:   name the file as the owner
Evidence: the house, U8
Status:   candidate

## L-2026-09-18-02
Tags:     kind:repair stage:understand
When:     a D crosses sub-problems
Lesson:   keep the D in PROBLEM.md
Evidence: the house, P2
Status:   confirmed(2)

## L-2026-01-01-01
Tags:     kind:answer
When:     never
Lesson:   retired thing
Evidence: none
Status:   retired
`;

test("parseLessons / formatLesson round-trip", () => {
  const all = parseLessons(LEDGER);
  assert.deepEqual(all.map((l) => l.id), ["L-2026-09-18-01", "L-2026-09-18-02", "L-2026-01-01-01"]);
  assert.deepEqual(all[0]!.tags, ["kind:build", "stage:devise", "domain:software"]);
  assert.equal(all[1]!.status, "confirmed");
  assert.equal(all[1]!.confirmations, 2);
  assert.equal(all[2]!.status, "retired");
  assert.deepEqual(parseLessons(formatLesson(all[1]!)), [all[1]]);
});

test("selectLessons: the whole active ledger when small, tag intersection when large", () => {
  const all = parseLessons(LEDGER);
  assert.deepEqual(selectLessons(all, ["kind:repair"]).map((l) => l.id), ["L-2026-09-18-01", "L-2026-09-18-02"]);
  const many: Lesson[] = Array.from({ length: 45 }, (_, i) => ({ id: `L-x-${i}`, tags: [i % 2 ? "kind:repair" : "kind:build"], when: "", lesson: "l", evidence: "", status: "candidate", confirmations: 0 }));
  assert.equal(selectLessons(many, ["kind:repair"]).length, 22);
  assert.equal(selectLessons(many, ["KIND:REPAIR"]).length, 22);
});

test("fileLessonsStore: append numbers ids by day, keeps the preamble, confirm increments", () => {
  const dir = mkdtempSync(join(tmpdir(), "polya-lessons-"));
  const path = join(dir, "LESSONS.md");
  writeFileSync(path, LEDGER);
  const store = fileLessonsStore(path);
  const added = store.append([{ tags: ["kind:repair"], when: "w", lesson: "new one", evidence: "e" }, { tags: [], when: "", lesson: "   ", evidence: "" }], new Date("2026-09-18T12:00:00Z"));
  assert.deepEqual(added.map((l) => l.id), ["L-2026-09-18-03"]);
  const text = readFileSync(path, "utf8");
  assert.match(text, /preamble a person wrote/);
  assert.match(text, /## L-2026-09-18-03\nTags:     kind:repair/);
  store.confirm(["L-2026-09-18-01", "L-2026-09-18-02", "L-2026-01-01-01"]);
  const after = store.list();
  assert.equal(after.find((l) => l.id === "L-2026-09-18-01")!.status, "confirmed");
  assert.equal(after.find((l) => l.id === "L-2026-09-18-01")!.confirmations, 1);
  assert.equal(after.find((l) => l.id === "L-2026-09-18-02")!.confirmations, 3);
  assert.equal(after.find((l) => l.id === "L-2026-01-01-01")!.status, "retired");
  const fresh = fileLessonsStore(join(dir, "nested", "NEW.md"));
  assert.deepEqual(fresh.list(), []);
  fresh.append([{ tags: ["a"], when: "w", lesson: "first", evidence: "e" }], new Date("2026-09-19T00:00:00Z"));
  assert.match(readFileSync(fresh.path, "utf8"), /^# Lessons[\s\S]*## L-2026-09-19-01/);
});

test("tagsForProblem and priorLessonsNote", () => {
  const tags = tagsForProblem("Fix the bug where copying a body with & pastes &amp; in src/app.js", "https://github.com/you/snippet-vault");
  assert.ok(tags.includes("kind:repair"));
  assert.ok(tags.includes("repo:snippet-vault"));
  assert.ok(tags.includes("ext:js"));
  assert.equal(priorLessonsNote([]), "(no prior lessons)");
  const note = priorLessonsNote(parseLessons(LEDGER).slice(0, 1), "# Look back: earlier\nfine");
  assert.match(note, /^### The last look back in this repo/);
  assert.match(note, /## L-2026-09-18-01/);
  assert.match(priorLessonsNote(parseLessons(LEDGER), undefined, 200), /truncated at 200/);
});
