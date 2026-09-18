import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CRITERIA,
  RubricParseError,
  anonymise,
  formatComparisonTable,
  formatHygiene,
  medianScores,
  parseCandidateSpec,
  parseRubric,
  resolveHeadRef,
  scoreCandidate,
  scrubText,
  type Rubric,
} from "./quality-review.js";

const good = (over: Partial<Record<(typeof CRITERIA)[number], number>> = {}, verdict = "merge") => {
  const scores: Record<string, { score: number; evidence: string[] }> = {};
  for (const c of CRITERIA) scores[c] = { score: over[c] ?? 4, evidence: [`src/x.js:${c.length}`] };
  return `summary\n\`\`\`json\n${JSON.stringify({ scores, total: 0, blocking_issues: [], verdict })}\n\`\`\``;
};

test("parseRubric validates criteria, ranges, evidence, verdict, and recomputes total", () => {
  const r = parseRubric(good({ tests: 2 }));
  assert.equal(r.total, 4 * 6 + 2);
  assert.equal(r.verdict, "merge");
  assert.throws(() => parseRubric("no json"), RubricParseError);
  assert.throws(() => parseRubric(good({ security: 6 })), /security: score must be/);
  assert.throws(() => parseRubric(good({}, "ship")), /verdict/);
  const noEvidence = good().replace(/"evidence":\["src\/x\.js:11"\]/, '"evidence":[]');
  assert.throws(() => parseRubric(noEvidence), /needs evidence/);
  const missing = good().replace('"readme":', '"docs":');
  assert.throws(() => parseRubric(missing), /criterion readme/);
});

test("medianScores over two and three runs", () => {
  const a = parseRubric(good({ tests: 2 }));
  const b = parseRubric(good({ tests: 4 }));
  const c = parseRubric(good({ tests: 5 }));
  assert.equal(medianScores([a, b]).scores.tests, 3);
  assert.equal(medianScores([a, b, c]).scores.tests, 4);
  assert.equal(medianScores([a, b]).total, (26 + 28) / 2);
});

test("scrubText removes engine words, the repo name, and co-author lines", () => {
  const out = scrubText("Built by Claude Sonnet for sv-hybrid via Cursor.\nCo-Authored-By: Claude <x>\nqwen3-coder-next", ["sv-hybrid"]);
  assert.doesNotMatch(out, /claude|cursor|sv-hybrid|qwen|Co-Authored/i);
  assert.match(out, /\[redacted\]/);
});

