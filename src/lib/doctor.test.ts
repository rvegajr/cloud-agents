import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseProjects } from "./slack-cli.js";
import { parseChannelRepos } from "./slack-thread.js";
import {
  classifyGitHubToken,
  collectRepoRefs,
  diffScopes,
  formatReport,
  hasRepoScope,
  isSlackChannelId,
  isSlackUserId,
  manifestBotScopes,
  normalizeRepoUrl,
  parsePhaseFilter,
  PHASES,
  slackTokenKind,
  summarize,
  type Check,
} from "./doctor.js";

test("parsePhaseFilter accepts a letter, a list, and a range", () => {
  assert.deepEqual([...parsePhaseFilter("A")], ["A"]);
  assert.deepEqual([...parsePhaseFilter("a,c")], ["A", "C"]);
  assert.deepEqual([...parsePhaseFilter("B-D")], ["B", "C", "D"]);
  assert.deepEqual([...parsePhaseFilter("D-B")], ["B", "C", "D"]);
  assert.equal(parsePhaseFilter(undefined).size, PHASES.length);
  // `--phase` with no value becomes "true"; treat it as "every phase".
  assert.equal(parsePhaseFilter("true").size, PHASES.length);
  assert.equal(parsePhaseFilter("Z").size, PHASES.length);
  // The deploy phase is gone; H is no longer a phase at all.
  assert.equal(parsePhaseFilter("H").size, PHASES.length);
});

test("normalizeRepoUrl makes ssh, https, .git, and case the same repo", () => {
  const want = "github.com/you/api";
  for (const url of [
    "https://github.com/you/api",
    "https://github.com/You/API/",
    "https://github.com/you/api.git",
    "git@github.com:you/api.git",
    "ssh://git@github.com/you/api",
  ]) {
    assert.equal(normalizeRepoUrl(url), want, url);
  }
  assert.notEqual(normalizeRepoUrl("https://github.com/you/api"), normalizeRepoUrl("https://github.com/you/web"));
});

test("collectRepoRefs merges every source and names where each came from", () => {
  const refs = collectRepoRefs({
    targetRepo: "https://github.com/you/api",
    targetRef: "develop",
    projects: parseProjects("api=https://github.com/you/api@develop,web=https://github.com/you/web", "develop"),
    routes: parseChannelRepos("C123=https://github.com/you/infra@main", "develop"),
  });
  assert.deepEqual(
    refs.map((r) => `${r.source} ${r.ref}`),
    ["TARGET_REPO develop", "SLACK_PROJECTS web develop", "SLACK_CHANNEL_REPOS C123 main"],
  );
});

test("collectRepoRefs keeps the same repo twice when the branch differs", () => {
  const refs = collectRepoRefs({
    targetRepo: "https://github.com/you/api",
    targetRef: "main",
    projects: parseProjects("api=https://github.com/you/api@develop", "main"),
    routes: new Map(),
  });
  assert.deepEqual(refs.map((r) => r.ref), ["main", "develop"]);
});

test("manifestBotScopes reads the scopes the shipped manifest asks for", () => {
  const manifest = JSON.parse(readFileSync("slack-app-manifest.json", "utf8")) as unknown;
  const scopes = manifestBotScopes(manifest);
  assert.ok(scopes.includes("app_mentions:read"));
  assert.ok(scopes.includes("chat:write"));
  assert.deepEqual(manifestBotScopes({}), []);
  assert.deepEqual(manifestBotScopes({ oauth_config: { scopes: { bot: ["a", 1] } } }), ["a"]);
});

test("diffScopes reports what the install is missing and what it added", () => {
  const d = diffScopes("chat:write,channels:history, users:read", ["chat:write", "app_mentions:read"]);
  assert.deepEqual(d.missing, ["app_mentions:read"]);
  assert.deepEqual(d.extra, ["channels:history", "users:read"]);
  assert.deepEqual(diffScopes(undefined, ["chat:write"]).missing, ["chat:write"]);
  assert.deepEqual(diffScopes("chat:write", ["chat:write"]).missing, []);
});

test("slackTokenKind separates the bot token from the app token", () => {
  assert.equal(slackTokenKind("xoxb-1-2-abc"), "bot");
  assert.equal(slackTokenKind("xapp-1-A-2-abc"), "app");
  assert.equal(slackTokenKind("xoxp-1-2-abc"), "user");
  assert.equal(slackTokenKind(undefined), "unknown");
});

test("classifyGitHubToken catches the fine-grained PAT that cannot mark a PR ready", () => {
  assert.equal(classifyGitHubToken("ghp_abc123"), "classic");
  assert.equal(classifyGitHubToken("github_pat_abc123"), "fine-grained");
  assert.equal(classifyGitHubToken("ghs_abc123"), "app-installation");
  assert.equal(classifyGitHubToken("a".repeat(40)), "classic");
  assert.equal(classifyGitHubToken("nonsense"), "unknown");
});

test("hasRepoScope needs the whole repo scope, not a subscope", () => {
  assert.ok(hasRepoScope("repo, gist"));
  assert.ok(!hasRepoScope("public_repo, repo:status"));
  assert.ok(!hasRepoScope(undefined));
});

test("slack id shapes: members vs channels", () => {
  assert.ok(isSlackUserId("U0123ABCD"));
  assert.ok(isSlackUserId("<@U0123ABCD>"));
  assert.ok(isSlackUserId("W0123ABCD"));
  assert.ok(!isSlackUserId("C0123ABCD"));
  assert.ok(isSlackChannelId("C0123ABCD"));
  assert.ok(isSlackChannelId("G0123ABCD"));
  assert.ok(!isSlackChannelId("#api-fixbot"));
});

const checks: Check[] = [
  { phase: "A", group: "cursor", name: "api key", verdict: "pass", detail: "you@example.com" },
  { phase: "C", group: "slack", name: "bot scopes", verdict: "warn", detail: "missing users:read", fix: "reinstall the app" },
  { phase: "F", group: "notifications", name: "railway webhook", verdict: "skip", detail: "not observable from here" },
  { phase: "G", group: "github", name: "PAT kind", verdict: "fail", detail: "fine-grained", fix: "mint a classic PAT" },
];

test("summarize counts verdicts and fails the exit code only on FAIL", () => {
  assert.deepEqual(summarize(checks), { pass: 1, warn: 1, fail: 1, skip: 1, exitCode: 1 });
  assert.equal(summarize(checks.filter((c) => c.verdict !== "fail")).exitCode, 0);
  assert.deepEqual(summarize([]), { pass: 0, warn: 0, fail: 0, skip: 0, exitCode: 0 });
});

test("formatReport groups checks and prints fixes for problems only", () => {
  const text = formatReport(checks);
  assert.match(text, /\[cursor\]/);
  assert.match(text, /FAIL {2}PAT kind: fine-grained/);
  assert.match(text, /→ mint a classic PAT/);
  assert.match(text, /1 pass, 1 warn, 1 fail, 1 skip/);
  // A skipped check keeps its detail but never nags with a fix line.
  assert.ok(!formatReport([checks[2]!]).includes("→"));
  assert.ok(!formatReport([checks[0]!]).includes("→"));
});
