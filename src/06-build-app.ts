/**
 * Step 6: give it an idea, get an app.
 *
 *   spec  ->  [ iterate: next milestone -> verify -> commit ]*  ->  finish
 *
 * One cloud agent, one conversation, one branch, one PR that grows with every
 * milestone. The loop in src/lib/build-loop.ts decides when to stop:
 *   - the finish gate reports complete            -> exit 0
 *   - a milestone is blocked on a human           -> exit 3, resume after you act
 *   - the same milestone stalls repeatedly        -> intervene once, then exit 4
 *   - iteration budget exhausted                  -> exit 4, resume to continue
 *
 * State is persisted to .runs/build-<agentId>.json after every turn, so a
 * killed process, a laptop lid, or a budget stop can all be resumed:
 *
 *   npm run build-app -- --idea-file ideas/example-snippet-vault.md --repo https://github.com/you/snippet-vault
 *   npm run build-app -- --idea "A CLI that ..." --create-repo my-cli
 *   npm run build-app -- --resume bc-xxxx
 */
import { Agent } from "@cursor/sdk";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, env, flags } from "./lib/env.js";
import { resolveApiKey } from "./lib/auth.js";
import { runBuildLoop, type LoopState, type SendFn } from "./lib/build-loop.js";
import { reportStartupFailure } from "./lib/report.js";
import { printStream } from "./lib/stream.js";

loadEnv();
const args = flags();

const maxIterations = Number(args["max-iterations"] ?? 12);
const maxMilestones = Number(args["max-milestones"] ?? 7);
const stateDir = resolve(process.cwd(), ".runs");
mkdirSync(stateDir, { recursive: true });

interface BuildRecord {
  agentId: string;
  repo: string;
  ref: string;
  idea: string;
  state: LoopState;
  updatedAt: string;
}

function stateFile(agentId: string) {
  return resolve(stateDir, `build-${agentId}.json`);
}

function createRepo(name: string): string {
  console.log(`creating private GitHub repo "${name}" with an initial README...`);
  execFileSync("gh", ["repo", "create", name, "--private", "--add-readme"], { stdio: "inherit" });
  const url = execFileSync("gh", ["repo", "view", name, "--json", "url", "-q", ".url"], { encoding: "utf8" }).trim();
  console.log(`created ${url}`);
  console.log("NOTE: the Cursor GitHub app must have access to this repo (cursor.com/agents -> GitHub settings).\n");
  return url;
}

function banner(title: string) {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}\n`);
}

try {
  const apiKey = await resolveApiKey();
  const model = { id: env("CURSOR_MODEL", "composer-2.5") };

  let record: BuildRecord;
  let agent;

  if (args.resume) {
    const file = stateFile(args.resume);
    if (!existsSync(file)) throw new Error(`No saved state at ${file}. Resume needs a build started by this script.`);
    record = JSON.parse(readFileSync(file, "utf8")) as BuildRecord;
    if (record.state.phase === "stopped") record.state.phase = record.state.history.length ? "iterate" : "spec";
    agent = await Agent.resume(record.agentId, { apiKey });
    console.log(`resuming ${record.agentId} at phase=${record.state.phase} iteration=${record.state.iteration}`);
  } else {
    const idea = args.idea ?? (args["idea-file"] ? readFileSync(resolve(process.cwd(), args["idea-file"]), "utf8") : undefined);
    if (!idea?.trim()) {
      console.error('usage: npm run build-app -- (--idea "..." | --idea-file path) (--repo url | --create-repo name) [--max-iterations N]');
      process.exit(1);
    }
    const repo = args.repo ?? (args["create-repo"] ? createRepo(args["create-repo"]) : env("TARGET_REPO"));
    const ref = args.ref ?? process.env.TARGET_REF ?? "main";

    agent = await Agent.create({
      apiKey,
      model,
      cloud: {
        repos: [{ url: repo, startingRef: ref }],
        autoCreatePR: true,
        skipReviewerRequest: true,
        metadata: { kit: "cloud-agents", brief: "build-app", idea: idea.trim().slice(0, 60) },
      },
    });
    record = {
      agentId: agent.agentId,
      repo,
      ref,
      idea: idea.trim(),
      state: { phase: "spec", iteration: 0, runIds: [], history: [] },
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(stateFile(agent.agentId), JSON.stringify(record, null, 2));
    console.log(`agent: ${agent.agentId}`);
    console.log(`repo:  ${repo}@${ref}`);
    console.log(`state: ${stateFile(agent.agentId)}`);
  }

  const a = agent;
  const send: SendFn = async (prompt, opts) => {
    const run = await a.send(prompt, opts?.mode ? { mode: opts.mode } : {});
    console.log(`run: ${run.id}`);
    await printStream(run, { text: true, tools: true });
    const r = await run.wait();
    const pr = r.git?.branches.find((b) => b.prUrl)?.prUrl;
    if (pr) console.log(`PR: ${pr}`);
    return { status: r.status, result: r.result, runId: run.id };
  };

  const final = await runBuildLoop(
    send,
    {
      idea: record.idea,
      repo: record.repo,
      maxIterations,
      maxMilestones,
      stallThreshold: 2,
      maxInterventions: 1,
      log: (line) => banner(line),
      onState: (state) => {
        record.state = state;
        record.updatedAt = new Date().toISOString();
        writeFileSync(stateFile(record.agentId), JSON.stringify(record, null, 2));
      },
    },
    record.state,
  );

  banner(`RESULT: ${final.stopReason}`);
  if (final.spec) console.log(`stack:      ${final.spec.stack}`);
  console.log(`iterations: ${final.iteration}`);
  for (const h of final.history) {
    console.log(`  ${h.completed ? "[x]" : h.blocked ? "[!]" : "[~]"} ${h.milestone_id} ${h.milestone_title}`);
  }
  if (final.finish) {
    console.log(`\n${final.finish.summary}`);
    if (final.finish.how_to_run?.length) console.log(`run it:\n  ${final.finish.how_to_run.join("\n  ")}`);
    if (final.finish.known_gaps?.length) console.log(`known gaps:\n  - ${final.finish.known_gaps.join("\n  - ")}`);
  }
  const blocked = final.history.find((h) => h.blocked);
  if (blocked) console.log(`\nBLOCKED on ${blocked.milestone_id}: ${blocked.blocked_reason}\nAct on it, then: npm run build-app -- --resume ${record.agentId}`);
  if (final.stopReason === "max-iterations" || final.stopReason === "stalled") {
    console.log(`\nContinue with: npm run build-app -- --resume ${record.agentId} --max-iterations ${maxIterations + 6}`);
  }

  await a.close();
  const code =
    final.stopReason === "complete" ? 0 : final.stopReason === "blocked" ? 3 : final.stopReason === "run-failed" ? 2 : 4;
  process.exit(code);
} catch (err) {
  process.exit(reportStartupFailure(err));
}
