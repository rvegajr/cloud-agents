import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveWatch, liveWatchIO, loadWatches, repoOfPr, saveWatches, type Contains, type LiveWatchIO, type PrState } from "./live-watch.js";
import type { Registry, Service } from "./freshness.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-04T12:00:00Z");
const PR = "https://github.com/rvegajr/blessbox/pull/320";
const MERGE = "aaaaaaaa11111111";

function svc(name: string, env: string, repo = "rvegajr/blessbox"): Service {
  return { name, env, repo, health: `https://${env}.${name}.example/api/health`, expect: { branch: env === "production" ? "main" : "develop" } };
}

const registry: Registry = {
  graceSeconds: 900,
  services: [svc("blessbox", "dev"), svc("blessbox", "production"), svc("other", "production", "rvegajr/other")],
};

function fake(opts: { pr?: PrState; deployed?: Record<string, string | undefined>; contains?: (deployed: string) => Contains } = {}) {
  const posts: string[] = [];
  const saved: number[] = [];
  const state = { pr: opts.pr ?? ({ state: "open" } as PrState), deployed: { ...(opts.deployed ?? {}) } };
  const io: LiveWatchIO = {
    prState: async () => state.pr,
    deployedCommit: async (s) => state.deployed[`${s.name}/${s.env}`],
    contains: async (_repo, _sha, deployed) => (opts.contains ? opts.contains(deployed) : deployed === "live0000" ? "yes" : "no"),
    post: async (_c, _t, text) => {
      posts.push(text);
    },
    save: (w) => saved.push(w.length),
  };
  return { io, posts, saved, state };
}

const job = { prUrl: PR, channel: "C0C0FV555DE", threadTs: "1793769930.033969", user: "U0BUX03KFMY" };

test("repoOfPr: owner/repo, lowercased", () => {
  assert.equal(repoOfPr("https://github.com/rvegajr/BlessBox/pull/3"), "rvegajr/blessbox");
  assert.equal(repoOfPr("not a pr"), undefined);
});

test("add: says which deploys it will watch, once per PR and thread", async () => {
  const f = fake();
  const w = new LiveWatch({ registry, io: f.io });
  assert.equal(await w.add(job, T0), true);
  assert.equal(await w.add(job, T0), false);
  assert.deepEqual(f.posts, ["I'll post here when PR #320 is live on blessbox dev, blessbox production."]);
  assert.equal(w.list().length, 1);
});

test("add: a repo with no deploy in services.json is not watched, and the thread is told", async () => {
  const f = fake();
  const w = new LiveWatch({ registry, io: f.io });
  assert.equal(await w.add({ ...job, prUrl: "https://github.com/rvegajr/rubriq-flow/pull/9" }, T0), false);
  assert.match(f.posts[0]!, /rvegajr\/rubriq-flow has no \/health in services.json/);
  assert.equal(w.list().length, 0);
});

test("tick: an open PR is left alone and nothing is posted", async () => {
  const f = fake();
  const w = new LiveWatch({ registry, io: f.io, initial: [{ ...job, createdAt: T0, announced: [] }] });
  await w.tick(T0 + 60_000);
  assert.deepEqual(f.posts, []);
  assert.equal(w.list().length, 1);
});

test("tick: a PR closed without merging is reported once and dropped", async () => {
  const f = fake({ pr: { state: "closed" } });
  const w = new LiveWatch({ registry, io: f.io, initial: [{ ...job, createdAt: T0, announced: [] }] });
  await w.tick(T0);
  await w.tick(T0 + 1);
  assert.deepEqual(f.posts, ["PR #320 was closed without merging, so there is nothing new to retest."]);
  assert.equal(w.list().length, 0);
});

test("tick: each deploy is announced once as it picks up the merge; production tags the tester", async () => {
  const f = fake({ pr: { state: "merged", sha: MERGE }, deployed: { "blessbox/dev": "live0000", "blessbox/production": "old00000" } });
  const w = new LiveWatch({ registry, io: f.io, initial: [{ ...job, createdAt: T0, announced: [] }] });

  await w.tick(T0 + 10 * 60_000);
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0], "Live on blessbox dev (dev.blessbox.example): PR #320 is in the running build live0000.");
  assert.equal(w.list()[0]?.mergedSha, MERGE);

  await w.tick(T0 + 20 * 60_000);
  assert.equal(f.posts.length, 1, "dev is not announced twice, production has not moved");

  f.state.deployed["blessbox/production"] = "live0000";
  await w.tick(T0 + 2 * DAY);
  assert.equal(
    f.posts[1],
    "Live on blessbox production (production.blessbox.example): PR #320 is in the running build live0000. <@U0BUX03KFMY> please retest.",
  );
  assert.equal(w.list().length, 0, "every deploy announced, watch dropped");
});

