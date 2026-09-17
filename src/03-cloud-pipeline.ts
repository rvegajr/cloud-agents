/**
 * Step 3: the pattern that actually scales. One cloud agent, three sends, one
 * conversation.
 *
 *   plan (mode: "plan", read-only)  ->  implement (mode: "agent")  ->  verify (structured report)
 *
 * The loop lives in `src/lib/pipeline.ts` so the Slack bot (and tests) can drive
 * the same sequence. This file is the CLI: create an agent, stream the
 * transcript, exit with a CI-friendly code.
 *
 *   npm run pipeline -- --brief example-health-endpoint
 *   npm run pipeline -- --brief ./my-brief.md --repo https://github.com/you/repo --plan-only
 *   npm run pipeline -- --engine hybrid --brief ./my-brief.md --repo https://github.com/you/repo
 *
 * `--engine claude|hybrid|local` (or ENGINE in .env) runs the same three sends
 * on a local clone instead of a Cursor VM: claude = Max for every phase; hybrid =
 * Max plans, LOCAL_MODEL implements and verifies, Max rescues a failed verify;
 * local = Ollama only.
 */
import { Agent } from "@cursor/sdk";
import { loadEnv, env, flags } from "./lib/env.js";
import { selectModel } from "./lib/model.js";
import { resolveApiKey } from "./lib/auth.js";
import { loadBrief } from "./lib/prompts.js";
import { reportResult, reportStartupFailure, saveRunRecord } from "./lib/report.js";
import { formatVerifyReport, runPipeline, type PipelineSend } from "./lib/pipeline.js";
import { printStream } from "./lib/stream.js";
import { isLocalWorkspaceEngine, parseEngine } from "./lib/engine-claude.js";
import { createEngineHandle } from "./lib/engine-local.js";

loadEnv();
const args = flags();

const briefName = args.brief ?? "example-health-endpoint";
const repo = args.repo ?? env("TARGET_REPO");
const ref = args.ref ?? process.env.TARGET_REF ?? "main";
const planOnly = args["plan-only"] === "true";

const brief = loadBrief(briefName);
const engine = parseEngine(args.engine);

function banner(title: string) {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}\n`);
}

try {
  let agentId: string;
  let send: PipelineSend;
  let close: () => Promise<void> = async () => {};
  if (isLocalWorkspaceEngine(engine)) {
    const handle = await createEngineHandle(engine, { repo, ref, autoCreatePR: !planOnly });
    agentId = handle.agentId;
    send = async (prompt, opts) => {
      const turn = await handle.send(prompt, opts);
      if (turn.result) console.log(turn.result);
      return turn;
    };
  } else {
    const agent = await Agent.create({
      apiKey: await resolveApiKey(),
      model: selectModel(),
      mode: "plan",
      cloud: {
        repos: [{ url: repo, startingRef: ref }],
        autoCreatePR: !planOnly,
        skipReviewerRequest: true,
        metadata: { kit: "cloud-agents", brief: briefName, pipeline: "plan-implement-verify" },
      },
    });
    agentId = agent.agentId;
    close = async () => {
      await agent.close();
    };
    send = async (prompt, opts) => {
      const run = await agent.send(prompt, opts?.mode ? { mode: opts.mode } : {});
      console.log(`run: ${run.id}\n`);
      await printStream(run);
      const result = await run.wait();
      return {
        status: result.status,
        result: result.result,
        runId: run.id,
        prUrl: result.git?.branches.find((b) => b.prUrl)?.prUrl,
      };
    };
  }
  console.log(`engine: ${engine}`);
  console.log(`agent: ${agentId}`);
  console.log(`repo:  ${repo}@${ref}`);
  console.log(`brief: ${briefName}`);

  const labels: Record<string, string> = {
    plan: "PHASE 1 - PLAN",
    implement: "PHASE 2 - IMPLEMENT",
    verify: "PHASE 3 - VERIFY",
  };

  const out = await runPipeline(send, brief, {
    ref,
    planOnly,
    onPhase: (phase) => banner(labels[phase] ?? phase),
  });

  if (out.status === "plan-only") {
    saveRunRecord({ agentId, runIds: out.runIds, repo, brief: briefName, status: "plan-only" });
    console.log(`\nPlan-only mode. Resume with:\n  npm run resume -- --agent ${agentId} --message "Looks good, implement it"`);
    await close();
    process.exit(out.last.status === "finished" ? 0 : 2);
  }

  if (out.status === "failed") {
    saveRunRecord({
      agentId,
      runIds: out.runIds,
      repo,
      brief: briefName,
      prUrl: out.prUrl,
      status: out.last.status,
    });
    await close();
    console.error(`\n${out.phase} did not finish (status=${out.last.status})`);
    process.exit(2);
  }

  banner("REPORT");
  if (!out.report) {
    console.log("Verifier did not return a parseable JSON block. Treating as not done.");
  } else {
    console.log(formatVerifyReport(out.report, out.prUrl));
  }

  const file = saveRunRecord({
    agentId,
    runIds: out.runIds,
    repo,
    brief: briefName,
    prUrl: out.prUrl,
    status: out.last.status,
  });
  console.log(`record:  ${file}`);
  await close();
  process.exit(out.done ? 0 : 2);
} catch (err) {
  process.exit(reportStartupFailure(err));
}
