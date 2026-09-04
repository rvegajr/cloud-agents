import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMentionCli, parseProjects } from "./slack-cli.js";
import {
  credentialsFromEnv,
  formatDeployUsage,
  parseDeploys,
  parseRailwaySpec,
  pickDeployTarget,
} from "./slack-deploy.js";

const projects = parseProjects(
  "blessbox=https://github.com/rvegajr/blessbox@develop,fieldview=https://github.com/YOLOVibeCode/fieldview-live@develop",
  "main",
);

const deploys = parseDeploys(
  [
    "blessbox=vercel:https://api.vercel.com/v1/integrations/deploy/prj_oSeinoKd2MO80Bs4zEFfl6Td6E5I/abc123",
    "fieldview/production=railway:684f4bb6-21fb-4269-837a-ea2bf2530715/production/web+api",
    "fieldview/uat=railway:684f4bb6-21fb-4269-837a-ea2bf2530715/uat/web+api",
  ].join(","),
);

test("parseDeploys groups targets by project and names the env", () => {
  assert.deepEqual([...deploys.keys()], ["blessbox", "fieldview"]);
  assert.equal(deploys.get("blessbox")?.[0]?.env, "default");
  assert.equal(deploys.get("blessbox")?.[0]?.provider, "vercel");
  assert.deepEqual(
    deploys.get("fieldview")?.map((t) => t.env),
    ["production", "uat"],
  );
});

test("parseDeploys ignores unknown providers and malformed entries", () => {
  const m = parseDeploys("x=heroku:foo, y=vercel:, z=vercel:https://hook, nope");
  assert.deepEqual([...m.keys()], ["z"]);
});

test("pickDeployTarget: default entry, only entry, named env, ambiguity", () => {
  assert.equal(pickDeployTarget(deploys.get("blessbox"), undefined).target?.provider, "vercel");
  assert.equal(pickDeployTarget(deploys.get("fieldview"), "uat").target?.env, "uat");
  assert.equal(pickDeployTarget(deploys.get("fieldview"), undefined).reason, "ambiguous");
  assert.equal(pickDeployTarget(deploys.get("fieldview"), "staging").reason, "unknown-env");
  assert.equal(pickDeployTarget(undefined, undefined).reason, "no-targets");
  const single = parseDeploys("solo/prod=railway:p/prod/web");
  assert.equal(pickDeployTarget(single.get("solo"), undefined).target?.env, "prod");
});

test("parseRailwaySpec splits project/environment/services", () => {
  assert.deepEqual(parseRailwaySpec("p-id/uat/web+api"), { projectId: "p-id", environment: "uat", services: ["web", "api"] });
  assert.throws(() => parseRailwaySpec("p-id/uat"));
});

test("`<project> deploy` and `deploy <project>` both parse as deploy", () => {
  for (const text of ["<@U1> blessbox deploy", "<@U1> deploy blessbox", "<@U1> blessbox ship"]) {
    const cli = parseMentionCli(text, { projects });
    assert.equal(cli.kind, "deploy", text);
    assert.equal(cli.project?.name, "blessbox", text);
    assert.equal(cli.options.env, undefined, text);
  }
});

test("bare `deploy` in a project channel targets that project", () => {
  const cli = parseMentionCli("<@U1> deploy", { projects, channelProject: projects.get("fieldview") });
  assert.equal(cli.kind, "deploy");
  assert.equal(cli.project?.name, "fieldview");
  const none = parseMentionCli("<@U1> deploy", { projects });
  assert.equal(none.kind, "deploy");
  assert.equal(none.project, undefined);
});

test("env comes from env=<name> or a bare word after deploy", () => {
  assert.equal(parseMentionCli("<@U1> fieldview deploy env=uat", { projects }).options.env, "uat");
  assert.equal(parseMentionCli("<@U1> fieldview deploy uat", { projects }).options.env, "uat");
  assert.equal(parseMentionCli("<@U1> deploy fieldview UAT", { projects }).options.env, "uat");
  assert.equal(
    parseMentionCli("<@U1> deploy env=production", { projects, channelProject: projects.get("fieldview") }).options.env,
    "production",
  );
});

test("`deploy -` prints deploy usage", () => {
  for (const text of ["<@U1> fieldview deploy -", "<@U1> deploy fieldview help", "<@U1> deploy -"]) {
    const cli = parseMentionCli(text, { projects, channelProject: projects.get("fieldview") });
    assert.equal(cli.kind, "deploy-usage", text);
    assert.equal(cli.project?.name, "fieldview", text);
  }
});

test("a request that merely contains the word deploy is still a job", () => {
  const cli = parseMentionCli("<@U1> blessbox the deploy script fails on node 22", { projects });
  assert.equal(cli.kind, "run");
  assert.equal(cli.request, "the deploy script fails on node 22");
});

test("formatDeployUsage lists targets and marks the default", () => {
  const text = formatDeployUsage({ bot: "@Cursor", project: "fieldview", targets: deploys.get("fieldview")!, implied: true });
  assert.match(text, /usage: @Cursor deploy \[env=<name>\]/);
  assert.match(text, /production {2}railway/);
  assert.match(text, /@Cursor deploy env=production/);
  const empty = formatDeployUsage({ bot: "@Cursor", project: "nope", targets: [], implied: false });
  assert.match(empty, /no deploy targets for nope/);
});

test("credentialsFromEnv follows Railway CLI token names", () => {
  assert.deepEqual(credentialsFromEnv({ RAILWAY_TOKEN: "proj" }), {
    vercelToken: undefined,
    vercelTeamId: undefined,
    railwayToken: "proj",
    railwayTokenKind: "project",
  });
  assert.equal(credentialsFromEnv({ RAILWAY_API_TOKEN: "acct", RAILWAY_TOKEN: "proj" }).railwayTokenKind, "account");
  assert.equal(credentialsFromEnv({ VERCEL_TOKEN: " t " }).vercelToken, "t");
});
