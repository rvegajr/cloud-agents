import { extractJsonBlock, saveRunRecord } from "./report.js";
import { loadJamEvidence } from "./jam.js";
import { loadBriefTemplate, loadTemplate, render } from "./prompts.js";
import {
  formatVerifyReport,
  runPipeline,
  type PipelineSend,
  type VerifyReport,
} from "./pipeline.js";
import { buildStateDir } from "./build-app.js";
import { centsForMeter, closeJobCost, formatRunningCost, meterFromAgentId, meterLabel, projectFromRepo, usdFromCents } from "./cost-ledger.js";

/**
 * Turn a Slack request into a cloud-agent job. Slack-agnostic aside from the
 * `post` callback: the bot (or a test) supplies create/resume/send and a way
 * to write back to the thread.
 */

export interface UsageSnapshot {
  totalTokens: number;
  chargedCents?: number;
  rawCostCents?: number;
}

export interface AgentHandle {
  agentId: string;
  send: PipelineSend;
  getUsage?: () => Promise<UsageSnapshot>;
}

export interface JobRuntime {
  create: (args: { repo: string; ref: string; autoCreatePR?: boolean; model?: string }) => Promise<AgentHandle>;
  resume: (agentId: string) => Promise<AgentHandle>;
  post: (text: string) => Promise<void>;
  /**
   * Flip the agent's draft PR to ready. Called only when the verifier reports
   * done and a PR exists. Absent = leave drafts alone (no GITHUB_TOKEN).
   */
  markPrReady?: (prUrl: string) => Promise<"marked" | "already-ready">;
}

export interface TriageReport {
  ready: boolean;
  title?: string;
  questions?: string[];
  brief?: string;
}

type FollowupJson = Partial<TriageReport> & Partial<VerifyReport>;

export type JobOutcome =
  | { kind: "need-info"; agentId: string; questions: string[]; title?: string; usageLine?: string }
  | { kind: "done"; agentId: string; report?: VerifyReport; prUrl?: string; usageLine?: string }
  | { kind: "failed"; agentId?: string; error: string; prUrl?: string; usageLine?: string };

export function formatUsage(u?: UsageSnapshot): string {
  if (!u) return "";
  const cost =
    u.chargedCents != null
      ? `  cost: $${(u.chargedCents / 100).toFixed(2)}`
      : u.rawCostCents != null
        ? `  list: $${(u.rawCostCents / 100).toFixed(2)}`
        : "";
  return `tokens: ${u.totalTokens}${cost}`;
}

export function formatQuestions(questions: string[]): string {
  const body = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  return `Need a bit more to write a brief:\n${body}\n\nReply in this thread and mention me.`;
}

async function postCostClose(runtime: JobRuntime, handle: AgentHandle, repo?: string): Promise<string> {
  const meter = meterFromAgentId(handle.agentId);
  let cents: number | undefined;
  let tokens: number | undefined;
  if (handle.getUsage) {
    try {
      const u = await handle.getUsage();
      cents = centsForMeter(meter, u);
      tokens = u.totalTokens;
    } catch {
      /* still close */
    }
  }
  let close: string;
  try {
    close = closeJobCost({
      stateDir: buildStateDir(),
      project: projectFromRepo(repo),
      cents,
      meter,
      source: "slack",
      agentId: handle.agentId,
      repo,
    }).close;
  } catch {
    close =
      cents == null
        ? `COST\n  this run:     unknown  ${meterLabel(meter)}`
        : `COST\n  this run:     ${usdFromCents(cents)}  ${meterLabel(meter)}`;
  }
  if (tokens) close += `\n  tokens:      ${tokens.toLocaleString()}`;
  await runtime.post(close);
  return close;
}

function parseTriage(text: string | undefined): TriageReport | undefined {
  const json = extractJsonBlock<TriageReport>(text);
  if (!json || typeof json.ready !== "boolean") return undefined;
  return json;
}

function isVerifyReport(value: unknown): value is VerifyReport {
  if (!value || typeof value !== "object") return false;
  return typeof (value as VerifyReport).done === "boolean";
}

async function record(handle: AgentHandle, extra: { repo?: string; brief?: string; prUrl?: string; status: string; runIds?: string[] }) {
  try {
    saveRunRecord({
      agentId: handle.agentId,
      runIds: extra.runIds ?? [],
      repo: extra.repo,
      brief: extra.brief,
      prUrl: extra.prUrl,
      status: extra.status,
    });
  } catch {
    /* .runs is nice-to-have; a read-only filesystem (or tests) should not fail the job */
  }
}

