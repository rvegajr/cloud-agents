import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { HeartbeatMonitor, parseBeat, relayTextSender } from "./heartbeat.js";
import { JobStore, listenJobsHttp } from "./jobs-http.js";

const MIN = 60_000;
const T0 = Date.parse("2026-10-06T14:00:00Z");

function monitor(start = T0) {
  return new HeartbeatMonitor({ staleMs: 30 * MIN, expected: ["claude-rc"], startedAt: start });
}

test("quiet: nothing is said inside the window after the bot starts", () => {
  const m = monitor();
  assert.deepEqual(m.check(T0 + 29 * MIN), []);
});

test("quiet: no beat at all for the whole window after a start is reported once", () => {
  const m = monitor();
  const [a] = m.check(T0 + 31 * MIN);
  assert.equal(a?.kind, "quiet");
  assert.match(a!.text, /^claude-rc: no heartbeat from claude-rc for 31 min/);
  assert.deepEqual(m.check(T0 + 45 * MIN), []);
});

test("quiet: reported once when beats stop, with the last-seen time and what it means", () => {
  const m = monitor();
  m.beat("claude-rc", { host: "mac", ok: 16, total: 16 }, T0 + 1 * MIN);
  assert.deepEqual(m.check(T0 + 20 * MIN), []);
  const [a] = m.check(T0 + 32 * MIN);
  assert.equal(a?.kind, "quiet");
  assert.match(a!.text, /for 31 min \(last 14:01 UTC from mac\)/);
  assert.match(a!.text, /asleep, off, at the FileVault screen, or offline/);
  assert.deepEqual(m.check(T0 + 50 * MIN), []);
});

test("back: reported once when beats resume after a quiet alert", () => {
  const m = monitor();
  m.check(T0 + 31 * MIN);
  m.beat("claude-rc", { host: "mac", ok: 14, total: 16 }, T0 + 40 * MIN);
  const [a] = m.check(T0 + 41 * MIN);
  assert.equal(a?.kind, "back");
  assert.equal(a!.text, "claude-rc: heartbeat back from mac (14/16 sessions OK)");
  assert.deepEqual(m.check(T0 + 42 * MIN), []);
});

test("steady beats never alert", () => {
  const m = monitor();
  for (let t = 0; t <= 120; t += 10) {
    m.beat("claude-rc", { host: "mac", ok: 16, total: 16 }, T0 + t * MIN);
    assert.deepEqual(m.check(T0 + t * MIN + 30_000), []);
  }
});

test("status reports each source without secrets", () => {
  const m = monitor();
  m.beat("claude-rc", { host: "mac", ok: 15, total: 16, needs_you: 1 }, T0 + 5 * MIN);
  assert.deepEqual(m.status(T0 + 7 * MIN), {
    "claude-rc": { lastBeat: "2026-10-06T14:05:00.000Z", agoMin: 2, quiet: false, host: "mac", ok: 15, total: 16, needs_you: 1 },
  });
});

test("parseBeat accepts only a known shape", () => {
  assert.deepEqual(parseBeat({ source: "claude-rc", host: "mac", ok: 16, total: 16, needs_you: 0 }), {
    ok: true,
    source: "claude-rc",
    beat: { host: "mac", ok: 16, total: 16, needs_you: 0 },
  });
  assert.equal(parseBeat({ host: "mac" }).ok, false);
  assert.equal(parseBeat({ source: "x".repeat(80) }).ok, false);
  assert.equal(parseBeat([]).ok, false);
});

test("relayTextSender posts /sms/send with the product key and production env", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response("{}", { status: 200 });
  };
  const send = relayTextSender({ apiKey: "k-123", baseUrl: "https://relay.test", fetch: fakeFetch as typeof fetch });
  await send("+18175550100", "hello");
  assert.equal(calls[0]!.url, "https://relay.test/sms/send");
  const h = calls[0]!.init.headers as Record<string, string>;
  assert.equal(h.Authorization, "Bearer k-123");
  assert.equal(h["X-App-Env"], "production");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { to: "+18175550100", body: "hello" });
});

test("relayTextSender failure names the status, never the key", async () => {
  const fakeFetch = async () => new Response("{}", { status: 403 });
  const send = relayTextSender({ apiKey: "k-SECRET", baseUrl: "https://relay.test", fetch: fakeFetch as typeof fetch });
  await assert.rejects(send("+1", "x"), (e: Error) => /403/.test(e.message) && !e.message.includes("k-SECRET"));
});

async function serve(heartbeat?: { token: string; monitor: HeartbeatMonitor; now: () => number }) {
  const server = await listenJobsHttp(
    {
      token: "jobs-token",
      store: new JobStore(),
      health: () => ({ ok: true }),
      projects: () => [],
      startJob: async () => {},
      postMention: async () => ({ channel: "c" }),
      heartbeat,
    },
    0,
  );
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("POST /v1/heartbeat takes only the heartbeat token, never the jobs token", async () => {
  const m = monitor();
  const s = await serve({ token: "hb-token", monitor: m, now: () => T0 + MIN });
  try {
    const body = JSON.stringify({ source: "claude-rc", host: "mac", ok: 16, total: 16 });
    const post = (auth: string) =>
      fetch(`${s.url}/v1/heartbeat`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body });
    assert.equal((await post("Bearer jobs-token")).status, 401);
    assert.equal((await post("Bearer wrong")).status, 401);
    const ok = await post("Bearer hb-token");
    assert.equal(ok.status, 200);
    assert.equal(m.status(T0 + MIN)["claude-rc"]?.host, "mac");
  } finally {
    await s.close();
  }
});

test("GET /v1/heartbeat (status) needs the jobs token; heartbeat routes 404 when not configured", async () => {
  const m = monitor();
  const s = await serve({ token: "hb-token", monitor: m, now: () => T0 + MIN });
  try {
    assert.equal((await fetch(`${s.url}/v1/heartbeat`, { headers: { authorization: "Bearer hb-token" } })).status, 401);
    const r = await fetch(`${s.url}/v1/heartbeat`, { headers: { authorization: "Bearer jobs-token" } });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(((await r.json()) as { sources: object }).sources), ["claude-rc"]);
  } finally {
    await s.close();
  }
  const bare = await serve(undefined);
  try {
    const r = await fetch(`${bare.url}/v1/heartbeat`, { method: "POST", headers: { authorization: "Bearer hb-token" }, body: "{}" });
    assert.equal(r.status, 404);
  } finally {
    await bare.close();
  }
});
