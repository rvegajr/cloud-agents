import assert from "node:assert/strict";
import { test } from "node:test";
import { authorize, mentionText, parseJobsBody } from "./jobs-http.js";

test("authorize accepts Bearer or raw token", () => {
  assert.equal(authorize("Bearer secret", "secret"), true);
  assert.equal(authorize("secret", "secret"), true);
  assert.equal(authorize("Bearer nope", "secret"), false);
  assert.equal(authorize(undefined, "secret"), false);
  assert.equal(authorize("Bearer secret", ""), false);
});

test("parseJobsBody maps aliases and rejects non-objects", () => {
  assert.equal(parseJobsBody([]).ok, false);
  const ok = parseJobsBody({
    project: "sji",
    request: " version ",
    threadTs: "1.2",
    asMention: true,
    channel: "#sji-fixbot",
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.body, {
      project: "sji",
      request: "version",
      text: undefined,
      channel: "#sji-fixbot",
      thread_ts: "1.2",
      model: undefined,
      as_mention: true,
    });
  }
});

test("mentionText builds a Slack CLI line", () => {
  assert.equal(
    mentionText({ project: "sji", request: "version", model: "composer-2.5" }, "U0BOT"),
    "<@U0BOT> sji model=composer-2.5 version",
  );
  assert.equal(mentionText({ text: "<@U0BOT> help" }, "U0BOT"), "<@U0BOT> help");
});
