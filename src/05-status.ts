/**
 * Step 5: see what you have.
 *
 * Observability is the difference between an autonomous system and a runaway
 * one. This lists connected repos, available models, and your recent cloud
 * agents with cost. Use it to answer "what did I set up?" and "what did it cost?"
 *
 *   npm run status
 *   npm run status -- --agent bc-xxxx     # detail + usage for one agent
 */
import { Agent, Cursor } from "@cursor/sdk";
import { loadEnv, flags } from "./lib/env.js";
import { resolveApiKey } from "./lib/auth.js";
import { reportStartupFailure } from "./lib/report.js";

loadEnv();
const args = flags();

try {
  const apiKey = await resolveApiKey();

  if (args.agent) {
    const info = await Agent.get(args.agent, { apiKey });
    console.log(JSON.stringify(info, null, 2));
    const usage = await Agent.getUsage(args.agent, { apiKey });
    console.log("\nusage:", JSON.stringify(usage, null, 2));
    process.exit(0);
  }

  const me = await Cursor.me({ apiKey });
  console.log(`account: ${me.userEmail ?? "(service account)"}  key="${me.apiKeyName}"\n`);

  const models = await Cursor.models.list({ apiKey });
  console.log(`models (${models.length}):`);
  for (const m of models) console.log(`  ${m.id}`);

  const repos = await Cursor.repositories.list({ apiKey });
  console.log(`\nconnected repos (${repos.length}):`);
  if (repos.length === 0) console.log("  none - connect GitHub at cursor.com/agents before running the cloud scripts");
  for (const r of repos) console.log(`  ${r.url}`);

  const { items: agents } = await Agent.list({ runtime: "cloud", apiKey });
  const mine = agents.filter((a) => a.runtime === "cloud" && a.metadata?.kit === "cloud-agents");
  console.log(`\ncloud agents from this kit (${mine.length} of ${agents.length} listed):`);
  for (const a of mine.slice(0, 20)) {
    const brief = a.runtime === "cloud" ? (a.metadata?.brief ?? "") : "";
    console.log(`  ${a.agentId}  ${(a.status ?? "?").padEnd(9)} ${brief.padEnd(28)} ${a.name}`);
  }
  console.log(`\ninspect one:  npm run status -- --agent <bc-id>`);
  process.exit(0);
} catch (err) {
  process.exit(reportStartupFailure(err));
}
