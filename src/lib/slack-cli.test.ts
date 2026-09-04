import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aliasFromChannelName,
  channelProject,
  formatGlobalUsage,
  impliedProject,
  isCursorNativeCommand,
  matchChannelProject,
  parseMentionCli,
  parseOptions,
  parseProjects,
  resolveRunTarget,
} from "./slack-cli.js";

const projects = parseProjects(
  [
    "web=https://github.com/you/web@develop",
    "webapp=https://github.com/you/web@develop",
    "api=https://github.com/you/api@develop",
    "mobile=https://github.com/you-org/mobile@develop",
  ].join(","),
  "main",
);

test("parseProjects keeps alias, repo, and @ref", () => {
  const p = projects.get("api");
  assert.deepEqual(p, {
    name: "api",
    repo: "https://github.com/you/api",
    ref: "develop",
  });
});

test("channel prefix: longest alias at the front", () => {
  assert.equal(matchChannelProject("api-bugs", projects)?.name, "api");
  assert.equal(matchChannelProject("webapp-agent-test", projects)?.name, "webapp");
  assert.equal(matchChannelProject("mobile-fixbot", projects)?.name, "mobile");
  assert.equal(matchChannelProject("random", projects), undefined);
});

test("aliasFromChannelName takes the leading segment, any suffix", () => {
  assert.equal(aliasFromChannelName("api-bugs"), "api");
  assert.equal(aliasFromChannelName("webapp-agent-test"), "webapp");
  assert.equal(aliasFromChannelName("mobile_fixbot"), "mobile");
  assert.equal(aliasFromChannelName("api"), "api");
  assert.equal(aliasFromChannelName(undefined), undefined);
});

test("impliedProject uses #name route keys when conversations.info is unavailable", () => {
  const routes = new Map([
    ["C0123ABCD", { repo: "https://github.com/you/api", ref: "develop" }],
    ["#api-bugs", { repo: "https://github.com/you/api", ref: "develop" }],
  ]);
  const implied = impliedProject({
    channelId: "C0123ABCD",
    channelName: undefined,
    routes,
    projects,
  });
  assert.equal(implied?.name, "api");
});

test("channelProject names an uncatalogued project from a routed channel", () => {
  const empty = parseProjects("", "develop");
  const routed = { repo: "https://github.com/you/newapp", ref: "develop" };
  assert.deepEqual(channelProject("newapp-bugs", empty, routed), { name: "newapp", ...routed });
  assert.deepEqual(channelProject("newapp", empty, routed), { name: "newapp", ...routed });
  assert.equal(channelProject("newapp-bugs", empty, undefined), undefined, "unrouted channel implies nothing");
});

test("bare mention and help tokens print usage", () => {
  for (const text of ["<@U1>", "<@U1> help", "<@U1> -", "<@U1> --help", "<@U1> usage"]) {
    const cli = parseMentionCli(text, { projects, channelProject: projects.get("api") });
    assert.equal(cli.kind, "usage", text);
    assert.equal(cli.project?.name, "api", text);
  }
});

test("@bot <project> and @bot <project> - print project options", () => {
  for (const text of ["<@U1> mobile", "<@U1> mobile -", "<@U1> mobile help"]) {
    const cli = parseMentionCli(text, { projects, channelProject: projects.get("api") });
    assert.equal(cli.kind, "project-usage", text);
    assert.equal(cli.project?.name, "mobile", text);
  }
});

test("@bot <project> <request> runs that project, not the channel", () => {
  const cli = parseMentionCli("<@U1> mobile the map pins are missing", {
    projects,
    channelProject: projects.get("api"),
  });
  assert.equal(cli.kind, "run");
  assert.equal(cli.project?.name, "mobile");
  assert.equal(cli.request, "the map pins are missing");
});

test("request in a prefixed channel omits the project name", () => {
  const cli = parseMentionCli("<@U1> https://jam.dev/c/abc", {
    projects,
    channelProject: projects.get("api"),
  });
  assert.equal(cli.kind, "run");
  assert.equal(cli.project?.name, "api");
  assert.equal(cli.request, "https://jam.dev/c/abc");
});

test("inline options are stripped and applied", () => {
  const { text, options } = parseOptions("branch=main autopr=false model=opus fix the login");
  assert.equal(text, "fix the login");
  assert.deepEqual(options, { branch: "main", autopr: false, model: "opus" });
  const cli = parseMentionCli("<@U1> api branch=release autopr=true the webhook retries", { projects });
  assert.equal(cli.kind, "run");
  assert.equal(cli.request, "the webhook retries");
  assert.equal(cli.options.branch, "release");
  assert.equal(cli.options.autopr, true);
  const target = resolveRunTarget(cli, undefined, { repo: "https://github.com/other/x", ref: "main" });
  assert.equal(target?.repo, "https://github.com/you/api");
  assert.equal(target?.ref, "release");
});

test("unknown project plus dash shows usage, not a job", () => {
  const cli = parseMentionCli("<@U1> nope -", { projects });
  assert.equal(cli.kind, "usage");
  assert.equal(cli.unknownProject, "nope");
});

test("one-word requests are still jobs", () => {
  const cli = parseMentionCli("<@U1> login", { projects, channelProject: projects.get("web") });
  assert.equal(cli.kind, "run");
  assert.equal(cli.request, "login");
});

test("Cursor native commands are detected so we stay silent", () => {
  assert.equal(isCursorNativeCommand("<@U0> help"), true);
  assert.equal(isCursorNativeCommand("<@U0> settings"), true);
  assert.equal(isCursorNativeCommand("<@U0> list my agents"), true);
  assert.equal(isCursorNativeCommand("<@U0>"), false);
  assert.equal(isCursorNativeCommand("<@U0> api -"), false);
});

test("usage text names the channel project and prints whatever handle it is given", () => {
  const text = formatGlobalUsage({
    bot: "@Shipper",
    channelName: "api-bugs",
    channelProject: projects.get("api"),
    projects: [...projects.values()],
  });
  assert.match(text, /this channel: #api-bugs {2}→ {2}api/);
  assert.match(text, /@Shipper \[<project>\]/);
  assert.match(text, /← this channel/);
  assert.doesNotMatch(text, /@Cursor/);
});
