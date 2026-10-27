import { Agent, type Run, type RunResult } from "@cursor/sdk";

type Waitable = Pick<Run, "wait">;
export type GetRunFn = (runId: string, agentId: string) => Promise<Waitable>;

export interface WaitForRunOptions {
  getRun?: GetRunFn;
  retries?: number;
  delayMs?: number;
  log?: (line: string) => void;
}

const cloudGetRun: GetRunFn = (runId, agentId) => Agent.getRun(runId, { runtime: "cloud", agentId });

export function isStreamLoss(r: RunResult): boolean {
  return r.status === "error" && r.error?.code === "stream_unavailable";
}

/**
 * `run.wait()` with re-attach on a lost event stream.
 *
 * When the stream drops, `wait()` resolves `status: "error"` with code `stream_unavailable` while
 * the cloud run keeps going. On 2026-10-06 farm-iso-week's M2 run "failed" this way, but
 * `Agent.getRun` showed it finished and it had opened PR #2; the 2026-09-17 farm wave stopped
 * `run-failed` the same way. So a lost stream is not a failed run: fetch a fresh handle and wait
 * on that, a bounded number of times.
 */
export async function waitForRun(
  run: Pick<Run, "id" | "agentId" | "wait">,
  opts: WaitForRunOptions = {},
): Promise<RunResult> {
  const getRun = opts.getRun ?? cloudGetRun;
  const retries = opts.retries ?? 20;
  const delayMs = opts.delayMs ?? 15_000;
  let result = await run.wait();
  for (let i = 1; i <= retries && isStreamLoss(result); i++) {
    opts.log?.(`run ${run.id}: event stream lost; re-attaching (${i}/${retries})`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      result = await (await getRun(run.id, run.agentId)).wait();
    } catch (err) {
      opts.log?.(`run ${run.id}: re-attach failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
