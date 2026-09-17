import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MaxExhausted,
  authenticatedCloneUrl,
  claudeAllowedForSlackUser,
  claudeApiKeySourceFromAuth,
  isClaudeAgentId,
  makeClaudeSend,
  parseClaudeUserIds,
  parseEngine,
  planUsageSamples,
  profileLineExportsAnthropicKey,
  rateLimitSamples,
  samplePlanUsage,
  publicGithubUrl,
  redactGitSecrets,
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
  assert.equal(slackUsesClaude({ user: "U0ME", allowlist: ["U0ME"], existingId: "bc-1" }), "cursor");
});

test("claudeApiKeySourceFromAuth treats null and none as Max", () => {
  assert.equal(claudeApiKeySourceFromAuth('{"apiKeySource":null}'), "none");
  assert.equal(claudeApiKeySourceFromAuth('{"apiKeySource":"none"}'), "none");
  assert.equal(claudeApiKeySourceFromAuth('{"apiKeySource":"ANTHROPIC_API_KEY"}'), "ANTHROPIC_API_KEY");
  assert.equal(claudeApiKeySourceFromAuth("not json"), "unparseable");
});

test("profileLineExportsAnthropicKey ignores comments", () => {
  assert.equal(profileLineExportsAnthropicKey("export ANTHROPIC_API_KEY=dummy-anthropic-key"), true);
  assert.equal(profileLineExportsAnthropicKey("# export ANTHROPIC_API_KEY=dummy-anthropic-key"), false);
  assert.equal(profileLineExportsAnthropicKey("export GEMINI_API_KEY=x"), false);
});

test("redactGitSecrets strips token-shaped GitHub credentials", () => {
  assert.equal(
    redactGitSecrets("fatal: https://x-access-token:gho_notarealtoken@github.com/org/repo.git"),
    "fatal: https://x-access-token:<redacted>@github.com/org/repo.git",
  );
});

test("clone URL never leaves the token in the public origin", () => {
  const repo = "https://github.com/rvegajr/sji-flight-deck-platform";
  assert.equal(authenticatedCloneUrl(repo, "SECRET"), "https://x-access-token:SECRET@github.com/rvegajr/sji-flight-deck-platform.git");
  assert.equal(publicGithubUrl(authenticatedCloneUrl(repo, "SECRET")), repo);
  assert.equal(publicGithubUrl("git@github.com:rvegajr/sji-flight-deck-platform.git"), repo);
});

test("scrubbedEnv drops API keys and Slack tokens but keeps the Max login", () => {
  const saved = { ...process.env };
  process.env.ANTHROPIC_API_KEY = "dummy-anthropic-key";
  process.env.SLACK_BOT_TOKEN = "dummy-slack-bot-token";
  process.env.GITHUB_TOKEN = "dummy-github-token";
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

test("planUsageSamples converts /usage windows to routing samples", () => {
  const s = planUsageSamples(
    {
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 12.5, resets_at: "2026-09-17T15:00:00Z" },
        seven_day: { utilization: 88, resets_at: "2026-09-20T00:00:00Z" },
      },
    },
    "now",
  );
  assert.equal(s.length, 2);
  assert.deepEqual(s[1], { status: "allowed", utilization: 0.88, rateLimitType: "seven_day", resetsAt: Date.parse("2026-09-20T00:00:00Z") / 1000, observedAt: "now" });
  assert.equal(s[0]!.utilization, 0.125);
  assert.deepEqual(planUsageSamples({ rate_limits_available: false, rate_limits: null }), []);
  assert.deepEqual(planUsageSamples({ rate_limits_available: true, rate_limits: { seven_day: { utilization: null, resets_at: null } } }), []);
});

test("samplePlanUsage is a no-op without the experimental method and swallows its errors", async () => {
  const got: unknown[] = [];
  assert.equal(await samplePlanUsage({}, (u) => got.push(u)), false);
  assert.equal(await samplePlanUsage(null, (u) => got.push(u)), false);
  const boom = { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => { throw new Error("nope"); } };
  assert.equal(await samplePlanUsage(boom, (u) => got.push(u)), false);
  const ok = {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
      rate_limits_available: true,
      rate_limits: { seven_day: { utilization: 40, resets_at: "2026-09-20T00:00:00Z" } },
    }),
  };
  assert.equal(await samplePlanUsage(ok, (u) => got.push(u)), true);
  assert.equal(got.length, 1);
});

test("rateLimitSamples reads every unified window and marks rejection as full", () => {
  const info = {
    status: "allowed",
    resetsAt: 1789662000,
    rateLimitType: "five_hour",
    unifiedWindows: { five_hour: { utilization: 0.04, resetsAt: 1789662000 }, seven_day: { utilization: 0.05, resetsAt: 1790082000 } },
  } as unknown as Parameters<typeof rateLimitSamples>[0];
  const s = rateLimitSamples(info, "t");
  assert.deepEqual(s.map((x) => [x.rateLimitType, x.utilization, x.resetsAt]), [["five_hour", 0.04, 1789662000], ["seven_day", 0.05, 1790082000]]);
  const legacy = rateLimitSamples({ status: "allowed_warning", utilization: 0.9, rateLimitType: "seven_day", resetsAt: 5 }, "t");
  assert.deepEqual(legacy, [{ status: "allowed_warning", utilization: 0.9, rateLimitType: "seven_day", resetsAt: 5, observedAt: "t" }]);
  const rejected = rateLimitSamples({ status: "rejected", rateLimitType: "seven_day", resetsAt: 9 }, "t");
  assert.equal(rejected.at(-1)!.utilization, 1);
  assert.equal(rateLimitSamples({ status: "allowed", unifiedWindows: { seven_day: { utilization: 42 } } } as never, "t")[0]!.utilization, 0.42);
});
