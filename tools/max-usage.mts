/**
 * Print the Claude Max plan windows (5-hour, 7-day) and record them for hybrid
 * routing, without waiting for a build to run. Spends one trivial Max turn.
 *
 *   npm run max-usage
 */
import { makeClaudeSend } from "../src/lib/engine-claude.js";
import { loadEnv } from "../src/lib/env.js";
import { formatMaxUsage, loadMaxUsage, policyFromEnv, saveMaxUsage, type MaxUsage } from "../src/lib/routing.js";

loadEnv();
const seen = new Map<string, MaxUsage>();
const send = makeClaudeSend({
  cwd: process.cwd(),
  model: "haiku",
  onRateLimit: (u) => {
    if (u.rateLimitType) seen.set(u.rateLimitType, u);
  },
});
const turn = await send("Reply with the single word OK.", { mode: "plan" });
if (turn.status !== "finished") {
  console.error(`probe turn did not finish (${turn.status})`);
  process.exit(2);
}
if (!seen.size) {
  console.error("no rate-limit sample arrived; is this an API-key session?");
  process.exit(2);
}
for (const u of seen.values()) {
  saveMaxUsage(u);
  console.log(`${u.rateLimitType}: ${((u.utilization ?? 0) * 100).toFixed(1)}%${u.resetsAt ? `, resets ${new Date(u.resetsAt * 1000).toISOString()}` : ""}`);
}
const policy = policyFromEnv("hybrid");
console.log(`routing sample: ${formatMaxUsage(loadMaxUsage())}; ceiling ${(policy.ceiling * 100).toFixed(0)}% -> ${policy.overCeiling}`);
