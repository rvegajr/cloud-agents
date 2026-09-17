/**
 * Step 6: give it an idea, get an app.
 *
 *   spec  ->  [ iterate: next milestone -> verify -> commit ]*  ->  finish
 *
 * One conversation, one branch, one PR that grows with every milestone.
 * `--engine cursor` (default) uses a Cursor Cloud Agent. `--engine claude`
 * clones locally and runs the Anthropic Agent SDK against Max.
 *
 *   npm run build-app -- --idea-file ideas/example-snippet-vault.md --repo https://github.com/you/snippet-vault
 *   npm run build-app -- --engine claude --idea-file ideas/example-snippet-vault.md --repo https://github.com/you/snippet-vault
 *   npm run build-app -- --resume bc-xxxx
 *   npm run build-app -- --resume cc-xxxx
 */
import { Agent } from "@cursor/sdk";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, env, flags } from "./lib/env.js";
import { selectModel } from "./lib/model.js";
import { resolveApiKey } from "./lib/auth.js";
import { runBuildLoop, type LoopState, type SendFn } from "./lib/build-loop.js";
import { createClaudeHandle, isClaudeAgentId, MaxExhausted, parseEngine } from "./lib/engine-claude.js";
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
  engine?: "cursor" | "claude";
  workspace?: string;
  sessionId?: string;
  apiEquivalentUsd?: number;
}

function stateFile(agentId: string) {
  return resolve(stateDir, `build-${agentId}.json`);
}

function save(record: BuildRecord) {
  record.updatedAt = new Date().toISOString();
  writeFileSync(stateFile(record.agentId), JSON.stringify(record, null, 2));
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
  const engine = parseEngine(args.engine);
  let record: BuildRecord;
  let send: SendFn;
  let close: () => Promise<void> = async () => {};

  if (args.resume) {
    const file = stateFile(args.resume);
    if (!existsSync(file)) throw new Error(`No saved state at ${file}. Resume needs a build started by this script.`);
    record = JSON.parse(readFileSync(file, "utf8")) as BuildRecord;
    if (record.state.phase === "stopped") record.state.phase = record.state.history.length ? "iterate" : "spec";
    const resumeEngine = record.engine ?? (isClaudeAgentId(record.agentId) ? "claude" : "cursor");
    console.log(`resuming ${record.agentId} engine=${resumeEngine} phase=${record.state.phase} iteration=${record.state.iteration}`);
    if (resumeEngine === "claude") {
      const handle = await createClaudeHandle({
        repo: record.repo,
        ref: record.ref,
        agentId: record.agentId,
        autoCreatePR: true,
      });
      send = handle.send;
    } else {
      const apiKey = await resolveApiKey();
      const agent = await Agent.resume(record.agentId, { apiKey });
      close = async () => {
        await agent.close();
      };
      send = async (prompt, opts) => {
        const run = await agent.send(prompt, opts?.mode ? { mode: opts.mode } : {});
        console.log(`run: ${run.id}`);
        await printStream(run, { text: true, tools: true });
        const r = await run.wait();
        const pr = r.git?.branches.find((b) => b.prUrl)?.prUrl;
        if (pr) console.log(`PR: ${pr}`);
        return { status: r.status, result: r.result, runId: run.id };
      };
    }
  } else {
    const idea = args.idea ?? (args["idea-file"] ? readFileSync(resolve(process.cwd(), args["idea-file"]), "utf8") : undefined);
    if (!idea?.trim()) {
      console.error(
        'usage: npm run build-app -- [--engine cursor|claude] (--idea "..." | --idea-file path) (--repo url | --create-repo name) [--max-iterations N]',
      );
      process.exit(1);
    }
    const repo = args.repo ?? (args["create-repo"] ? createRepo(args["create-repo"]) : env("TARGET_REPO"));
    const ref = args.ref ?? process.env.TARGET_REF ?? "main";

    if (engine === "claude") {
      const handle = await createClaudeHandle({ repo, ref, autoCreatePR: true });
      record = {
        agentId: handle.agentId,
        repo,
        ref,
        idea: idea.trim(),
        engine: "claude",
        state: { phase: "spec", iteration: 0, runIds: [], history: [] },
        updatedAt: new Date().toISOString(),
      };
      save(record);
      send = handle.send;
    } else {
      const apiKey = await resolveApiKey();
      const agent = await Agent.create({
        apiKey,
        model: selectModel(),
        cloud: {
          repos: [{ url: repo, startingRef: ref }],
          autoCreatePR: true,
          skipReviewerRequest: true,
          metadata: { kit: "cloud-agents", brief: "build-app", idea: idea.trim().slice(0, 60) },
        },
      });
      close = async () => {
        await agent.close();
      };
      record = {
        agentId: agent.agentId,
        repo,
        ref,
        idea: idea.trim(),
        engine: "cursor",
        state: { phase: "spec", iteration: 0, runIds: [], history: [] },
        updatedAt: new Date().toISOString(),
      };
      save(record);
      send = async (prompt, opts) => {
        const run = await agent.send(prompt, opts?.mode ? { mode: opts.mode } : {});
        console.log(`run: ${run.id}`);
        await printStream(run, { text: true, tools: true });
        const r = await run.wait();
        const pr = r.git?.branches.find((b) => b.prUrl)?.prUrl;
        if (pr) console.log(`PR: ${pr}`);
        return { status: r.status, result: r.result, runId: run.id };
      };
    }
    console.log(`agent:  ${record.agentId}`);
    console.log(`engine: ${record.engine ?? engine}`);
    console.log(`repo:   ${repo}@${ref}`);
    console.log(`state:  ${stateFile(record.agentId)}`);
  }

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
        save(record);
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

  await close();
  const code =
    final.stopReason === "complete" ? 0 : final.stopReason === "blocked" ? 3 : final.stopReason === "run-failed" ? 2 : 4;
  process.exit(code);
} catch (err) {
  if (err instanceof MaxExhausted) {
    console.error(err.message);
    if (err.resetsAt) console.error(`resets at ${new Date(err.resetsAt * 1000).toISOString()}`);
    console.error("Resume on Cursor: npm run build-app -- --engine cursor --idea-file <same idea>");
    process.exit(4);
  }
  process.exit(reportStartupFailure(err));
}
