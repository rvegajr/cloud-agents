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
  "web=https://github.com/you/web@develop,api=https://github.com/you/api@develop",
  "main",
);

const deploys = parseDeploys(
  [
    "web=vercel:https://api.vercel.com/v1/integrations/deploy/prj_xxxxxxxxxxxxxxxxxxxxxxxx/yyyyyyyyyy",
    "api/production=railway:00000000-0000-4000-8000-000000000000/production/server+worker",
    "api/uat=railway:00000000-0000-4000-8000-000000000000/uat/server+worker",
  ].join(","),
);

test("parseDeploys groups targets by project and names the env", () => {
  assert.deepEqual([...deploys.keys()], ["web", "api"]);
  assert.equal(deploys.get("web")?.[0]?.env, "default");
  assert.equal(deploys.get("web")?.[0]?.provider, "vercel");
  assert.deepEqual(
    deploys.get("api")?.map((t) => t.env),
    ["production", "uat"],
  );
});

test("parseDeploys ignores unknown providers and malformed entries", () => {
  const m = parseDeploys("x=heroku:foo, y=vercel:, z=vercel:https://hook, nope");
  assert.deepEqual([...m.keys()], ["z"]);
});

test("pickDeployTarget: default entry, only entry, named env, ambiguity", () => {
  assert.equal(pickDeployTarget(deploys.get("web"), undefined).target?.provider, "vercel");
  assert.equal(pickDeployTarget(deploys.get("api"), "uat").target?.env, "uat");
  assert.equal(pickDeployTarget(deploys.get("api"), undefined).reason, "ambiguous");
  assert.equal(pickDeployTarget(deploys.get("api"), "staging").reason, "unknown-env");
  assert.equal(pickDeployTarget(undefined, undefined).reason, "no-targets");
  const single = parseDeploys("solo/prod=railway:p/prod/web");
  assert.equal(pickDeployTarget(single.get("solo"), undefined).target?.env, "prod");
});

test("parseRailwaySpec splits project/environment/services", () => {
  assert.deepEqual(parseRailwaySpec("p-id/uat/server+worker"), { projectId: "p-id", environment: "uat", services: ["server", "worker"] });
  assert.throws(() => parseRailwaySpec("p-id/uat"));
});

test("`<project> deploy` and `deploy <project>` both parse as deploy", () => {
  for (const text of ["<@U1> web deploy", "<@U1> deploy web", "<@U1> web ship"]) {
    const cli = parseMentionCli(text, { projects });
    assert.equal(cli.kind, "deploy", text);
    assert.equal(cli.project?.name, "web", text);
    assert.equal(cli.options.env, undefined, text);
  }
});

test("bare `deploy` in a project channel targets that project", () => {
  const cli = parseMentionCli("<@U1> deploy", { projects, channelProject: projects.get("api") });
  assert.equal(cli.kind, "deploy");
  assert.equal(cli.project?.name, "api");
  const none = parseMentionCli("<@U1> deploy", { projects });
  assert.equal(none.kind, "deploy");
  assert.equal(none.project, undefined);
});

test("env comes from env=<name> or a bare word after deploy", () => {
  assert.equal(parseMentionCli("<@U1> api deploy env=uat", { projects }).options.env, "uat");
  assert.equal(parseMentionCli("<@U1> api deploy uat", { projects }).options.env, "uat");
  assert.equal(parseMentionCli("<@U1> deploy api UAT", { projects }).options.env, "uat");
  assert.equal(
    parseMentionCli("<@U1> deploy env=production", { projects, channelProject: projects.get("api") }).options.env,
    "production",
  );
});

test("`deploy -` prints deploy usage", () => {
  for (const text of ["<@U1> api deploy -", "<@U1> deploy api help", "<@U1> deploy -"]) {
    const cli = parseMentionCli(text, { projects, channelProject: projects.get("api") });
    assert.equal(cli.kind, "deploy-usage", text);
    assert.equal(cli.project?.name, "api", text);
  }
});

test("a request that merely contains the word deploy is still a job", () => {
  const cli = parseMentionCli("<@U1> web the deploy script fails on node 22", { projects });
  assert.equal(cli.kind, "run");
  assert.equal(cli.request, "the deploy script fails on node 22");
});

test("formatDeployUsage lists targets and marks the default", () => {
  const text = formatDeployUsage({ bot: "@Shipper", project: "api", targets: deploys.get("api")!, implied: true });
  assert.match(text, /usage: @Shipper deploy \[env=<name>\]/);
  assert.match(text, /production {2}railway/);
  assert.match(text, /@Shipper deploy env=production/);
  const empty = formatDeployUsage({ bot: "@Shipper", project: "nope", targets: [], implied: false });
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
