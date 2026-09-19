import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeReasoningFromEnv } from "./engine-claude.js";

test("claudeReasoningFromEnv: effort and thinking budget from env, nothing when unset or invalid", () => {
  assert.deepEqual(claudeReasoningFromEnv({}), {});
  assert.deepEqual(claudeReasoningFromEnv({ CLAUDE_EFFORT: "max" }), { effort: "max" });
  assert.deepEqual(claudeReasoningFromEnv({ CLAUDE_EFFORT: "XHigh" }), { effort: "xhigh" });
  assert.deepEqual(claudeReasoningFromEnv({ CLAUDE_EFFORT: "ultra" }), {});
  assert.deepEqual(claudeReasoningFromEnv({ CLAUDE_THINKING_TOKENS: "31999" }), { thinking: { type: "enabled", budgetTokens: 31999 } });
  assert.deepEqual(claudeReasoningFromEnv({ CLAUDE_THINKING_TOKENS: "0" }), {});
  assert.deepEqual(claudeReasoningFromEnv({ CLAUDE_EFFORT: "max", CLAUDE_THINKING_TOKENS: "16000" }), { effort: "max", thinking: { type: "enabled", budgetTokens: 16000 } });
});
