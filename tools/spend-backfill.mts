/**
 * Historical agent spend backfill: sums Cursor Cloud Agent cost over an
 * arbitrary date range, grouped by day and repo. Prints one JSON object.
 *
 *   npx tsx tools/spend-backfill.mts --since 2026-06-01 [--until 2026-09-21]
 *
 * spend-ledger.mts only covers the current month (it stops paging at the month
 * boundary), so month-to-date is all it can ever report. This walks further
 * back for one-off history rebuilds. Usage lookups are one API call per agent,
 * so this is slow by nature - run it deliberately, not on a schedule.
 */
import { Agent } from "@cursor/sdk";
import { loadEnv } from "../src/lib/env.js";
import { resolveApiKey } from "../src/lib/auth.js";

loadEnv();
const apiKey = await resolveApiKey();

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const sinceStr = arg("--since");
if (!sinceStr) {
  console.error("usage: spend-backfill.mts --since YYYY-MM-DD [--until YYYY-MM-DD]");
  process.exit(2);
}
const since = Date.parse(`${sinceStr}T00:00:00Z`);
const untilStr = arg("--until");
const until = untilStr ? Date.parse(`${untilStr}T23:59:59Z`) : Date.now();
if (Number.isNaN(since) || Number.isNaN(until)) {
  console.error("bad date; expected YYYY-MM-DD");
  process.exit(2);
}

type A = { agentId: string; createdAt?: number; repos?: string[] };
const all: A[] = [];
let cursor: string | undefined;
let pages = 0;
for (; pages < 500; pages++) {
  const res = await Agent.list({ runtime: "cloud", limit: 100, cursor, apiKey });
  all.push(...(res.items as A[]));
  cursor = res.nextCursor;
  if (!cursor) break;
  // newest-first: stop once the oldest item on this page predates the window
  const oldest = (res.items[res.items.length - 1] as A)?.createdAt ?? 0;
  if (oldest < since) break;
}

const inRange = all.filter((a) => (a.createdAt ?? 0) >= since && (a.createdAt ?? 0) <= until);
process.stderr.write(`listed ${all.length} agents over ${pages + 1} pages; ${inRange.length} in range\n`);

const byDay: Record<string, number> = {};
const byRepo: Record<string, number> = {};
let total = 0;
let done = 0;
let missing = 0;

// Bounded concurrency: one getUsage call per agent is the slow part.
const CONCURRENCY = 8;
let next = 0;
async function worker() {
  for (;;) {
    const i = next++;
    if (i >= inRange.length) return;
    const a = inRange[i];
    try {
      const u = await Agent.getUsage(a.agentId, { apiKey });
      const usd = u.cost.chargedCents / 100;
      const day = new Date(a.createdAt!).toISOString().slice(0, 10);
      const repo = (a.repos?.[0] ?? "?").split("/").pop()!;
      byDay[day] = (byDay[day] ?? 0) + usd;
      byRepo[repo] = (byRepo[repo] ?? 0) + usd;
      total += usd;
    } catch {
      missing++; // agent with no usage record
    }
    if (++done % 50 === 0) process.stderr.write(`  usage ${done}/${inRange.length}\n`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const round = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(2)]));

console.log(
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    since: sinceStr,
    until: untilStr ?? new Date(until).toISOString().slice(0, 10),
    totalUsd: +total.toFixed(2),
    agentCount: inRange.length,
    agentsWithoutUsage: missing,
    byDay: round(byDay),
    byRepo: round(byRepo),
  }),
);
