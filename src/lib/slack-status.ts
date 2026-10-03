/**
 * `@<bot> status`: a plain-English answer to "where is it at?".
 *
 * Built from what the bot already posted in the thread (agent id, phase lines,
 * verify report, COST close), the jobs this process is running right now, and
 * Cursor's own summary of the agent. No model call, so asking costs nothing and
 * never resumes the agent.
 */
import { AGENT_ID_RE } from "./slack-thread.js";

export type JobStage =
  | "triage"
  | "followup"
  | "plan"
  | "implement"
  | "verify"
  | "need-info"
  | "done"
  | "not-done"
  | "failed";

export interface JobProgress {
  agentId?: string;
  stage?: JobStage;
  /** The bot's own words for a stop (failed) or a report-less finish. */
  note?: string;
  prUrl?: string;
  prReady?: boolean;
  autoMerge?: boolean;
  questions?: number;
  /** e.g. `$0.42 Cursor billed`, from the latest `COST running` or COST close. */
  spend?: string;
  /** A COST close was posted after the latest round started. */
  closed: boolean;
  /** Epoch ms of the latest progress post. */
  updatedAt?: number;
}

export interface AgentSnapshot {
  status?: "running" | "finished" | "error";
  summary?: string;
  lastModified?: number;
}

/** Every reply this module writes starts with this, so the parser skips it. */
export const STATUS_PREFIX = "Status:";

const FAILED_RE =
  /^(?:.*did not finish.*|Startup failed:.*|Triage did not return a parseable JSON block\.|Follow-up did not return a parseable JSON report\.|Triage said ready but did not include a brief\.|Pipeline stopped after plan\.)$/;

export function emptyProgress(): JobProgress {
  return { closed: false };
}

/** Fold one bot post into the progress. Unknown text is ignored. */
export function applyPost(progress: JobProgress, text: string | null | undefined, at?: number): JobProgress {
  if (!text || text.startsWith(STATUS_PREFIX)) return progress;
  const p = progress;
  let touched = false;
  const set = (patch: Partial<JobProgress>) => {
    Object.assign(p, patch);
    touched = true;
  };

  const id = text.match(AGENT_ID_RE)?.[1];
  if (id) set({ agentId: id });

  const lines = text.split("\n");
  if (lines[0]?.trim() === "COST") {
    const run = lines.find((l) => /^\s*this run:/.test(l))?.replace(/^\s*this run:\s*/, "");
    set({ closed: true, ...(run && run.trim() !== "unknown" ? { spend: squash(run) } : {}) });
    if (at && touched) p.updatedAt = at;
    return p;
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (/^Triaging against /.test(line) || /^Triage plan had no JSON/.test(line)) {
      set({ stage: "triage", closed: false, note: undefined });
    } else if (/^Continuing agent:/.test(line)) {
      set({ stage: "followup", closed: false, note: undefined });
    } else if (/^Need a bit more to write a brief/.test(line)) {
      set({ stage: "need-info", questions: lines.filter((l) => /^\d+\.\s/.test(l)).length || 1 });
    } else if (/^Planning \(read-only\)/.test(line)) {
      set({ stage: "plan" });
    } else if (/^Implementing\.\.\./.test(line)) {
      set({ stage: "implement" });
    } else if (/^Verifying\.\.\./.test(line)) {
      set({ stage: "verify" });
    } else if (line === "Verifier: done") {
      set({ stage: "done" });
    } else if (line === "Verifier: not done") {
      set({ stage: "not-done" });
    } else if (/^Verifier did not return a parseable JSON block\./.test(line)) {
      set({ stage: "not-done", note: "the checker did not send back a readable report" });
    } else if (/^PR marked ready for review/.test(line)) {
      set({ prReady: true });
    } else if (/^Auto-merge (?:is on|was already on)/.test(line)) {
      set({ autoMerge: true });
    } else if (FAILED_RE.test(line)) {
      set({ stage: "failed", note: line.replace(/\.$/, "") });
    }
    const pr = line.match(/^PR:\s*(\S+)/)?.[1];
    if (pr) set({ prUrl: pr });
    const running = line.match(/^COST running:\s*(.+)$/)?.[1];
    if (running) set({ spend: squash(running) });
  }
  if (at && touched) p.updatedAt = at;
  return p;
}

export function progressFromThread(
  messages: Array<{ text?: string | null; ts?: string } | undefined>,
): JobProgress {
  const p = emptyProgress();
  for (const m of messages) applyPost(p, m?.text, slackTsToMs(m?.ts));
  return p;
}

export function slackTsToMs(ts: string | undefined): number | undefined {
  if (!ts || !/^\d+\.\d+$/.test(ts)) return undefined;
  return Math.round(Number(ts) * 1000);
}

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

const IN_PROGRESS: ReadonlySet<JobStage> = new Set(["triage", "followup", "plan", "implement", "verify"]);

function doingNow(stage: JobStage | undefined): string {
  switch (stage) {
    case "plan":
      return "I'm planning the change. This step only reads the code; nothing is edited yet (step 2 of 4: brief, plan, build, check).";
    case "implement":
      return "I'm making the change now (step 3 of 4: brief, plan, build, check).";
    case "verify":
      return "The change is written. I'm checking it against the brief and running the tests (step 4 of 4).";
    case "followup":
      return "I'm working on your latest reply in this thread.";
    default:
      return "I'm reading the request and writing a brief (step 1 of 4: brief, plan, build, check).";
  }
}

function lastStep(stage: JobStage | undefined): string {
  switch (stage) {
    case "plan":
      return "planning";
    case "implement":
      return "making the change";
    case "verify":
      return "checking the change";
    case "followup":
      return "working on a follow-up";
    default:
      return "writing the brief";
  }
}

