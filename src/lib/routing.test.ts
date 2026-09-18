import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MaxCeiling,
  classifyPrompt,
  formatMaxUsage,
  mergeMaxUsage,
  policyFromEnv,
  preferredTier,
  routeTurn,
  usageIsCurrent,
  type MaxUsage,
} from "./routing.js";
import { buildPrompt } from "./prompts.js";

const now = Date.parse("2026-09-17T12:00:00Z");
const later = Math.floor(now / 1000) + 3600;

test("classifyPrompt recognises every kit template", () => {
  assert.equal(classifyPrompt(buildPrompt("01-plan", "x")), "plan");
  assert.equal(classifyPrompt(buildPrompt("02-implement", "x")), "implement");
  assert.equal(classifyPrompt(buildPrompt("03-verify", "x", { base_ref: "origin/main" })), "verify");
  assert.equal(classifyPrompt(buildPrompt("app/spec", "", { idea: "i", repo: "r", max_milestones: "3" })), "spec");
  assert.equal(classifyPrompt(buildPrompt("app/iterate", "", { idea: "i", iteration: "1", max_iterations: "2" })), "iterate");
  assert.equal(classifyPrompt(buildPrompt("app/finish", "", { idea: "i" })), "finish");
  assert.equal(classifyPrompt(buildPrompt("app/unblock", "", { milestone_id: "m1", stall_count: "2" })), "unblock");
  assert.equal(classifyPrompt("hello"), "other");
});

test("hybrid policy: Max plans, local types, Claude rescues", () => {
  const p = policyFromEnv("hybrid", {});
  assert.equal(preferredTier("plan", p), "claude");
  assert.equal(preferredTier("spec", p), "claude");
  assert.equal(preferredTier("implement", p), "local");
  assert.equal(preferredTier("iterate", p), "local");
  assert.equal(preferredTier("verify", p), "local");
  assert.equal(preferredTier("finish", p), "local");
  assert.equal(preferredTier("unblock", p), "claude");
  assert.equal(p.ceiling, 0.85);
  assert.equal(p.overCeiling, "local");
});

test("local policy never names Claude", () => {
  const p = policyFromEnv("local", {});
  for (const k of ["plan", "implement", "verify", "unblock", "other"] as const) assert.equal(preferredTier(k, p), "local");
});

test("policy env overrides and ceiling parsing", () => {
  const p = policyFromEnv("hybrid", { HYBRID_VERIFY: "claude", HYBRID_RESCUE: "0", MAX_UTILIZATION_CEILING: "70", HYBRID_OVER_CEILING: "stop" });
  assert.equal(p.verify, "claude");
  assert.equal(p.rescue, false);
  assert.equal(p.ceiling, 0.7);
  assert.equal(p.overCeiling, "stop");
  assert.equal(policyFromEnv("hybrid", { MAX_UTILIZATION_CEILING: "0.5" }).ceiling, 0.5);
  assert.equal(policyFromEnv("hybrid", { MAX_UTILIZATION_CEILING: "junk" }).ceiling, 0.85);
});

test("routeTurn diverts Claude turns at the ceiling and ignores stale samples", () => {
  const p = policyFromEnv("hybrid", {});
  const hot: MaxUsage = { status: "allowed_warning", utilization: 0.9, rateLimitType: "seven_day", resetsAt: later, observedAt: "" };
  assert.equal(routeTurn("plan", p, undefined, now).tier, "claude");
  assert.equal(routeTurn("plan", p, { ...hot, utilization: 0.5 }, now).tier, "claude");
  const d = routeTurn("plan", p, hot, now);
  assert.equal(d.tier, "local");
  assert.match(d.reason, /90%/);
  assert.equal(routeTurn("implement", p, hot, now).tier, "local");
  const stale = { ...hot, resetsAt: Math.floor(now / 1000) - 1 };
  assert.equal(usageIsCurrent(stale, now), false);
  assert.equal(routeTurn("plan", p, stale, now).tier, "claude");
});

test("routeTurn stops instead of diverting when asked", () => {
  const p = policyFromEnv("hybrid", { HYBRID_OVER_CEILING: "stop" });
  const hot: MaxUsage = { status: "allowed", utilization: 0.85, resetsAt: later, observedAt: "" };
  assert.throws(() => routeTurn("plan", p, hot, now), MaxCeiling);
  assert.equal(routeTurn("implement", p, hot, now).tier, "local");
});

test("rejected status counts as over the ceiling regardless of utilization", () => {
  const p = policyFromEnv("hybrid", {});
  assert.equal(routeTurn("plan", p, { status: "rejected", utilization: 0.1, resetsAt: later, observedAt: "" }, now).tier, "local");
});

test("mergeMaxUsage keeps the seven-day sample over a five-hour one", () => {
  const week: MaxUsage = { utilization: 0.8, rateLimitType: "seven_day", resetsAt: later, observedAt: "" };
  const fiveLow: MaxUsage = { utilization: 0.2, rateLimitType: "five_hour", resetsAt: later, observedAt: "" };
  const fiveHigh: MaxUsage = { utilization: 0.95, rateLimitType: "five_hour", resetsAt: later, observedAt: "" };
  assert.equal(mergeMaxUsage(week, fiveLow, now).utilization, 0.8);
  assert.equal(mergeMaxUsage(week, fiveHigh, now).utilization, 0.95);
  assert.equal(mergeMaxUsage(fiveLow, week, now).utilization, 0.8);
  assert.equal(mergeMaxUsage({ ...week, resetsAt: 1 }, fiveLow, now).utilization, 0.2);
});

