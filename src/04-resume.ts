/**
 * Step 4: come back later.
 *
 * A cloud agent is durable. Its ID (`bc-...`) is a handle you can pick up from
 * another process, another machine, or a cron job, and the conversation is
 * still there. This is how "review the PR comments and address them" or "the
 * plan looked good, go ahead" work without re-explaining anything.
 *
 *   npm run resume -- --agent bc-xxxx --message "Address the review comments on the PR"
 *   npm run resume -- --agent bc-xxxx --message "Looks good, implement it" --mode agent
 */
import { Agent } from "@cursor/sdk";
import { loadEnv, flags } from "./lib/env.js";
import { resolveApiKey } from "./lib/auth.js";
import { reportResult, reportStartupFailure } from "./lib/report.js";
import { printStream } from "./lib/stream.js";

loadEnv();
const args = flags();

const agentId = args.agent;
const message = args.message;
if (!agentId || !message) {
  console.error('usage: npm run resume -- --agent <bc-id> --message "..." [--mode agent|plan]');
  process.exit(1);
}
const mode = args.mode === "plan" || args.mode === "agent" ? args.mode : undefined;

try {
  const apiKey = await resolveApiKey();
  await using agent = await Agent.resume(agentId, { apiKey });

  const info = await Agent.get(agentId, { apiKey });
  console.log(`agent:  ${agentId}  status=${info.status ?? "unknown"}  "${info.name}"`);

  const run = await agent.send(message, mode ? { mode } : {});
  console.log(`run:    ${run.id}\n`);
  await printStream(run);
  const result = await run.wait();
  console.log(`\n${result.result ?? ""}`);
  process.exit(reportResult("resume", result));
} catch (err) {
  process.exit(reportStartupFailure(err));
}