test("tick: a deploy whose /health has no commit is skipped, not failed", async () => {
  const f = fake({ pr: { state: "merged", sha: MERGE }, deployed: { "blessbox/dev": undefined, "blessbox/production": "live0000" } });
  const w = new LiveWatch({ registry, io: f.io, initial: [{ ...job, createdAt: T0, announced: [] }] });
  await w.tick(T0);
  assert.equal(f.posts.length, 1);
  assert.match(f.posts[0]!, /^Live on blessbox production .* <@U0BUX03KFMY> please retest\.$/);
  assert.equal(w.list().length, 1, "dev still pending");
});

test("tick: the jobs API is never tagged", async () => {
  const f = fake({ pr: { state: "merged", sha: MERGE }, deployed: { "blessbox/dev": "live0000", "blessbox/production": "live0000" } });
  const w = new LiveWatch({ registry, io: f.io, initial: [{ ...job, user: "jobs-api", createdAt: T0, announced: [] }] });
  await w.tick(T0);
  assert.equal(f.posts.length, 2);
  for (const p of f.posts) assert.doesNotMatch(p, /<@/);
});

test("tick: gives up after the max age and names the deploys that never got it", async () => {
  const f = fake({ pr: { state: "merged", sha: MERGE }, deployed: { "blessbox/dev": "live0000", "blessbox/production": "old00000" } });
  const w = new LiveWatch({ registry, io: f.io, maxAgeMs: 14 * DAY, initial: [{ ...job, createdAt: T0, announced: [] }] });
  await w.tick(T0 + 15 * DAY);
  assert.equal(f.posts.length, 2);
  assert.equal(
    f.posts[1],
    "Stopped watching PR #320 after 14 days: merged, but not live on blessbox production yet. `npm run version-board` shows what each deploy is running.",
  );
  assert.equal(w.list().length, 0);
});

test("tick: an unmerged PR past the max age says so", async () => {
  const f = fake();
  const w = new LiveWatch({ registry, io: f.io, maxAgeMs: DAY, initial: [{ ...job, createdAt: T0, announced: [] }] });
  await w.tick(T0 + 2 * DAY);
  assert.match(f.posts[0]!, /after 1 days: still not merged\./);
});

test("tick: one watch throwing does not stop the others", async () => {
  const f = fake({ pr: { state: "closed" } });
  let calls = 0;
  const io: LiveWatchIO = {
    ...f.io,
    prState: async () => {
      calls += 1;
      if (calls === 1) throw new Error("GitHub 502");
      return { state: "closed" };
    },
  };
  const w = new LiveWatch({
    registry,
    io,
    initial: [
      { ...job, createdAt: T0, announced: [] },
      { ...job, threadTs: "1793769999.000001", createdAt: T0, announced: [] },
    ],
  });
  await w.tick(T0);
  assert.equal(f.posts.length, 1);
  assert.equal(w.list().length, 1, "the one that threw is kept for the next tick");
});

test("state file: round-trips, and a missing or broken file is an empty list", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-watch-"));
  const file = join(dir, "nested", "live-watch.json");
  assert.deepEqual(loadWatches(file), []);
  saveWatches(file, [{ ...job, createdAt: T0, announced: ["blessbox/dev"] }]);
  assert.deepEqual(loadWatches(file), [{ ...job, createdAt: T0, announced: ["blessbox/dev"] }]);
});

test("liveWatchIO: reads merged/closed/open from the PR and compare status from GitHub", async () => {
  const seen: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url);
    seen.push(u.replace("https://api.github.com/", ""));
    if (u.endsWith("/pulls/320")) return new Response(JSON.stringify({ state: "closed", merged: true, merge_commit_sha: MERGE }));
    if (u.endsWith("/pulls/321")) return new Response(JSON.stringify({ state: "closed", merged: false }));
    if (u.endsWith("/pulls/322")) return new Response(JSON.stringify({ state: "open", merged: false }));
    if (u.includes("/compare/")) return new Response(JSON.stringify({ status: u.endsWith("...ahead") ? "ahead" : "behind" }));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const io = liveWatchIO({ githubToken: "t", post: async () => {}, fetchImpl });
  assert.deepEqual(await io.prState(PR), { state: "merged", sha: MERGE });
  assert.deepEqual(await io.prState(PR.replace("320", "321")), { state: "closed" });
  assert.deepEqual(await io.prState(PR.replace("320", "322")), { state: "open" });
  assert.equal(await io.contains("rvegajr/blessbox", MERGE, "ahead"), "yes");
  assert.equal(await io.contains("rvegajr/blessbox", MERGE, "behind"), "no");
  assert.ok(seen.includes(`repos/rvegajr/blessbox/compare/${MERGE}...ahead`));
});