test("anonymise copies, strips history and tool dirs, scrubs package name, records hygiene", () => {
  const src = mkdtempSync(join(tmpdir(), "qr-src-"));
  try {
    mkdirSync(join(src, ".qwen", "x"), { recursive: true });
    mkdirSync(join(src, "dist"), { recursive: true });
    writeFileSync(join(src, ".qwen", "x", "s.md"), "junk");
    writeFileSync(join(src, "dist", "a.js"), "x");
    writeFileSync(join(src, "package.json"), JSON.stringify({ name: "sv-hybrid", description: "made with qwen", author: "me" }));
    writeFileSync(join(src, "README.md"), "# sv-hybrid\nBuilt on Claude Max via hybrid engine.\n");
    writeFileSync(join(src, "package-lock.json"), "{}");
    writeFileSync(join(src, ".aider.chat.history.md"), "x");
    execFileSync("git", ["init", "-q"], { cwd: src });
    execFileSync("git", ["add", "-A"], { cwd: src });
    execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "-m", "x"], { cwd: src });
    const root = mkdtempSync(join(tmpdir(), "qr-root-"));
    const { dir, hygiene } = anonymise(src, { root });
    try {
      assert.ok(!existsSync(join(dir, ".git")));
      assert.ok(!existsSync(join(dir, ".qwen")));
      assert.ok(!existsSync(join(dir, ".aider.chat.history.md")));
      assert.deepEqual(hygiene.removedDirs.sort(), [".git", ".qwen"]);
      assert.deepEqual(hygiene.removedFiles, [".aider.chat.history.md"]);
      assert.ok(hygiene.trackedArtifacts.includes("dist/a.js"));
      assert.ok(hygiene.trackedArtifacts.includes(".qwen/x/s.md"));
      assert.equal(hygiene.hadLockfile, true);
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      assert.equal(pkg.name, "candidate");
      assert.equal(pkg.author, undefined);
      assert.doesNotMatch(pkg.description, /qwen/i);
      const readme = readFileSync(join(dir, "README.md"), "utf8");
      assert.doesNotMatch(readme, /sv-hybrid|claude|hybrid/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});

test("parseCandidateSpec: url@ref vs local path, engine override by target", () => {
  const u = parseCandidateSpec("https://github.com/o/r@claude/abc", { "https://github.com/o/r": "claude" });
  assert.equal(u.repo, "https://github.com/o/r");
  assert.equal(u.ref, "claude/abc");
  assert.equal(u.engine, "claude");
  assert.match(u.label, /^candidate-[0-9a-f]{4}$/);
  const p = parseCandidateSpec("./some/dir");
  assert.equal(p.path, "./some/dir");
  assert.equal(p.repo, undefined);
});

test("resolveHeadRef: override, open PR head, default branch, then main", () => {
  assert.equal(resolveHeadRef("https://github.com/o/r", "x"), "x");
  const pr = (args: string[]) => (args[0] === "pr" ? JSON.stringify([{ headRefName: "claude/1" }]) : "{}");
  assert.equal(resolveHeadRef("https://github.com/o/r", undefined, pr), "claude/1");
  const def = (args: string[]) => (args[0] === "pr" ? "[]" : JSON.stringify({ defaultBranchRef: { name: "develop" } }));
  assert.equal(resolveHeadRef("https://github.com/o/r", undefined, def), "develop");
  assert.equal(resolveHeadRef("https://github.com/o/r", undefined, () => { throw new Error("no gh"); }), "main");
});

test("scoreCandidate: anonymised dir goes to a fresh read-only send, rubric parsed, medians and cost recorded", async () => {
  const src = mkdtempSync(join(tmpdir(), "qr-src-"));
  writeFileSync(join(src, "README.md"), "# thing\n");
  const seen: { cwd: string; opts: unknown }[] = [];
  let n = 0;
  try {
    const result = await scoreCandidate(parseCandidateSpec(src), {
      job: "j",
      repeat: 2,
      sendFor: (cwd, onCost) => async (_prompt, opts) => {
        seen.push({ cwd, opts });
        onCost(0.5);
        n++;
        return { status: "finished", result: good({ tests: n === 1 ? 2 : 4 }) };
      },
    });
    assert.equal(result.runs.length, 2);
    assert.equal(result.median.scores.tests, 3);
    assert.equal(result.runs.reduce((s, r) => s + r.usd, 0), 1);
    assert.ok(seen[0]!.cwd.includes("candidate-"));
    assert.notEqual(seen[0]!.cwd, src, "the reviewer sees the anonymised copy, never the source");
    assert.deepEqual(seen[0]!.opts, { mode: "agent", fresh: true });
    assert.ok(!existsSync(seen[0]!.cwd), "anonymised copy removed afterwards");
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});

test("formatComparisonTable sorts by median total and shows a delta line", () => {
  const mk = (engine: string, tests: number): Parameters<typeof formatComparisonTable>[0][number] => {
    const r: Rubric = parseRubric(good({ tests }));
    return { candidate: { spec: engine, label: "c", engine, path: `/x/${engine}` }, hygiene: { removedDirs: [], removedFiles: [], hadLockfile: true, hadGitignore: true, trackedArtifacts: [] }, runs: [{ rubric: r, usd: 0.4 }], median: medianScores([r]), verdicts: [r.verdict] };
  };
  const table = formatComparisonTable([mk("hybrid", 2), mk("claude", 5)]);
  const lines = table.split("\n");
  assert.match(lines[0]!, /^engine\s+repo\s+corre/);
  assert.ok(lines[2]!.startsWith("claude"), lines.join("\n"));
  assert.ok(lines[3]!.startsWith("hybrid"));
  assert.match(table, /best median total 29/);
});

test("formatHygiene never names the tool that left the state behind", () => {
  const out = formatHygiene({ removedDirs: [".git", ".qwen", ".cursor"], removedFiles: [".aider.chat.history.md"], hadLockfile: true, hadGitignore: true, trackedArtifacts: [".qwen/pending-skills/x/SKILL.md", "dist/a.js"] });
  assert.doesNotMatch(out, /qwen|cursor|aider|claude/i);
  assert.match(out, /2 directories/);
  assert.match(out, /2 file\(s\)/);
});
