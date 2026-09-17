import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MaxExhausted,
  authenticatedCloneUrl,
  claudeAllowedForSlackUser,
  isClaudeAgentId,
  makeClaudeSend,
  parseClaudeUserIds,
  parseEngine,
  publicGithubUrl,
  scrubbedEnv,
  slackUsesClaude,
} from "./engine-claude.js";

test("parseEngine defaults to cursor", () => {
  const saved = process.env.ENGINE;
  delete process.env.ENGINE;
  try {
    assert.equal(parseEngine(), "cursor");
    assert.equal(parseEngine("claude"), "claude");
    assert.equal(parseEngine("Claude"), "claude");
    assert.equal(parseEngine("nope"), "cursor");
  } finally {
    if (saved === undefined) delete process.env.ENGINE;
    else process.env.ENGINE = saved;
  }
});

test("isClaudeAgentId matches cc- ids only", () => {
  assert.equal(isClaudeAgentId("cc-11111111-2222-3333-4444-555555555555"), true);
  assert.equal(isClaudeAgentId("bc-abc"), false);
  assert.equal(isClaudeAgentId(undefined), false);
});

test("Slack Claude is allowlist-only; empty list means Cursor", () => {
  assert.equal(claudeAllowedForSlackUser("U0ME", []), false);
  assert.equal(claudeAllowedForSlackUser("U0ME", ["U0ME"]), true);
  assert.equal(claudeAllowedForSlackUser("U0OTHER", ["U0ME"]), false);
  assert.equal(claudeAllowedForSlackUser(undefined, ["U0ME"]), false);
  assert.deepEqual(parseClaudeUserIds("U0ME, B0BOT, not-a-user"), ["U0ME"]);
});

test("slackUsesClaude denies continuing a Max thread for everyone else", () => {
  assert.equal(slackUsesClaude({ user: "U0ME", allowlist: ["U0ME"] }), "claude");
  assert.equal(slackUsesClaude({ user: "U0ACEL", allowlist: ["U0ME"] }), "cursor");
  assert.equal(slackUsesClaude({ user: "U0ACEL", allowlist: ["U0ME"], existingId: "cc-1" }), "denied");
  assert.equal(slackUsesClaude({ user: "U0ME", allowlist: ["U0ME"], existingId: "cc-1" }), "claude");
  assert.equal(slackUsesClaude({ user: "U0ME", allowlist: ["U0ME"], existingId: "bc-1" }), "claude");
});

test("clone URL never leaves the token in the public origin", () => {
  const repo = "https://github.com/rvegajr/sji-flight-deck-platform";
  assert.equal(authenticatedCloneUrl(repo, "SECRET"), "https://x-access-token:SECRET@github.com/rvegajr/sji-flight-deck-platform.git");
  assert.equal(publicGithubUrl(authenticatedCloneUrl(repo, "SECRET")), repo);
  assert.equal(publicGithubUrl("git@github.com:rvegajr/sji-flight-deck-platform.git"), repo);
});

test("scrubbedEnv drops API keys and Slack tokens", () => {
  const saved = { ...process.env };
  process.env.ANTHROPIC_API_KEY = "sk-ant-api03-secret";
  process.env.SLACK_BOT_TOKEN = "xoxb-secret";
  process.env.GITHUB_TOKEN = "ghp-secret";
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-ok";
  try {
    const env = scrubbedEnv();
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.SLACK_BOT_TOKEN, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "oauth-ok");
  } finally {
    for (const k of ["ANTHROPIC_API_KEY", "SLACK_BOT_TOKEN", "GITHUB_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test("makeClaudeSend refuses an API key credential and records Max exhaustion", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const send = makeClaudeSend({
      cwd: "/tmp",
      queryFn: async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "sess-1",
          apiKeySource: "ANTHROPIC_API_KEY",
        } as never;
      },
    });
    await assert.rejects(() => send("hi"), /apiKeySource/);

    const cap = makeClaudeSend({
      cwd: "/tmp",
      queryFn: async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "sess-2",
          apiKeySource: "none",
        } as never;
        yield {
          type: "rate_limit_event",
          rate_limit_info: { status: "rejected", errorCode: "credits_required", resetsAt: 99 },
        } as never;
      },
    });
    await assert.rejects(() => cap("hi"), (err: unknown) => {
      assert.ok(err instanceof MaxExhausted);
      assert.equal(err.resetsAt, 99);
      return true;
    });
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("makeClaudeSend returns the result text on success", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const costs: number[] = [];
    const send = makeClaudeSend({
      cwd: "/tmp",
      onCost: (n) => costs.push(n),
      queryFn: async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "sess-ok",
          apiKeySource: "none",
        } as never;
        yield {
          type: "result",
          subtype: "success",
          result: '{"ready":true}',
          total_cost_usd: 1.25,
        } as never;
      },
    });
    const turn = await send("hi");
    assert.equal(turn.status, "finished");
    assert.equal(turn.result, '{"ready":true}');
    assert.equal(turn.runId, "sess-ok");
    assert.deepEqual(costs, [1.25]);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});