test("formatMaxUsage", () => {
  assert.equal(formatMaxUsage(undefined), "Max usage: no current sample");
  const future = Math.floor(Date.now() / 1000) + 3600;
  assert.match(
    formatMaxUsage({ utilization: 0.42, rateLimitType: "seven_day", resetsAt: future, observedAt: "" }),
    /42% of seven day, resets \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z/,
  );
});

test("classifyPrompt recognises the architect–crew–gate templates (architect-crew-gate/prompts)", () => {
  assert.equal(classifyPrompt(buildPrompt("architect-crew-gate/prompts/requirements", "", { job: "j", repo: "r", must_haves: "m" })), "requirements");
  assert.equal(classifyPrompt(buildPrompt("architect-crew-gate/prompts/blueprint", "", { job: "j", max_tasks: "8", workflow_ids: "W1" })), "blueprint");
  assert.equal(classifyPrompt(buildPrompt("architect-crew-gate/prompts/task", "", { task_id: "T1", task_block: "b", design_excerpt: "d", red_output: "r" })), "task");
  assert.equal(classifyPrompt(buildPrompt("architect-crew-gate/prompts/qa", "", { qa_md: "q", requirements_md: "r", run_instructions: "i", browser_tools: "b" })), "qa");
  assert.equal(classifyPrompt(buildPrompt("architect-crew-gate/prompts/qa-fix", "", { defects: "d", allowed_files: "f" })), "task");
  assert.equal(classifyPrompt(buildPrompt("architect-crew-gate/prompts/review", "", { job: "j", base: "b", diff_stat: "s", gates: "g", qa_report: "q", claims: "c" })), "review");
  assert.equal(classifyPrompt(buildPrompt("architect-crew-gate/prompts/review-fix", "", { findings: "f", allowed_files: "a" })), "task");
});

test("hybrid policy routes the pattern's stages: architect and review on Claude, crew and QA local", () => {
  const p = policyFromEnv("hybrid", {});
  assert.equal(preferredTier("requirements", p), "claude");
  assert.equal(preferredTier("blueprint", p), "claude");
  assert.equal(preferredTier("task", p), "local");
  assert.equal(preferredTier("qa", p), "local");
  assert.equal(preferredTier("review", p), "claude");
  assert.equal(preferredTier("review", policyFromEnv("hybrid", { HYBRID_REVIEW: "local" })), "local");
  assert.equal(preferredTier("qa", policyFromEnv("hybrid", { HYBRID_QA: "claude" })), "claude");
  for (const k of ["requirements", "blueprint", "task", "qa", "review"] as const) assert.equal(preferredTier(k, policyFromEnv("local", {})), "local");
});

test("every blueprint template ends with a fenced json contract", () => {
  const rendered = [
    buildPrompt("architect-crew-gate/prompts/requirements", "", { job: "j", repo: "r", must_haves: "m" }),
    buildPrompt("architect-crew-gate/prompts/blueprint", "", { job: "j", max_tasks: "8", workflow_ids: "W1" }),
    buildPrompt("architect-crew-gate/prompts/task", "", { task_id: "T1", task_block: "b", design_excerpt: "d", red_output: "r" }),
    buildPrompt("architect-crew-gate/prompts/qa", "", { qa_md: "q", requirements_md: "r", run_instructions: "i", browser_tools: "b" }),
    buildPrompt("architect-crew-gate/prompts/qa-fix", "", { defects: "d", allowed_files: "f" }),
    buildPrompt("architect-crew-gate/prompts/review", "", { job: "j", base: "b", diff_stat: "s", gates: "g", qa_report: "q", claims: "c" }),
    buildPrompt("architect-crew-gate/prompts/review-fix", "", { findings: "f", allowed_files: "a" }),
  ];
  for (const r of rendered) {
    assert.match(r, /```json\n\{[\s\S]*\}\n```\s*$/, r.slice(0, 60));
    assert.doesNotMatch(r, /\{\{[a-z_]+\}\}/, "unrendered variable");
  }
});

test("classifyPrompt sees the template header behind a long prepended note (gate feedback, blueprint gaps)", () => {
  const note = "## Quality gate failed (attempt 1)\n\n" + "- [quality-bar] npm test exited 1\n  last output:\n  " + "x".repeat(1500) + "\n\n---\n\n";
  assert.equal(classifyPrompt(note + buildPrompt("architect-crew-gate/prompts/task", "", { task_id: "T1", task_block: "b", design_excerpt: "d", red_output: "r" })), "task");
  assert.equal(classifyPrompt(note + buildPrompt("architect-crew-gate/prompts/blueprint", "", { job: "j", max_tasks: "8", workflow_ids: "W1" })), "blueprint");
});
