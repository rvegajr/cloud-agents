/**
 * Step 2: the same one-shot shape, but on a Cursor-hosted VM against a GitHub repo.
 *
 * What changes versus step 1 is one field: `cloud` instead of `local`. What you
 * get for it: a fresh clone, an isolated machine, a branch pushed for you, and
 * (with autoCreatePR) a pull request you can review.
 *
 *   npm run cloud -- --brief example-health-endpoint
 *   npm run cloud -- --brief ./my-brief.md --repo https://github.com/you/repo --ref main --no-pr
 */
import { Agent } from "@cursor/sdk";
import { loadEnv, env, flags } from "./lib/env.js";
import { resolveApiKey } from "./lib/auth.js";
import { buildPrompt, loadBrief } from "./lib/prompts.js";
import { extractJsonBlock, reportResult, reportStartupFailure, saveRunRecord } from "./lib/report.js";
import { printStream } from "./lib/stream.js";

loadEnv();
const args = flags();

const briefName = args.brief ?? "example-health-endpoint";
const repo = args.repo ?? env("TARGET_REPO");
const ref = args.ref ?? process.env.TARGET_REF ?? "main";
const autoCreatePR = args["no-pr"] !== "true";

const brief = loadBrief(briefName);
const prompt = buildPrompt("oneshot", brief);

console.log(`repo:   ${repo}@${ref}`);
console.log(`brief:  ${briefName}`);
console.log(`PR:     ${autoCreatePR ? "auto-create" : "branch only"}\n`);

try {
  await using agent = await Agent.create({
    apiKey: await resolveApiKey(),
    model: { id: env("CURSOR_MODEL", "composer-2.5") },
    cloud: {
      repos: [{ url: repo, startingRef: ref }],
      autoCreatePR,
      skipReviewerRequest: true,
      metadata: { kit: "cloud-agents", brief: briefName },
    },
  });
  console.log(`agent:  ${agent.agentId}  (cursor.com/agents -> Filter > Source > SDK)\n`);

  const run = await agent.send(prompt);
  console.log(`run:    ${run.id}\n`);

  await printStream(run);
  const result = await run.wait();

  const report = extractJsonBlock<{ done: boolean; summary: string }>(result.result);
  if (report) console.log(`\nagent report: done=${report.done} - ${report.summary}`);

  const file = saveRunRecord({
    agentId: agent.agentId,
    runIds: [run.id],
    repo,
    brief: briefName,
    prUrl: result.git?.branches.find((b) => b.prUrl)?.prUrl,
    status: result.status,
  });
  console.log(`record: ${file}`);

  const code = reportResult("cloud one-shot", result);
  process.exit(code === 0 && report && !report.done ? 2 : code);
} catch (err) {
  process.exit(reportStartupFailure(err));
}
