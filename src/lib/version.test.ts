import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMentionCli, isVersionToken, parseProjects } from "./slack-cli.js";
import { formatVersion, formatVersionBlock, stampEnvPair, STAMP_ENV, versionInfo, type VersionInfo } from "./version.js";

const projects = parseProjects("api=https://github.com/you/api@develop", "main");

test("isVersionToken matches the spellings people actually type", () => {
  for (const t of ["version", "Version", "--version", "-v", " version "]) {
    assert.ok(isVersionToken(t), t);
  }
  for (const t of ["versions", "v", "", "help"]) {
    assert.ok(!isVersionToken(t), t);
  }
});

test("`@bot version` is its own command, not a job", () => {
  const cli = parseMentionCli("<@U1> version", { projects });
  assert.equal(cli.kind, "version");
  assert.equal(cli.request, "");
  // A request that merely mentions a version is still work to do.
  const job = parseMentionCli("<@U1> api version the footer says 0.0.0", { projects });
  assert.equal(job.kind, "run");
  assert.equal(job.request, "version the footer says 0.0.0");
});

const stamped: VersionInfo = {
  version: "0.2.0",
  tag: "v0.2.0",
  commit: "abc123def456",
  branch: "main",
  dirty: false,
  builtAt: "2026-09-05T21:00:00.000Z",
  source: "version.json",
};

test("formatVersion is one line, and says when the tree was dirty", () => {
  assert.equal(formatVersion(stamped), "v0.2.0 (abc123def456 on main)");
  assert.equal(formatVersion({ ...stamped, dirty: true }), "v0.2.0 (abc123def456 on main dirty)");
  // A tag ahead of the package version is worth showing; an identical one is noise.
  assert.equal(formatVersion({ ...stamped, tag: "v0.2.0-3-gabc1234" }), "v0.2.0 [v0.2.0-3-gabc1234] (abc123def456 on main)");
  assert.equal(formatVersion({ version: "0.2.0", source: "package.json" }), "v0.2.0");
});

test("formatVersionBlock names the source, so a live checkout cannot pass as a deploy", () => {
  assert.match(formatVersionBlock({ ...stamped, source: "BUILD_INFO" }), /BUILD_INFO, set by `npm run deploy`/);
  assert.match(formatVersionBlock(stamped), /version\.json, written by `npm run stamp`/);
  assert.match(formatVersionBlock(stamped), /commit\s+abc123def456/);
  assert.match(formatVersionBlock({ ...stamped, source: "git" }), /this is not a deployed build/);
  assert.match(formatVersionBlock({ version: "0.2.0", source: "package.json" }), /no stamp, no git/);
  assert.match(formatVersionBlock({ ...stamped, dirty: true }), /tree\s+dirty/);
});

test("stampEnvPair is what travels to the host: BUILD_INFO=<json>, no source field", () => {
  const pair = stampEnvPair(stamped);
  assert.ok(pair.startsWith(`${STAMP_ENV}=`));
  const parsed = JSON.parse(pair.slice(STAMP_ENV.length + 1)) as Record<string, unknown>;
  assert.equal(parsed.commit, "abc123def456");
  assert.equal(parsed.version, "0.2.0");
  // The source is decided by where it was read from, so shipping it would lie.
  assert.ok(!("source" in parsed));
});

test("versionInfo reads this checkout and is cached", () => {
  const info = versionInfo();
  assert.match(info.version, /^\d+\.\d+\.\d+/);
  assert.ok(["version.json", "git", "package.json"].includes(info.source));
  assert.equal(versionInfo(), info);
});