export async function startJob(
  input: { repo: string; ref: string; request: string; threadContext: string },
  runtime: JobRuntime,
): Promise<JobOutcome> {
  const handle = await runtime.create({ repo: input.repo, ref: input.ref });
  await runtime.post(`agent: ${handle.agentId}\nTriaging against ${input.repo}@${input.ref}`);

  const jamPlaybook = loadTemplate("slack/jam");
  const jamEvidence = await loadJamEvidence(`${input.request}\n${input.threadContext}`);
  const triagePrompt = render(loadTemplate("slack/triage"), {
    request: input.request.trim() || "(empty request)",
    thread_context: input.threadContext.trim() || "(no prior thread — this is the first message)",
    brief_template: loadBriefTemplate(),
    jam_playbook: jamPlaybook,
    jam_evidence: jamEvidence,
  });

  let triageTurn = await handle.send(triagePrompt, { mode: "plan" });
  if (triageTurn.status !== "finished") {
    const error = `Triage did not finish (status=${triageTurn.status})`;
    await runtime.post(error);
    const line = await postCostClose(runtime, handle, input.repo);
    await record(handle, { repo: input.repo, brief: input.request, status: triageTurn.status });
    return { kind: "failed", agentId: handle.agentId, error, usageLine: line };
  }

  let triage = parseTriage(triageTurn.result);
  // Plan mode often spends the turn on create_plan and leaves no JSON in the
  // final message. One agent-mode nudge is cheaper than failing the job.
  if (!triage) {
    await runtime.post("Triage plan had no JSON block; asking for the brief...");
    triageTurn = await handle.send(
      "Your previous turn did not include the required fenced json block. Do not call create_plan. Do not edit files. Reply with a short paragraph and exactly one ```json block with keys ready, title, questions, brief.",
      { mode: "agent" },
    );
    if (triageTurn.status !== "finished") {
      const error = `Triage JSON retry did not finish (status=${triageTurn.status})`;
      await runtime.post(error);
      const line = await postCostClose(runtime, handle, input.repo);
      await record(handle, { repo: input.repo, brief: input.request, status: triageTurn.status });
      return { kind: "failed", agentId: handle.agentId, error, usageLine: line };
    }
    triage = parseTriage(triageTurn.result);
  }
  if (!triage) {
    const error = "Triage did not return a parseable JSON block.";
    await runtime.post(error);
    const line = await postCostClose(runtime, handle, input.repo);
    await record(handle, { repo: input.repo, brief: input.request, status: "unparseable-triage" });
    return { kind: "failed", agentId: handle.agentId, error, usageLine: line };
  }

  if (!triage.ready) {
    const questions = (triage.questions ?? []).filter((q) => q.trim());
    const asked = questions.length ? questions : ["What should change, and how would we know it worked?"];
    await runtime.post(formatQuestions(asked));
    const line = await postCostClose(runtime, handle, input.repo);
    await record(handle, { repo: input.repo, brief: input.request, status: "need-info" });
    return { kind: "need-info", agentId: handle.agentId, questions: asked, title: triage.title, usageLine: line };
  }

  const brief = triage.brief?.trim();
  if (!brief) {
    const error = "Triage said ready but did not include a brief.";
    await runtime.post(error);
    const line = await postCostClose(runtime, handle, input.repo);
    return { kind: "failed", agentId: handle.agentId, error, usageLine: line };
  }

  return runAndReport(handle, brief, input.repo, input.ref, runtime);
}

