import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commitFromHealth,
  exitCodeFor,
  formatVersionBoard,
  loadRegistry,
  parseRegistry,
  sameCommit,
  verdictFor,
  type Row,
  type Service,
} from "./freshness.js";

const service: Service = {
  name: "tailorfolio",
  env: "production",
  health: "https://tailorfolio.com/health",
  repo: "rvegajr/tailorfolio",
  expect: { branch: "main" },
};

const now = new Date("2026-09-29T12:00:00.000Z");

test("the shipped registry parses and every service is complete", () => {
  const registry = loadRegistry();
  assert.ok(registry.services.length > 0);
  assert.ok(registry.graceSeconds > 0);
  for (const s of registry.services) {
    assert.ok(s.health.startsWith("https://"), `${s.name}/${s.env} must be https`);
    assert.match(s.repo, /^[\w.-]+\/[\w.-]+$/, `${s.name}/${s.env} repo must be owner/name`);
  }
});

test("a service missing a field is refused, not half-loaded", () => {
  assert.throws(
    () => parseRegistry(JSON.stringify({ services: [{ name: "x", env: "production", health: "https://x", repo: "a/b" }] })),
    /expect\.branch/,
  );
});

test("commitFromHealth reads the contract field", () => {
  // TailorFolio's real payload.
  const real = {
    ok: true,
    service: "tailorfolio",
    version: "1.0.0.0",
    utc: "2026-09-28T15:32:43.8070159Z",
    commit: "d6e2af5d4c30c2ca3fbbf76d0f924a16b2277593",
    env: "production",
  };
  assert.equal(commitFromHealth(real), "d6e2af5d4c30c2ca3fbbf76d0f924a16b2277593");
});

test("commitFromHealth falls back to a formatted version string", () => {
  // This kit's own bot reports `formatVersion()`, not a commit field.
  assert.equal(commitFromHealth({ version: "v0.2.0 (abc123def456 on main)" }), "abc123def456");
});

test("commitFromHealth does not mistake a build number for a sha", () => {
  assert.equal(commitFromHealth({ version: "1.0.0.0" }), undefined);
  assert.equal(commitFromHealth({ version: "build 1234567" }), undefined);
  assert.equal(commitFromHealth({ success: true, status: "ok" }), undefined);
  assert.equal(commitFromHealth(undefined), undefined);
  assert.equal(commitFromHealth("ok"), undefined);
});

test("short and long spellings of a commit are the same commit", () => {
  assert.ok(sameCommit("d6e2af5d4c30", "d6e2af5d4c30c2ca3fbbf76d0f924a16b2277593"));
  assert.ok(sameCommit("D6E2AF5D4C30", "d6e2af5d4c30c2ca3fbbf76d0f924a16b2277593"));
  assert.ok(!sameCommit("9774f18b59aa", "d6e2af5d4c30c2ca3fbbf76d0f924a16b2277593"));
  // Too short to be evidence of anything.
  assert.ok(!sameCommit("d6e2af", "d6e2af5d4c30c2ca3fbbf76d0f924a16b2277593"));
  assert.ok(!sameCommit(undefined, "d6e2af5d4c30"));
});

test("matching commits are current", () => {
  const v = verdictFor({ reachable: true, deployed: "d6e2af5d4c30", expected: "d6e2af5d4c30c2ca", graceSeconds: 900, now });
  assert.equal(v, "current");
});

test("a merge still rolling out is deploying, not stale", () => {
  const v = verdictFor({
    reachable: true,
    deployed: "aaaaaaaaaaaa",
    expected: "bbbbbbbbbbbb",
    expectedAt: "2026-09-29T11:55:00.000Z", // five minutes ago
    graceSeconds: 900,
    now,
  });
  assert.equal(v, "deploying");
});

test("once the grace window passes, behind means stale", () => {
  const v = verdictFor({
    reachable: true,
    deployed: "aaaaaaaaaaaa",
    expected: "bbbbbbbbbbbb",
    expectedAt: "2026-09-29T10:00:00.000Z", // two hours ago
    graceSeconds: 900,
    now,
  });
  assert.equal(v, "stale");
});

test("behind with no commit date is stale, not given the benefit of the doubt", () => {
  const v = verdictFor({ reachable: true, deployed: "aaaaaaaaaaaa", expected: "bbbbbbbbbbbb", graceSeconds: 900, now });
  assert.equal(v, "stale");
});

test("a service that answers without a commit is unknown, not current", () => {
  // The failure that matters: silence must never read as agreement.
  assert.equal(verdictFor({ reachable: true, expected: "bbbbbbbbbbbb", graceSeconds: 900, now }), "unknown");
  assert.equal(verdictFor({ reachable: true, deployed: "aaaaaaaaaaaa", graceSeconds: 900, now }), "unknown");
  assert.equal(verdictFor({ reachable: false, graceSeconds: 900, now }), "unreachable");
});

const rows: Row[] = [
  { service, deployed: "d6e2af5d4c30", expected: "d6e2af5d4c30", verdict: "current" },
  {
    service: { ...service, name: "blessbox", health: "https://www.blessbox.org/api/health", note: "no commit in /health yet" },
    expected: "cccccccccccc",
    verdict: "unknown",
  },
  {
    service: { ...service, name: "relay", env: "uat" },
    deployed: "aaaaaaaaaaaa",
    expected: "bbbbbbbbbbbb",
    behind: 4,
    verdict: "stale",
    detail: "4 behind main",
  },
];

test("exit code fails on stale, and on unknown only under --strict", () => {
  assert.equal(exitCodeFor([rows[0]!]), 0);
  assert.equal(exitCodeFor([rows[0]!, rows[1]!]), 0);
  assert.equal(exitCodeFor([rows[0]!, rows[1]!], true), 1);
  assert.equal(exitCodeFor(rows), 1);
  assert.equal(exitCodeFor([{ service, verdict: "unreachable" }]), 1);
});

test("the board names what is stale and what cannot answer", () => {
  const out = formatVersionBoard(rows, now);
  assert.match(out, /1 current · 1 stale · 1 unknown/);
  assert.match(out, /relay\/uat is 4 commits behind main/);
  assert.match(out, /no commit in \/health yet/);
  // Full shas are noise in a table; eight characters tell two deploys apart.
  assert.match(out, /d6e2af5d\s+d6e2af5d\s+current/);
});

test("an empty registry says so instead of printing an empty table", () => {
  assert.match(formatVersionBoard([], now), /no services registered/);
});