/** One thread's job, in a few plain sentences. */
export function formatJobStatus(opts: {
  progress: JobProgress;
  /** This bot process is running the job right now. */
  running: boolean;
  startedAt?: number;
  agent?: AgentSnapshot;
  now?: number;
}): string {
  const now = opts.now ?? Date.now();
  const p = opts.progress;
  const out: string[] = [];
  const stage = p.stage;

  if (!p.agentId && !opts.running) {
    return `${STATUS_PREFIX} there's no job in this thread yet. Mention me with a request and I'll start one.`;
  }

  let next: string;
  if (opts.running && (!stage || IN_PROGRESS.has(stage))) {
    out.push(`${STATUS_PREFIX} ${doingNow(stage)}`);
    const when: string[] = [];
    if (opts.startedAt) when.push(`Started ${ago(opts.startedAt, now)}`);
    if (p.updatedAt) when.push(`last update ${ago(p.updatedAt, now)}`);
    if (when.length) out.push(`${when.join("; ")}.`);
    next = "Nothing for you to do yet. I'll post here when this step finishes.";
  } else if (stage === "need-info") {
    const n = p.questions ?? 1;
    out.push(`${STATUS_PREFIX} I'm waiting on you. I asked ${n === 1 ? "a question" : `${n} questions`} above before I can write a brief.`);
    next = "Reply in this thread and mention me with the answers.";
  } else if (stage === "done") {
    out.push(
      `${STATUS_PREFIX} it's done. The checks passed${p.prReady ? " and the PR is marked ready for review" : ""}.`,
    );
    if (p.prUrl) out.push(`PR: ${p.prUrl}`);
    next = p.autoMerge
      ? "Auto-merge is on, so it merges by itself when the required checks pass. Mention me here if you want changes."
      : "Review and merge the PR. Mention me here if you want changes.";
  } else if (stage === "not-done") {
    out.push(
      `${STATUS_PREFIX} it finished, but ${p.note ?? "not every check passed"}, so the PR stays a draft.`,
    );
    if (p.prUrl) out.push(`PR: ${p.prUrl}`);
    next = "Mention me in this thread with what to fix and I'll pick up the same agent.";
  } else if (stage === "failed") {
    out.push(`${STATUS_PREFIX} it stopped. ${p.note ? `${p.note}.` : "The last step did not finish."}`);
    if (p.prUrl) out.push(`There is a draft PR: ${p.prUrl}`);
    next = "Mention me in this thread with what to change and I'll pick up the same agent.";
  } else {
    out.push(
      `${STATUS_PREFIX} the last thing I posted here was ${lastStep(stage)}, but I'm not running this job right now. The bot may have restarted mid-job.`,
    );
    if (opts.agent?.status) out.push(`Cursor shows the agent as ${opts.agent.status}.`);
    next = "Mention me in this thread with the request again and I'll pick up the same agent.";
  }

  if (!opts.running && p.updatedAt) out.push(`Last update ${ago(p.updatedAt, now)}.`);
  const summary = opts.agent?.summary?.trim();
  if (summary) out.push(`Cursor's summary: "${summary}"`);
  if (p.spend) out.push(`Spent so far: ${p.spend}.`);
  out.push(next);
  if (p.agentId) out.push(`Agent ${p.agentId}`);
  return out.join("\n");
}

export interface LiveJob {
  key: string;
  channel: string;
  request: string;
  repo: string;
  startedAt: number;
  progress: JobProgress;
}

/** Jobs this bot process is running right now. Gone on restart; the thread is the history. */
export class LiveJobs {
  private jobs = new Map<string, LiveJob>();

  start(job: Omit<LiveJob, "progress" | "startedAt"> & { startedAt?: number }): void {
    this.jobs.set(job.key, { ...job, startedAt: job.startedAt ?? Date.now(), progress: emptyProgress() });
  }

  post(key: string, text: string, at = Date.now()): void {
    const job = this.jobs.get(key);
    if (job) applyPost(job.progress, text, at);
  }

  finish(key: string): void {
    this.jobs.delete(key);
  }

  get(key: string): LiveJob | undefined {
    return this.jobs.get(key);
  }

  list(): LiveJob[] {
    return [...this.jobs.values()];
  }
}

function excerpt(text: string, max = 70): string {
  const one = squash(text.replace(/<[^>]+>/g, ""));
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** `@<bot> status` outside a thread: what's running in this channel. */
export function formatChannelStatus(opts: { jobs: LiveJob[]; channel: string; now?: number }): string {
  const now = opts.now ?? Date.now();
  const here = opts.jobs.filter((j) => j.channel === opts.channel);
  const elsewhere = opts.jobs.length - here.length;
  const other = elsewhere ? ` ${elsewhere} job${elsewhere === 1 ? " is" : "s are"} running in other channels.` : "";
  if (!here.length) {
    return `${STATUS_PREFIX} nothing is running in this channel right now.${other}\nAsk me \`status\` inside a job's thread to hear where that job ended up.`;
  }
  const lines = [
    `${STATUS_PREFIX} ${here.length === 1 ? "one job is" : `${here.length} jobs are`} running in this channel.${other}`,
  ];
  for (const j of here.sort((a, b) => a.startedAt - b.startedAt)) {
    const stage = j.progress.stage === "need-info" ? "waiting on answers" : lastStep(j.progress.stage);
    const spend = j.progress.spend ? `, ${j.progress.spend} so far` : "";
    lines.push(`• "${excerpt(j.request)}": ${stage}, started ${ago(j.startedAt, now)}${spend}`);
  }
  lines.push("Ask me `status` inside a job's thread for the details.");
  return lines.join("\n");
}
