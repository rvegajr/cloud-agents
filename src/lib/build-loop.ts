import { buildPrompt } from "./prompts.js";
import { extractJsonBlock } from "./report.js";

/**
 * The idea -> app loop, independent of the SDK so it can be unit-tested with a
 * fake agent. The driver script supplies `send`, which runs one turn on the
 * agent and returns the final text and status.
 */

export interface TurnResult {
  status: "finished" | "error" | "cancelled";
  result?: string;
  runId?: string;
}

export type SendFn = (prompt: string, opts?: { mode?: "agent" | "plan" }) => Promise<TurnResult>;

export interface SpecReport {
  stack: string;
  milestones: { id: string; title: string }[];
  open_questions_decided?: string[];
}

export interface IterationReport {
  milestone_id: string;
  milestone_title: string;
  completed: boolean;
  remaining: number;
  blocked: boolean;
  blocked_reason: string | null;
  verification?: { command: string; passed: boolean }[];
  commits?: string[];
}

export interface FinishReport {
  complete: boolean;
  summary: string;
  user_flows?: { flow: string; verified: boolean; evidence: string }[];
  quality_bar?: { command: string; passed: boolean }[];
  how_to_run?: string[];
  known_gaps?: string[];
}

export interface LoopState {
  phase: "spec" | "iterate" | "finish" | "done" | "stopped";
  iteration: number;
  runIds: string[];
  spec?: SpecReport;
  history: IterationReport[];
  finish?: FinishReport;
  stopReason?: string;
}

export interface LoopOptions {
  idea: string;
  repo: string;
  maxIterations: number;
  maxMilestones: number;
  /** Consecutive turns reporting the same incomplete milestone before intervening. */
  stallThreshold: number;
  /** Total stall interventions allowed before giving up. */
  maxInterventions: number;
  /** Called after every turn so the driver can persist state. */
  onState?: (state: LoopState) => void | Promise<void>;
  log?: (line: string) => void;
}

export type StopReason =
  | "complete"
  | "finish-reported-incomplete"
  | "blocked"
  | "max-iterations"
  | "stalled"
  | "unparseable-report"
  | "run-failed";

export async function runBuildLoop(
  send: SendFn,
  opts: LoopOptions,
  initial?: Partial<LoopState>,
): Promise<LoopState & { stopReason: StopReason }> {
  const log = opts.log ?? (() => {});
  const state: LoopState = {
    phase: "spec",
    iteration: 0,
    runIds: [],
    history: [],
    ...initial,
  };
  const persist = async () => opts.onState?.(state);
  const stop = async (reason: StopReason, phase: LoopState["phase"] = "stopped") => {
    state.phase = phase;
    state.stopReason = reason;
    await persist();
    return { ...state, stopReason: reason };
  };
  const track = (t: TurnResult) => {
    if (t.runId) state.runIds.push(t.runId);
  };

  // ---- Phase: spec ---------------------------------------------------------
  if (state.phase === "spec") {
    log("phase: spec");
    const t = await send(
      buildPrompt("app/spec", "", {
        idea: opts.idea,
        repo: opts.repo,
        max_milestones: String(opts.maxMilestones),
      }),
      { mode: "agent" },
    );
    track(t);
    if (t.status !== "finished") return stop("run-failed");
    const spec = extractJsonBlock<SpecReport>(t.result);
    if (!spec?.milestones?.length) return stop("unparseable-report");
    state.spec = spec;
    state.phase = "iterate";
    log(`spec: ${spec.milestones.length} milestones on ${spec.stack}`);
    await persist();
  }

  // ---- Phase: iterate ------------------------------------------------------
  let unparseable = 0;
  let interventions = 0;
  while (state.phase === "iterate") {
    if (state.iteration >= opts.maxIterations) return stop("max-iterations");
    state.iteration++;
    log(`iteration ${state.iteration}/${opts.maxIterations}`);

    const stalledOn = detectStall(state.history, opts.stallThreshold);
    let prompt: string;
    if (stalledOn) {
      interventions++;
      if (interventions > opts.maxInterventions) return stop("stalled");
      log(`stall on ${stalledOn.id} (${stalledOn.count} turns): intervening`);
      prompt = buildPrompt("app/unblock", "", {
        milestone_id: stalledOn.id,
        stall_count: String(stalledOn.count),
      });
    } else {
      prompt = buildPrompt("app/iterate", "", {
        idea: opts.idea,
        iteration: String(state.iteration),
        max_iterations: String(opts.maxIterations),
      });
    }

    const t = await send(prompt);
    track(t);
    if (t.status !== "finished") return stop("run-failed");

    const report = extractJsonBlock<IterationReport>(t.result);
    if (!report || typeof report.remaining !== "number") {
      unparseable++;
      log("no parseable report");
      if (unparseable >= 2) return stop("unparseable-report");
      await persist();
      continue;
    }
    unparseable = 0;
    state.history.push(report);
    log(
      `${report.milestone_id} ${report.completed ? "done" : report.blocked ? "BLOCKED" : "in progress"}; remaining=${report.remaining}`,
    );
    await persist();

    if (report.blocked) return stop("blocked");
    if (report.remaining === 0) state.phase = "finish";
  }

  // ---- Phase: finish -------------------------------------------------------
  if (state.phase === "finish") {
    log("phase: finish");
    const t = await send(buildPrompt("app/finish", "", { idea: opts.idea }));
    track(t);
    if (t.status !== "finished") return stop("run-failed");
    const finish = extractJsonBlock<FinishReport>(t.result);
    if (!finish) return stop("unparseable-report");
    state.finish = finish;
    return finish.complete ? stop("complete", "done") : stop("finish-reported-incomplete");
  }

  return stop((state.stopReason as StopReason) ?? "stalled", state.phase);
}

/**
 * A stall is the same milestone reported incomplete (and not blocked) for
 * `threshold` consecutive turns.
 */
export function detectStall(history: IterationReport[], threshold: number): { id: string; count: number } | undefined {
  if (history.length < threshold) return undefined;
  const last = history.at(-1)!;
  if (last.completed || last.blocked) return undefined;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (h.milestone_id === last.milestone_id && !h.completed) count++;
    else break;
  }
  return count >= threshold ? { id: last.milestone_id, count } : undefined;
}
