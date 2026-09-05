import assert from "node:assert/strict";
import { test } from "node:test";
import { markPullRequestReady, parsePullRequestUrl } from "./github.js";

test("parsePullRequestUrl: github.com PR URLs", () => {
  assert.deepEqual(parsePullRequestUrl("https://github.com/acme/web/pull/14"), {
    owner: "acme",
    repo: "web",
    number: 14,
  });
  assert.deepEqual(parsePullRequestUrl("https://github.com/acme/web/pull/14/files"), {
    owner: "acme",
    repo: "web",
    number: 14,
  });
  assert.equal(parsePullRequestUrl("https://github.com/acme/web"), undefined);
  assert.equal(parsePullRequestUrl("https://gitlab.com/acme/web/-/merge_requests/3"), undefined);
});

test("markPullRequestReady: looks up the node id, then runs the mutation", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    calls.push(body);
    if (body.query.includes("pullRequest(number")) {
      return new Response(JSON.stringify({ data: { repository: { pullRequest: { id: "PR_1", isDraft: true } } } }));
    }
    return new Response(JSON.stringify({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } }));
  };

  const result = await markPullRequestReady("https://github.com/acme/web/pull/14", "ghp_x", fetchImpl);
  assert.equal(result, "marked");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.variables, { owner: "acme", repo: "web", number: 14 });
  assert.deepEqual(calls[1]?.variables, { id: "PR_1" });
});

test("markPullRequestReady: already-ready PR is a no-op", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ data: { repository: { pullRequest: { id: "PR_1", isDraft: false } } } }));
  assert.equal(await markPullRequestReady("https://github.com/acme/web/pull/14", "ghp_x", fetchImpl), "already-ready");
});

test("markPullRequestReady: GraphQL errors surface as thrown errors", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ errors: [{ message: "Resource not accessible" }] }));
  await assert.rejects(
    () => markPullRequestReady("https://github.com/acme/web/pull/14", "ghp_x", fetchImpl),
    /Resource not accessible/,
  );
});