export async function continueJob(
  input: { agentId: string; message: string; repo?: string; ref: string },
  runtime: JobRuntime,
): Promise<JobOutcome> {
  const handle = await runtime.resume(input.agentId);
  await runtime.post(`Continuing agent: ${handle.agentId}`);

  const prompt = render(loadTemplate("slack/followup"), {
    message: input.message.trim() || "(empty reply)",
    jam_playbook: loadTemplate("slack/jam"),
    jam_evidence: await loadJamEvidence(input.message),
  });
  const turn = await handle.send(prompt, { mode: "agent" });
  if (turn.status !== "finished") {
    const error = `Follow-up did not finish (status=${turn.status})`;
    await runtime.post(error);
    if (turn.prUrl) await runtime.post(`PR: ${turn.prUrl}`);
    const line = await postCostClose(runtime, handle, input.repo);
    await record(handle, { repo: input.repo, status: turn.status, prUrl: turn.prUrl });
    return { kind: "failed", agentId: handle.agentId, error, prUrl: turn.prUrl, usageLine: line };
  }

  const json = extractJsonBlock<FollowupJson>(turn.result);
  if (isVerifyReport(json)) {
    const prUrl = turn.prUrl;
    await runtime.post(formatVerifyReport(json, prUrl));
    const line = await postCostClose(runtime, handle, input.repo);
    await record(handle, {
      repo: input.repo,
      brief: input.message,
      prUrl,
      status: json.done ? "done" : "not-done",
      runIds: turn.runId ? [turn.runId] : [],
    });
    return { kind: "done", agentId: handle.agentId, report: json, prUrl, usageLine: line };
  }

  if (json && json.ready === false) {
    const questions = (json.questions ?? []).filter((q) => q.trim());
    const asked = questions.length ? questions : ["What should change, and how would we know it worked?"];
    await runtime.post(formatQuestions(asked));
    const line = await postCostClose(runtime, handle, input.repo);
    await record(handle, { repo: input.repo, status: "need-info" });
    return { kind: "need-info", agentId: handle.agentId, questions: asked, title: json.title, usageLine: line };
  }

  if (json?.ready === true && json.brief?.trim()) {
    return runAndReport(handle, json.brief, input.repo ?? "", input.ref, runtime);
  }

  const error = "Follow-up did not return a parseable JSON report.";
  await runtime.post(error);
  if (turn.prUrl) await runtime.post(`PR: ${turn.prUrl}`);
  const line = await postCostClose(runtime, handle, input.repo);
  await record(handle, { repo: input.repo, status: "unparseable-followup", prUrl: turn.prUrl });
  return { kind: "failed", agentId: handle.agentId, error, prUrl: turn.prUrl, usageLine: line };
}

async function runAndReport(
  handle: AgentHandle,
  brief: string,
  repo: string,
  ref: string,
  runtime: JobRuntime,
): Promise<JobOutcome> {
  const labels: Record<string, string> = {
    plan: "Planning (read-only)...",
    implement: "Implementing...",
    verify: "Verifying...",
  };
  const out = await runPipeline(handle.send, brief, {
    ref,
    onPhase: async (phase) => {
      const meter = meterFromAgentId(handle.agentId);
      let line = labels[phase] ?? phase;
      if (handle.getUsage) {
        try {
          const running = formatRunningCost(centsForMeter(meter, await handle.getUsage()), meter);
          if (running) line = `${line}\n${running}`;
        } catch {
          /* still post the phase */
        }
      }
      await runtime.post(line);
    },
  });

  if (out.status === "failed") {
    await runtime.post(`${out.phase} did not finish (status=${out.last.status}).`);
    if (out.prUrl) await runtime.post(`PR: ${out.prUrl}`);
    await record(handle, { repo, brief, prUrl: out.prUrl, status: out.last.status, runIds: out.runIds });
    const line = await postCostClose(runtime, handle, repo);
    return { kind: "failed", agentId: handle.agentId, error: `${out.phase} did not finish`, prUrl: out.prUrl, usageLine: line };
  }

  if (out.status === "plan-only") {
    await record(handle, { repo, brief, status: "plan-only", runIds: out.runIds });
    const line = await postCostClose(runtime, handle, repo);
    return { kind: "failed", agentId: handle.agentId, error: "Pipeline stopped after plan.", usageLine: line };
  }

  if (out.report) await runtime.post(formatVerifyReport(out.report, out.prUrl));
  else await runtime.post(out.prUrl ? `PR: ${out.prUrl}\nVerifier did not return a parseable JSON block.` : "Verifier did not return a parseable JSON block.");
  if (out.done && out.prUrl && runtime.markPrReady) {
    try {
      const marked = await runtime.markPrReady(out.prUrl);
      if (marked === "marked") await runtime.post("PR marked ready for review (verifier passed); the repo's auto-merge takes it from here.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await runtime.post(`PR left as draft: could not mark ready (${msg}). A human needs to click "Ready for review".`);
    }
  } else if (out.prUrl && !out.done) {
    await runtime.post("PR left as draft: the verifier did not report done, so it is not auto-merge eligible.");
  }
  await record(handle, {
    repo,
    brief,
    prUrl: out.prUrl,
    status: out.done ? "done" : "not-done",
    runIds: out.runIds,
  });
  const line = await postCostClose(runtime, handle, repo);
  return { kind: "done", agentId: handle.agentId, report: out.report, prUrl: out.prUrl, usageLine: line };
}
