import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LiveJobs,
  STATUS_PREFIX,
  ago,
  formatChannelStatus,
  formatJobStatus,
  progressFromThread,
} from "./slack-status.js";

const now = Date.parse("2026-10-02T15:00:00Z");
const ts = (minutesAgo: number) => `${((now - minutesAgo * 60_000) / 1000).toFixed(6)}`;

const startOfJob = [
  { text: "<@UBOT> the settings page 500s after logout", ts: ts(20) },
  { text: "agent: bc-1234-abcd\nTriaging against https://github.com/you/web@develop", ts: ts(19) },
  { text: "Planning (read-only)...\nCOST running: $0.08  Cursor billed", ts: ts(15) },
  { text: "Implementing...\nCOST running: $0.31  Cursor billed", ts: ts(6) },
];

test("thread posts fold into stage, agent, spend, and last update", () => {
  const p = progressFromThread(startOfJob);
  assert.equal(p.agentId, "bc-1234-abcd");
  assert.equal(p.stage, "implement");
  assert.equal(p.spend, "$0.31 Cursor billed");
  assert.equal(p.closed, false);
  assert.equal(p.updatedAt, Math.round(Number(ts(6)) * 1000));
});

test("a running job says what it is doing, when, and that nothing is needed", () => {
  const text = formatJobStatus({
    progress: progressFromThread(startOfJob),
    running: true,
    startedAt: now - 20 * 60_000,
    agent: { status: "running", summary: "Fix logout 500 on /settings" },
    now,
  });
  assert.ok(text.startsWith(`${STATUS_PREFIX} I'm making the change now (step 3 of 4`));
  assert.match(text, /Started 20 minutes ago; last update 6 minutes ago\./);
  assert.match(text, /Cursor's summary: "Fix logout 500 on \/settings"/);
  assert.match(text, /Spent so far: \$0\.31 Cursor billed\./);
  assert.match(text, /Nothing for you to do yet/);
  assert.match(text, /Agent bc-1234-abcd$/);
  assert.doesNotMatch(text, /agent:\s*bc-/, "must not look like a thread's agent line");
});

test("done with a ready PR, spend from the COST close", () => {
  const p = progressFromThread([
    ...startOfJob,
    { text: "Verifying...", ts: ts(3) },
    { text: "PR: https://github.com/you/web/pull/7\nVerifier: done\nFixed it.\n  PASS npm test", ts: ts(2) },
    { text: "PR marked ready for review (verifier passed).", ts: ts(2) },
    { text: "Auto-merge is on: it merges by itself when the required checks pass.", ts: ts(2) },
    { text: "COST\n  this run:     $0.52  Cursor billed\n  today:        $3.10  Cursor billed", ts: ts(1) },
  ]);
  assert.equal(p.closed, true);
  const text = formatJobStatus({ progress: p, running: false, now });
  assert.ok(text.startsWith(`${STATUS_PREFIX} it's done. The checks passed and the PR is marked ready for review.`));
  assert.match(text, /PR: https:\/\/github\.com\/you\/web\/pull\/7/);
  assert.match(text, /Auto-merge is on, so it merges by itself when the required checks pass\./);
  assert.match(text, /Last update 1 minute ago\./);
  assert.match(text, /Spent so far: \$0\.52 Cursor billed\./);
});

test("waiting on answers counts the questions", () => {
  const p = progressFromThread([
    { text: "agent: cc-9\nTriaging against https://github.com/you/api@main", ts: ts(5) },
    { text: "Need a bit more to write a brief:\n1. Which page?\n2. Which user role?\n\nReply in this thread and mention me.", ts: ts(4) },
    { text: "COST\n  this run:     unknown", ts: ts(4) },
  ]);
  const text = formatJobStatus({ progress: p, running: false, now });
  assert.match(text, /I'm waiting on you\. I asked 2 questions above/);
  assert.match(text, /Reply in this thread and mention me with the answers\./);
  assert.doesNotMatch(text, /Spent so far/, "unknown spend is not printed as a number");
});

test("a stop is told in the bot's own words, with the way forward", () => {
  const p = progressFromThread([...startOfJob, { text: "implement did not finish (status=error).", ts: ts(1) }]);
  const text = formatJobStatus({ progress: p, running: false, now });
  assert.match(text, /it stopped\. implement did not finish \(status=error\)\./);
  assert.match(text, /pick up the same agent/);
});

test("a mid-job thread with no live job says the bot is not running it", () => {
  const text = formatJobStatus({
    progress: progressFromThread(startOfJob),
    running: false,
    agent: { status: "finished" },
    now,
  });
  assert.match(text, /last thing I posted here was making the change, but I'm not running this job right now/);
  assert.match(text, /Cursor shows the agent as finished\./);
});

test("an empty thread has no job", () => {
  const text = formatJobStatus({ progress: progressFromThread([{ text: "hi", ts: ts(1) }]), running: false, now });
  assert.match(text, /there's no job in this thread yet/);
});

test("earlier status replies do not change the reading", () => {
  const p = progressFromThread([
    ...startOfJob,
    { text: `${STATUS_PREFIX} it stopped. Verifying... PR: https://example.com/x`, ts: ts(0) },
  ]);
  assert.equal(p.stage, "implement");
  assert.equal(p.prUrl, undefined);
});

test("channel status lists live jobs here and counts the rest", () => {
  const jobs = new LiveJobs();
  jobs.start({ key: "1.1", channel: "C1", request: "<@UBOT> fix the logout 500", repo: "r", startedAt: now - 9 * 60_000 });
  jobs.post("1.1", "Verifying...\nCOST running: $0.40  Cursor billed");
  jobs.start({ key: "2.2", channel: "C2", request: "other", repo: "r", startedAt: now });
  const text = formatChannelStatus({ jobs: jobs.list(), channel: "C1", now });
  assert.match(text, /one job is running in this channel\. 1 job is running in other channels\./);
  assert.match(text, /• "fix the logout 500": checking the change, started 9 minutes ago, \$0\.40 Cursor billed so far/);
  jobs.finish("1.1");
  assert.match(formatChannelStatus({ jobs: jobs.list(), channel: "C1", now }), /nothing is running in this channel right now/);
});

test("ago reads like speech", () => {
  assert.equal(ago(now - 10_000, now), "just now");
  assert.equal(ago(now - 60_000, now), "1 minute ago");
  assert.equal(ago(now - 3 * 3600_000, now), "3 hours ago");
});
