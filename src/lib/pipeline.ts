import { buildPrompt } from "./prompts.js";
import { extractJsonBlock } from "./report.js";

/**
 * The plan → implement → verify sequence, independent of the SDK so a Slack
 * bot (or a test) can drive it with any `send` function. The CLI in
 * `src/03-cloud-pipeline.ts` wraps a real cloud agent and prints a transcript.
 */

export interface VerifyReport {
  done: boolean;
  summary: string;
  definition_of_done: { item: string; met: boolean; evidence: string }[];
  verification: { command: string; passed: boolean }[];
  files_changed: string[];
  follow_ups: string[];
}

export interface PipelineTurn {
  status: "finished" | "error" | "cancelled";
  result?: string;
  runId?: string;
  prUrl?: string;
}

export type PipelineSend = (
  prompt: string,
  opts?: { mode?: "agent" | "plan" },
) => Promise<PipelineTurn>;

export type PipelinePhase = "plan" | "implement" | "verify";

export type PipelineResult =
  | { status: "plan-only"; runIds: string[]; last: PipelineTurn }
  | { status: "failed"; phase: PipelinePhase; runIds: string[]; last: PipelineTurn; prUrl?: string }
  | {
      status: "finished";
      runIds: string[];
      last: PipelineTurn;
      report?: VerifyReport;
      prUrl?: string;
      done: boolean;
    };

export async function runPipeline(
  send: PipelineSend,
  brief: string,
  opts: {
    ref: string;
    planOnly?: boolean;
    onPhase?: (phase: PipelinePhase) => void | Promise<void>;
  },
): Promise<PipelineResult> {
  const runIds: string[] = [];
  const track = (turn: PipelineTurn): PipelineTurn => {
    if (turn.runId) runIds.push(turn.runId);
    return turn;
  };

  await opts.onPhase?.("plan");
  const plan = track(await send(buildPrompt("01-plan", brief)));
  if (plan.status !== "finished") return { status: "failed", phase: "plan", runIds, last: plan };

  if (opts.planOnly) return { status: "plan-only", runIds, last: plan };

  await opts.onPhase?.("implement");
  const impl = track(await send(buildPrompt("02-implement", brief), { mode: "agent" }));
  if (impl.status !== "finished") {
    return { status: "failed", phase: "implement", runIds, last: impl, prUrl: impl.prUrl };
  }

  await opts.onPhase?.("verify");
  const verify = track(await send(buildPrompt("03-verify", brief, { base_ref: `origin/${opts.ref}` })));
  const prUrl = verify.prUrl ?? impl.prUrl;
  if (verify.status !== "finished") {
    return { status: "failed", phase: "verify", runIds, last: verify, prUrl };
  }

  const report = extractJsonBlock<VerifyReport>(verify.result);
  return { status: "finished", runIds, last: verify, report, prUrl, done: report?.done === true };
}

export function formatVerifyReport(report: VerifyReport, prUrl?: string): string {
  const lines: string[] = [];
  if (prUrl) lines.push(`PR: ${prUrl}`);
  lines.push(report.done ? "Verifier: done" : "Verifier: not done");
  if (report.summary) lines.push(report.summary);
  for (const d of report.definition_of_done ?? []) {
    lines.push(`  [${d.met ? "x" : " "}] ${d.item}${d.evidence ? `  <- ${d.evidence}` : ""}`);
  }
  for (const v of report.verification ?? []) {
    lines.push(`  ${v.passed ? "PASS" : "FAIL"} ${v.command}`);
  }
  if (report.follow_ups?.length) lines.push(`follow-ups:\n  - ${report.follow_ups.join("\n  - ")}`);
  return lines.join("\n");
}
