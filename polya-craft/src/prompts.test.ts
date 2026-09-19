import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt } from "../../src/lib/prompts.js";
import { classifyPrompt, policyFromEnv, preferredTier } from "../../src/lib/routing.js";
import { gateFeedbackNote } from "../../architect-crew-gate/src/quality-gate.js";

const SLOTS: Record<string, Record<string, string>> = {
  understand: { problem: "p", repo: "r", prior_lessons: "-" },
  devise: { problem_md: "p", max_units: "8", done_ids: "D1 D2" },
  "carry-out": { unit_id: "U1", unit_block: "b", problem_excerpt: "e", red_output: "o" },
  verify: { outer_test: "t", mechanical_results: "m", run_instructions: "r" },
  "look-back": { problem: "p", base: "b", diff_stat: "d", gates: "g", verify_report: "v", claims: "c", lessons_consulted: "l" },
};

test("every polya prompt renders with its declared slots and classifies to its kind", () => {
  const kinds: Record<string, string> = { understand: "understand", devise: "devise", "carry-out": "carry-out", verify: "verify", "look-back": "look-back" };
  for (const [name, vars] of Object.entries(SLOTS)) {
    const prompt = buildPrompt(`polya-craft/prompts/${name}`, "", vars);
    assert.doesNotMatch(prompt, /\{\{\s*\w+\s*\}\}/, `${name} left a slot unrendered`);
    assert.equal(classifyPrompt(prompt), kinds[name], name);
  }
});

test("hybrid policy: Solver turns on the frontier, Hand and Verifier local", () => {
  const policy = policyFromEnv("hybrid", {});
  assert.equal(preferredTier("understand", policy), "claude");
  assert.equal(preferredTier("devise", policy), "claude");
  assert.equal(preferredTier("carry-out", policy), "local");
  assert.equal(preferredTier("verify", policy), "local");
  assert.equal(preferredTier("look-back", policy), "claude");
  const local = policyFromEnv("local", {});
  assert.equal(preferredTier("understand", local), "local");
});

test("a gate-feedback note prepended to a carry-out prompt still classifies as carry-out", () => {
  const note = gateFeedbackNote(1, { passed: false, seconds: 1, skipped: [], findings: [{ rule: "quality-bar", ok: false, detail: "x".repeat(1500), command: "npm test", output: "y".repeat(2000) }] });
  const prompt = `${note}${buildPrompt("polya-craft/prompts/carry-out", "", SLOTS["carry-out"]!)}`;
  assert.ok(note.length > 1500);
  assert.equal(classifyPrompt(prompt), "carry-out");
});
