import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cursorAppGrantBlocksCreate,
  cursorAppSlugs,
  formatCursorAppGrant,
  grantCursorGithubApp,
  installationIsCursor,
  markPullRequestReady,
  parseGithubRepoUrl,
  parsePullRequestUrl,
  resolveGithubToken,
} from "./github.js";

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

test("parseGithubRepoUrl: owner/repo, not PRs", () => {
  assert.deepEqual(parseGithubRepoUrl("https://github.com/acme/web"), { owner: "acme", repo: "web" });
  assert.deepEqual(parseGithubRepoUrl("https://github.com/acme/web.git"), { owner: "acme", repo: "web" });
  assert.equal(parseGithubRepoUrl("https://github.com/acme/web/pull/14"), undefined);
  assert.equal(parseGithubRepoUrl("https://gitlab.com/acme/web"), undefined);
});

test("cursor app slug matching", () => {
  assert.deepEqual(cursorAppSlugs({}), ["cursor"]);
  assert.deepEqual(cursorAppSlugs({ CURSOR_GITHUB_APP_SLUG: "cursor-ai, anysphere" }), ["cursor-ai", "anysphere"]);
  assert.equal(installationIsCursor("cursor", ["cursor"]), true);
  assert.equal(installationIsCursor("cursor-ai", ["cursor"]), true);
  assert.equal(installationIsCursor("anysphere", ["cursor"]), false);
});

test("resolveGithubToken: env wins, then gh auth token", () => {
  assert.equal(resolveGithubToken({ GITHUB_TOKEN: "ghp_a" }), "ghp_a");
  assert.equal(resolveGithubToken({ GH_TOKEN: "ghp_b" }), "ghp_b");
  assert.equal(
    resolveGithubToken({}, (file, args) => {
      assert.equal(file, "gh");
      assert.deepEqual(args, ["auth", "token"]);
      return "ghp_cli\n";
    }),
    "ghp_cli",
  );
  assert.equal(resolveGithubToken({}), undefined);
});

test("grantCursorGithubApp: All repositories means inherited", async () => {
  const fetchImpl: typeof fetch = async (url) => {
    assert.match(String(url), /user\/installations/);
    return new Response(
      JSON.stringify({ installations: [{ id: 9, app_slug: "cursor", repository_selection: "all" }] }),
    );
  };
  const g = await grantCursorGithubApp("https://github.com/acme/web", { token: "ghp_x", fetchImpl });
  assert.deepEqual(g, { status: "inherited", installationId: 9 });
  assert.match(formatCursorAppGrant(g), /All repositories/);
});

test("grantCursorGithubApp: selected install adds the repo", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    urls.push(`${init?.method ?? "GET"} ${url}`);
    const u = String(url);
    if (u.includes("/user/installations?") || u.endsWith("/user/installations")) {
      return new Response(
        JSON.stringify({ installations: [{ id: 9, app_slug: "cursor", repository_selection: "selected" }] }),
      );
    }
    if (u.includes("/repos/acme/web")) return new Response(JSON.stringify({ id: 42 }));
    if (u.includes("/user/installations/9/repositories/42")) return new Response(null, { status: 204 });
    return new Response("nope", { status: 404 });
  };
  const g = await grantCursorGithubApp("https://github.com/acme/web", { token: "ghp_x", fetchImpl });
  assert.deepEqual(g, { status: "added", installationId: 9 });
  assert.equal(urls.at(-1), "PUT https://api.github.com/user/installations/9/repositories/42");
});

test("grantCursorGithubApp: no Cursor install", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ installations: [] }));
  assert.equal((await grantCursorGithubApp("https://github.com/acme/web", { token: "ghp_x", fetchImpl })).status, "missing-app");
});

test("grantCursorGithubApp: no token", async () => {
  assert.equal((await grantCursorGithubApp("https://github.com/acme/web")).status, "no-token");
});

test("grantCursorGithubApp: classic gh token cannot list installations", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ message: "You must authenticate with an access token authorized to a GitHub App" }), {
      status: 403,
    });
  const g = await grantCursorGithubApp("https://github.com/acme/web", { token: "gho_x", fetchImpl });
  assert.equal(g.status, "unknown");
  assert.equal(cursorAppGrantBlocksCreate(g), false);
  assert.equal(cursorAppGrantBlocksCreate({ status: "missing-app" }), true);
  assert.equal(cursorAppGrantBlocksCreate({ status: "inherited", installationId: 1 }), false);
});
