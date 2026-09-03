/**
 * Step 3: the pattern that actually scales. One cloud agent, three sends, one
 * conversation.
 *
 *   plan (mode: "plan", read-only)  ->  implement (mode: "agent")  ->  verify (structured report)
 *
 * Why split it? Each phase gets a narrow job and a narrow output format, so the
 * model spends its attention on one thing, and you get a checkpoint between
 * phases where a program (or a human) can stop the pipeline. The agent keeps
 * full conversation context across sends, so phase 2 sees phase 1's plan.
 *
 *   npm run pipeline -- --brief example-health-endpoint
 *   npm run pipeline -- --brief ./my-brief.md --repo https://github.com/you/repo --plan-only
 */
import { Agent } from "@cursor/sdk";
import { loadEnv, env, flags } from "./lib/env.js";
import { resolveApiKey } from "./lib/auth.js";
import { buildPrompt, loadBrief } from "./lib/prompts.js";
import { extractJsonBlock, reportResult, reportStartupFailure, saveRunRecord } from "./lib/report.js";
import { printStream } from "./lib/stream.js";

interface VerifyReport {
  done: boolean;
  summary: string;
  definition_of_done: { item: string; met: boolean; evidence: string }[];
  verification: { command: string; passed: boolean }[];
  files_changed: string[];
  follow_ups: string[];
}

loadEnv();
const args = flags();

const briefName = args.brief ?? "example-health-endpoint";
const repo = args.repo ?? env("TARGET_REPO");
const ref = args.ref ?? process.env.TARGET_REF ?? "main";
const planOnly = args["plan-only"] === "true";

const brief = loadBrief(briefName);
const runIds: string[] = [];

function banner(title: string) {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}\n`);
}

try {
  await using agent = await Agent.create({
    apiKey: await resolveApiKey(),
    model: { id: env("CURSOR_MODEL", "composer-2.5") },
    mode: "plan",
    cloud: {
      repos: [{ url: repo, startingRef: ref }],
      autoCreatePR: !planOnly,
      skipReviewerRequest: true,
      metadata: { kit: "cloud-agents", brief: briefName, pipeline: "plan-implement-verify" },
    },
  });
  console.log(`agent: ${agent.agentId}`);
  console.log(`repo:  ${repo}@${ref}`);
  console.log(`brief: ${briefName}`);

  // ---- Phase 1: plan (read-only) -------------------------------------------
  banner("PHASE 1 - PLAN");
  const planRun = await agent.send(buildPrompt("01-plan", brief));
  runIds.push(planRun.id);
  await printStream(planRun);
  const plan = await planRun.wait();
  if (plan.status !== "finished") process.exit(reportResult("plan", plan));

  if (planOnly) {
    saveRunRecord({ agentId: agent.agentId, runIds, repo, brief: briefName, status: "plan-only" });
    console.log(`\nPlan-only mode. Resume with:\n  npm run resume -- --agent ${agent.agentId} --message "Looks good, implement it"`);
    process.exit(reportResult("plan", plan));
  }

  // ---- Phase 2: implement --------------------------------------------------
  banner("PHASE 2 - IMPLEMENT");
  const implRun = await agent.send(buildPrompt("02-implement", brief), { mode: "agent" });
  runIds.push(implRun.id);
  await printStream(implRun);
  const impl = await implRun.wait();
  if (impl.status !== "finished") process.exit(reportResult("implement", impl));

  // ---- Phase 3: verify -----------------------------------------------------
  banner("PHASE 3 - VERIFY");
  const verifyRun = await agent.send(buildPrompt("03-verify", brief, { base_ref: `origin/${ref}` }));
  runIds.push(verifyRun.id);
  await printStream(verifyRun);
  const verify = await verifyRun.wait();

  const report = extractJsonBlock<VerifyReport>(verify.result);
  banner("REPORT");
  if (!report) {
    console.log("Verifier did not return a parseable JSON block. Treating as not done.");
  } else {
    console.log(`done:    ${report.done}`);
    console.log(`summary: ${report.summary}`);
    for (const d of report.definition_of_done) console.log(`  [${d.met ? "x" : " "}] ${d.item}  <- ${d.evidence}`);
    for (const v of report.verification) console.log(`  ${v.passed ? "PASS" : "FAIL"} ${v.command}`);
    if (report.follow_ups.length) console.log(`follow-ups:\n  - ${report.follow_ups.join("\n  - ")}`);
  }

  const prUrl = verify.git?.branches.find((b) => b.prUrl)?.prUrl ?? impl.git?.branches.find((b) => b.prUrl)?.prUrl;
  const file = saveRunRecord({ agentId: agent.agentId, runIds, repo, brief: briefName, prUrl, status: verify.status });
  console.log(`record:  ${file}`);

  const code = reportResult("pipeline", verify);
  process.exit(code === 0 && !(report?.done ?? false) ? 2 : code);
} catch (err) {
  process.exit(reportStartupFailure(err));
}
