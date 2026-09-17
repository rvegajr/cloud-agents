import assert from "node:assert/strict";
import { test } from "node:test";
import { findAgentId, isDriverBot, parseBotIds } from "./slack-thread.js";

test("parseBotIds keeps B… ids and drops junk", () => {
  assert.deepEqual(parseBotIds("B0AAA, b0bbb extra, U0USER, C0CHAN"), ["B0AAA", "B0BBB"]);
  assert.deepEqual(parseBotIds(""), []);
  assert.deepEqual(parseBotIds(undefined), []);
});

test("findAgentId recovers Cursor bc- and Claude cc- handles", () => {
  assert.equal(findAgentId([{ text: "noise" }, { text: "agent: bc-abc123" }]), "bc-abc123");
  assert.equal(findAgentId([{ text: "agent: cc-11111111-2222-3333-4444-555555555555" }]), "cc-11111111-2222-3333-4444-555555555555");
});

test("isDriverBot rejects missing, own, and unknown bots", () => {
  const allow = ["B0DRIVER"];
  assert.equal(isDriverBot(undefined, "B0OWN", allow), false);
  assert.equal(isDriverBot("B0OWN", "B0OWN", allow), false);
  assert.equal(isDriverBot("B0OTHER", "B0OWN", allow), false);
  assert.equal(isDriverBot("B0DRIVER", "B0OWN", allow), true);
  assert.equal(isDriverBot("b0driver", "b0own", allow), true);
  assert.equal(isDriverBot("B0DRIVER", "B0OWN", []), false);
});
