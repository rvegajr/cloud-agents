/**
 * Agent spend ledger: sums Cursor Cloud Agent cost for the current month,
 * grouped by day and by repo. Prints one JSON object to stdout.
 *
 *   npx tsx tools/spend-ledger.mts
 *
 * Used by spending-monitor's daily cursor_agent_spend.py check.
 */
import { Agent } from "@cursor/sdk";
import { loadEnv } from "../src/lib/env.js";
import { resolveApiKey } from "../src/lib/auth.js";

loadEnv();
const apiKey = await resolveApiKey();

const now = new Date();
const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

const all: { agentId: string; createdAt?: number; name?: string; repos?: string[] }[] = [];
let cursor: string | undefined;
for (let page = 0; page < 30; page++) {
  const res = await Agent.list({ runtime: "cloud", limit: 100, cursor, apiKey });
  all.push(...(res.items as typeof all));
  cursor = res.nextCursor;
  if (!cursor) break;
  // list is newest-first; stop paging once we're past the month boundary
  if (res.items.length && (res.items[res.items.length - 1] as { createdAt?: number }).createdAt! < monthStart) break;
}

const inMonth = all.filter((a) => (a.createdAt ?? 0) >= monthStart);
const byDay: Record<string, number> = {};
const byRepo: Record<string, number> = {};
let total = 0;

for (const a of inMonth) {
  try {
    const u = await Agent.getUsage(a.agentId, { apiKey });
    const usd = u.cost.chargedCents / 100;
    const day = new Date(a.createdAt!).toISOString().slice(0, 10);
    const repo = (a.repos?.[0] ?? "?").split("/").pop()!;
    byDay[day] = (byDay[day] ?? 0) + usd;
    byRepo[repo] = (byRepo[repo] ?? 0) + usd;
    total += usd;
  } catch {
    /* agent with no usage yet */
  }
}

const round = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(2)]));

console.log(
  JSON.stringify({
    generatedAt: now.toISOString(),
    monthToDateUsd: +total.toFixed(2),
    agentCount: inMonth.length,
    byDay: round(byDay),
    byRepo: round(byRepo),
  }),
);
