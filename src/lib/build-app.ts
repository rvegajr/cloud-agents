import { Agent, type SDKAgent } from "@cursor/sdk";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "./env.js";
import { selectModel } from "./model.js";
import { resolveApiKey } from "./auth.js";
import { runBuildLoop, type LoopState, type SendFn, type StopReason } from "./build-loop.js";
import {
  isClaudeAgentId,
  isLocalWorkspaceEngine,
  parseEngine,
  type EngineName,
} from "./engine-claude.js";
import { createEngineHandle, engineOfRecord } from "./engine-local.js";
import {
  cursorAppGrantBlocksCreate,
  formatCursorAppGrant,
  grantCursorGithubApp,
  resolveGithubToken,
  type CursorAppGrant,
} from "./github.js";
import { printStream, type StreamOptions } from "./stream.js";
import { centsForMeter, closeJobCost, meterForEngine, projectFromRepo, type CostMeter } from "./cost-ledger.js";

export interface BuildRecord {
  agentId: string;
  repo: string;
  ref: string;
  idea: string;
  state: LoopState;
  updatedAt: string;
  engine?: EngineName;
  workspace?: string;
  sessionId?: string;
  apiEquivalentUsd?: number;
  prUrl?: string;
}

export interface RunBuildAppOpts {
  idea?: string;
  ideaFile?: string;
  repo?: string;
  createRepo?: string;
  ref?: string;
  engine?: string;
  resume?: string;
  maxIterations?: number;
  maxMilestones?: number;
  apiKey?: string;
  stateDir?: string;
  log?: (line: string) => void;
  stream?: StreamOptions;
  /** Farm fails the job if the Cursor GitHub App cannot see a newly created repo. */
  cursorApp?: "warn" | "require";
  grantCursorApp?: (repoUrl: string) => Promise<CursorAppGrant>;
  createRepoFn?: (name: string) => string;
  costSource?: "build-app" | "farm" | "pipeline";
}

export interface BuildAppResult {
  agentId?: string;
  repo?: string;
  ref?: string;
  engine: EngineName;
  prUrl?: string;
  stopReason: StopReason | "startup-failed";
  state?: LoopState;
  chargedCents?: number;
  costClose?: string;
  error?: string;
  grant?: CursorAppGrant;
}

