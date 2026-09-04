import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aliasFromFixbotChannel,
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
    "filedrop=https://github.com/rvegajr/rubriq-flow@develop",
    "rubriqflow=https://github.com/rvegajr/rubriq-flow@develop",
    "blessbox=https://github.com/rvegajr/blessbox@develop",
    "fieldview=https://github.com/YOLOVibeCode/fieldview-live@develop",
  ].join(","),
  "main",
);

test("parseProjects keeps alias, repo, and @ref", () => {
  const p = projects.get("blessbox");
  assert.deepEqual(p, {
    name: "blessbox",
    repo: "https://github.com/rvegajr/blessbox",
    ref: "develop",
  });
});

test("channel prefix: longest alias at the front", () => {
  assert.equal(matchChannelProject("blessbox-fixbot", projects)?.name, "blessbox");
  assert.equal(matchChannelProject("rubriqflow-fixbot-test", projects)?.name, "rubriqflow");
  assert.equal(matchChannelProject("fieldview-fixbot", projects)?.name, "fieldview");
  assert.equal(matchChannelProject("all-ai-slop", projects), undefined);
});

test("aliasFromFixbotChannel only fires on *-fixbot*", () => {
  assert.equal(aliasFromFixbotChannel("blessbox-fixbot"), "blessbox");
  assert.equal(aliasFromFixbotChannel("rubriqflow-fixbot-test"), "rubriqflow");
  assert.equal(aliasFromFixbotChannel("rubriqflow"), undefined);
  assert.equal(aliasFromFixbotChannel("all-ai-slop"), undefined);
});

test("impliedProject uses #name route keys when conversations.info is unavailable", () => {
  const routes = new Map([
    ["C0C0FV555DE", { repo: "https://github.com/rvegajr/blessbox", ref: "develop" }],
    ["#blessbox-fixbot", { repo: "https://github.com/rvegajr/blessbox", ref: "develop" }],
  ]);
  const implied = impliedProject({
    channelId: "C0C0FV555DE",
    channelName: undefined,
    routes,
    projects,
  });
  assert.equal(implied?.name, "blessbox");
});

test("channelProject uses routed repo when alias is only in the channel name", () => {
  const empty = parseProjects("", "develop");
  const implied = channelProject("newapp-fixbot", empty, {
    repo: "https://github.com/you/newapp",
    ref: "develop",
  });
  assert.deepEqual(implied, { name: "newapp", repo: "https://github.com/you/newapp", ref: "develop" });
});

test("bare mention and help tokens print usage", () => {
  for (const text of ["<@U1>", "<@U1> help", "<@U1> -", "<@U1> --help", "<@U1> usage"]) {
    const cli = parseMentionCli(text, { projects, channelProject: projects.get("blessbox") });
    assert.equal(cli.kind, "usage", text);
    assert.equal(cli.project?.name, "blessbox", text);
  }
});

test("@bot <project> and @bot <project> - print project options", () => {
  for (const text of ["<@U1> fieldview", "<@U1> fieldview -", "<@U1> fieldview help"]) {
    const cli = parseMentionCli(text, { projects, channelProject: projects.get("blessbox") });
    assert.equal(cli.kind, "project-usage", text);
    assert.equal(cli.project?.name, "fieldview", text);
  }
});

test("@bot <project> <request> runs that project, not the channel", () => {
  const cli = parseMentionCli("<@U1> fieldview the map pins are missing", {
    projects,
    channelProject: projects.get("blessbox"),
  });
  assert.equal(cli.kind, "run");
  assert.equal(cli.project?.name, "fieldview");
  assert.equal(cli.request, "the map pins are missing");
});

test("request in a prefixed channel omits the project name", () => {
  const cli = parseMentionCli("<@U1> https://jam.dev/c/abc", {
    projects,
    channelProject: projects.get("blessbox"),
  });
  assert.equal(cli.kind, "run");
  assert.equal(cli.project?.name, "blessbox");
  assert.equal(cli.request, "https://jam.dev/c/abc");
});

test("inline options are stripped and applied", () => {
  const { text, options } = parseOptions("branch=main autopr=false model=opus fix the login");
  assert.equal(text, "fix the login");
  assert.deepEqual(options, { branch: "main", autopr: false, model: "opus" });
  const cli = parseMentionCli("<@U1> blessbox branch=release autopr=true the webhook retries", { projects });
  assert.equal(cli.kind, "run");
  assert.equal(cli.request, "the webhook retries");
  assert.equal(cli.options.branch, "release");
  assert.equal(cli.options.autopr, true);
  const target = resolveRunTarget(cli, undefined, { repo: "https://github.com/other/x", ref: "main" });
  assert.equal(target?.repo, "https://github.com/rvegajr/blessbox");
  assert.equal(target?.ref, "release");
});

test("unknown project plus dash shows usage, not a job", () => {
  const cli = parseMentionCli("<@U1> nope -", { projects });
  assert.equal(cli.kind, "usage");
  assert.equal(cli.unknownProject, "nope");
});

test("one-word requests are still jobs", () => {
  const cli = parseMentionCli("<@U1> login", { projects, channelProject: projects.get("filedrop") });
  assert.equal(cli.kind, "run");
  assert.equal(cli.request, "login");
});

test("Cursor native commands are detected so we stay silent", () => {
  assert.equal(isCursorNativeCommand("<@U0> help"), true);
  assert.equal(isCursorNativeCommand("<@U0> settings"), true);
  assert.equal(isCursorNativeCommand("<@U0> list my agents"), true);
  assert.equal(isCursorNativeCommand("<@U0>"), false);
  assert.equal(isCursorNativeCommand("<@U0> blessbox -"), false);
});

test("usage text names the channel project", () => {
  const text = formatGlobalUsage({
    bot: "@Cursor",
    channelName: "blessbox-fixbot",
    channelProject: projects.get("blessbox"),
    projects: [...projects.values()],
  });
  assert.match(text, /this channel: #blessbox-fixbot {2}→ {2}blessbox/);
  assert.match(text, /@Cursor \[<project>\]/);
  assert.match(text, /← this channel/);
});
