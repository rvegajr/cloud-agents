import assert from "node:assert/strict";
import { test } from "node:test";
import { isDriverBot, parseBotIds } from "./slack-thread.js";

test("parseBotIds keeps B… ids and drops junk", () => {
  assert.deepEqual(parseBotIds("B0AAA, b0bbb extra, U0USER, C0CHAN"), ["B0AAA", "B0BBB"]);
  assert.deepEqual(parseBotIds(""), []);
  assert.deepEqual(parseBotIds(undefined), []);
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