export function buildStateDir(root = process.cwd()): string {
  const dir = resolve(root, ".runs");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function buildStateFile(agentId: string, stateDir = buildStateDir()): string {
  return resolve(stateDir, `build-${agentId}.json`);
}

export function saveBuildRecord(record: BuildRecord, stateDir = buildStateDir()): void {
  record.updatedAt = new Date().toISOString();
  writeFileSync(buildStateFile(record.agentId, stateDir), `${JSON.stringify(record, null, 2)}\n`);
}

export function loadBuildRecord(agentId: string, stateDir = buildStateDir()): BuildRecord {
  const file = buildStateFile(agentId, stateDir);
  if (!existsSync(file)) throw new Error(`No saved state at ${file}. Resume needs a build started by this script.`);
  return JSON.parse(readFileSync(file, "utf8")) as BuildRecord;
}

export function createGithubRepo(name: string): string {
  console.log(`creating private GitHub repo "${name}" with an initial README...`);
  execFileSync("gh", ["repo", "create", name, "--private", "--add-readme"], { stdio: "inherit" });
  const url = execFileSync("gh", ["repo", "view", name, "--json", "url", "-q", ".url"], { encoding: "utf8" }).trim();
  console.log(`created ${url}`);
  return url;
}

export function exitCodeForStopReason(reason: StopReason | "startup-failed"): number {
  if (reason === "complete") return 0;
  if (reason === "blocked") return 3;
  if (reason === "run-failed" || reason === "startup-failed") return 2;
  return 4;
}

export function banner(title: string, log: (line: string) => void = console.log): void {
  log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}\n`);
}

export function printBuildResult(result: BuildAppResult, log: (line: string) => void = console.log): void {
  banner(`RESULT: ${result.stopReason}`, log);
  if (result.error) log(result.error);
  const state = result.state;
  if (state?.spec) log(`stack:      ${state.spec.stack}`);
  if (state) log(`iterations: ${state.iteration}`);
  for (const h of state?.history ?? []) {
    log(`  ${h.completed ? "[x]" : h.blocked ? "[!]" : "[~]"} ${h.milestone_id} ${h.milestone_title}`);
  }
  if (state?.finish) {
    log(`\n${state.finish.summary}`);
    if (state.finish.how_to_run?.length) log(`run it:\n  ${state.finish.how_to_run.join("\n  ")}`);
    if (state.finish.known_gaps?.length) log(`known gaps:\n  - ${state.finish.known_gaps.join("\n  - ")}`);
  }
  if (result.prUrl) log(`PR: ${result.prUrl}`);
  const blocked = state?.history.find((h) => h.blocked);
  if (blocked && result.agentId) {
    log(
      `\nBLOCKED on ${blocked.milestone_id}: ${blocked.blocked_reason}\nAct on it, then: npm run build-app -- --resume ${result.agentId}`,
    );
  }
  if (
    result.agentId &&
    (result.stopReason === "max-iterations" || result.stopReason === "stalled")
  ) {
    log(`\nContinue with: npm run build-app -- --resume ${result.agentId}`);
  }
  log(`\n${result.costClose ?? "COST\n  this run:     unknown"}`);
}

function cursorSend(agent: SDKAgent, stream: StreamOptions | undefined, log: (line: string) => void): SendFn {
  return async (prompt, opts) => {
    const run = await agent.send(prompt, opts?.mode ? { mode: opts.mode } : {});
    log(`run: ${run.id}`);
    await printStream(run, stream ?? { text: true, tools: true });
    const r = await run.wait();
    if (r.status !== "finished") {
      log(`run ${run.id} ${r.status}${r.error?.message ? `: ${r.error.message}` : ""}${r.error?.code ? ` (${r.error.code})` : ""}`);
    }
    const pr = r.git?.branches.find((b) => b.prUrl)?.prUrl;
    if (pr) log(`PR: ${pr}`);
    return { status: r.status, result: r.result, runId: run.id, prUrl: pr };
  };
}

async function usageCents(agent: SDKAgent, meter: CostMeter): Promise<number | undefined> {
  try {
    const u = await agent.getUsage();
    return centsForMeter(meter, { chargedCents: u.cost?.chargedCents, rawCostCents: u.cost?.rawCostCents });
  } catch {
    return undefined;
  }
}

/**
 * One idea → one loop → one PR. Does not `process.exit`; the CLI and the farm do.
 */
export async function runBuildApp(opts: RunBuildAppOpts): Promise<BuildAppResult> {
  const log = opts.log ?? ((line) => console.log(line));
  const stateDir = opts.stateDir ?? buildStateDir();
  mkdirSync(stateDir, { recursive: true });
  const maxIterations = opts.maxIterations ?? 12;
  const maxMilestones = opts.maxMilestones ?? 7;
  const engine = parseEngine(opts.engine);
  const cursorApp = opts.cursorApp ?? "warn";
  const createRepoFn = opts.createRepoFn ?? createGithubRepo;
  const grantFn =
    opts.grantCursorApp ??
    ((repoUrl: string) =>
      grantCursorGithubApp(repoUrl, {
        token: resolveGithubToken(process.env, (file, args) =>
          execFileSync(file, args, { encoding: "utf8" }),
        ),
      }));

  let record: BuildRecord;
  let send: SendFn;
  let close: () => Promise<void> = async () => {};
  let usage: () => Promise<number | undefined> = async () => undefined;
  let lastPr: string | undefined;

  const wrapSend = (inner: SendFn): SendFn => async (prompt, o) => {
    const turn = await inner(prompt, o);
    if (turn.prUrl) lastPr = turn.prUrl;
    return turn;
  };

  try {
    if (opts.resume) {
      record = loadBuildRecord(opts.resume, stateDir);
      if (record.state.phase === "stopped") record.state.phase = record.state.history.length ? "iterate" : "spec";
      lastPr = record.prUrl;
      const resumeEngine: EngineName = isClaudeAgentId(record.agentId)
        ? engineOfRecord(record.agentId, record.engine ?? "claude")
        : "cursor";
      log(`resuming ${record.agentId} engine=${resumeEngine} phase=${record.state.phase} iteration=${record.state.iteration}`);
      if (isLocalWorkspaceEngine(resumeEngine)) {
        const handle = await createEngineHandle(resumeEngine, {
          repo: record.repo,
          ref: record.ref,
          agentId: record.agentId,
          autoCreatePR: true,
        });
        send = wrapSend(handle.send);
        usage = async () => {
          const u = await handle.getUsage?.();
          return centsForMeter(meterForEngine(resumeEngine), u ?? {});
        };
      } else {
        const apiKey = opts.apiKey ?? (await resolveApiKey());
        const agent = await Agent.resume(record.agentId, { apiKey });
        close = async () => {
          await agent.close();
        };
        send = wrapSend(cursorSend(agent, opts.stream, log));
        usage = () => usageCents(agent, "cursor-charged");
      }
    } else {
      const idea =
        opts.idea ??
        (opts.ideaFile ? readFileSync(resolve(process.cwd(), opts.ideaFile), "utf8") : undefined);
      if (!idea?.trim()) {
        return {
          engine,
          stopReason: "startup-failed",
          error:
            'usage: npm run build-app -- [--engine cursor|claude|hybrid|local] (--idea "..." | --idea-file path) (--repo url | --create-repo name) [--max-iterations N]',
        };
      }
      const created = Boolean(opts.createRepo);
      const repo = opts.repo ?? (opts.createRepo ? createRepoFn(opts.createRepo) : env("TARGET_REPO"));
      const ref = opts.ref ?? (created ? "main" : (process.env.TARGET_REF ?? "main"));

      let grant: CursorAppGrant | undefined;
      if (created) {
        grant = await grantFn(repo);
        log(formatCursorAppGrant(grant));
        const confirmed = grant.status === "inherited" || grant.status === "added" || grant.status === "already";
        if (!confirmed && cursorApp === "require" && cursorAppGrantBlocksCreate(grant)) {
          return {
            engine,
            repo,
            ref,
            grant,
            stopReason: "startup-failed",
            error: formatCursorAppGrant(grant),
          };
        }
        if (!confirmed) {
          log("NOTE: the Cursor GitHub app must have access to this repo (cursor.com/agents -> GitHub settings).\n");
        }
      }

      if (isLocalWorkspaceEngine(engine)) {
        const handle = await createEngineHandle(engine, { repo, ref, autoCreatePR: true });
        record = {
          agentId: handle.agentId,
          repo,
          ref,
          idea: idea.trim(),
          engine,
          state: { phase: "spec", iteration: 0, runIds: [], history: [] },
          updatedAt: new Date().toISOString(),
        };
        saveBuildRecord(record, stateDir);
        send = wrapSend(handle.send);
        usage = async () => {
          const u = await handle.getUsage?.();
          return centsForMeter(meterForEngine(engine), u ?? {});
        };
      } else {
        const apiKey = opts.apiKey ?? (await resolveApiKey());
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
        saveBuildRecord(record, stateDir);
        send = wrapSend(cursorSend(agent, opts.stream, log));
        usage = () => usageCents(agent, "cursor-charged");
      }
      log(`agent:  ${record.agentId}`);
      log(`engine: ${record.engine ?? engine}`);
      log(`repo:   ${repo}@${ref}`);
      log(`state:  ${buildStateFile(record.agentId, stateDir)}`);
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
        log: (line) => banner(line, log),
        onState: (state) => {
          record.state = state;
          if (lastPr) record.prUrl = lastPr;
          saveBuildRecord(record, stateDir);
        },
      },
      record.state,
    );
    const chargedCents = await usage();
    if (lastPr) record.prUrl = lastPr;
    record.state = final;
    saveBuildRecord(record, stateDir);
    await close();
    let costClose: string | undefined;
    try {
      costClose = closeJobCost({
        stateDir,
        project: projectFromRepo(record.repo),
        cents: chargedCents,
        meter: meterForEngine(record.engine ?? engine),
        source: opts.costSource ?? "build-app",
        agentId: record.agentId,
        repo: record.repo,
      }).close;
    } catch {
      /* ledger is optional */
    }
    return {
      agentId: record.agentId,
      repo: record.repo,
      ref: record.ref,
      engine: record.engine ?? engine,
      prUrl: lastPr ?? record.prUrl,
      stopReason: final.stopReason,
      state: final,
      chargedCents,
      costClose,
    };
  } catch (err) {
    try {
      await close();
    } catch {
      /* already failing */
    }
    throw err;
  }
}
