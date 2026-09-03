import { CursorAgentError, type RunResult } from "@cursor/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Exit-code contract for anything that runs unattended:
 *   0 - run finished
 *   1 - the run never started (auth, config, network): fix environment, retry
 *   2 - the run started and failed or was cancelled: inspect transcript / git state
 */
export function reportResult(label: string, result: RunResult): number {
  const s = result.durationMs ? ` in ${(result.durationMs / 1000).toFixed(1)}s` : "";
  console.log(`\n=== ${label}: ${result.status}${s} ===`);
  if (result.usage) {
    console.log(`tokens: ${result.usage.totalTokens} (in ${result.usage.inputTokens} / out ${result.usage.outputTokens})`);
  }
  for (const b of result.git?.branches ?? []) {
    console.log(`repo:   ${b.repoUrl}`);
    if (b.branch) console.log(`branch: ${b.branch}`);
    if (b.prUrl) console.log(`PR:     ${b.prUrl}`);
  }
  if (result.status === "error") {
    console.error(`error:  ${result.error?.message ?? "unknown"}${result.error?.code ? ` (${result.error.code})` : ""}`);
  }
  return result.status === "finished" ? 0 : 2;
}

export function reportStartupFailure(err: unknown): number {
  if (err instanceof CursorAgentError) {
    console.error(`\nStartup failed: ${err.message}`);
    console.error(`retryable=${err.isRetryable}${err.requestId ? ` requestId=${err.requestId}` : ""}`);
    return 1;
  }
  console.error(`\nStartup failed: ${err instanceof Error ? err.message : String(err)}`);
  return 1;
}

/**
 * Persist the IDs you'll need to resume or investigate later. The agent ID is
 * the handle for follow-ups; the run ID is what you look up when a stream hangs.
 */
export function saveRunRecord(record: {
  agentId: string;
  runIds: string[];
  repo?: string;
  brief?: string;
  prUrl?: string;
  status: string;
}): string {
  const dir = resolve(process.cwd(), ".runs");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${record.agentId}.json`);
  writeFileSync(file, JSON.stringify({ ...record, savedAt: new Date().toISOString() }, null, 2));
  return file;
}

/** Pull the last fenced ```json block out of the agent's final message, if it left one. */
export function extractJsonBlock<T = unknown>(text: string | undefined): T | undefined {
  if (!text) return undefined;
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const last = matches.at(-1)?.[1];
  if (!last) return undefined;
  try {
    return JSON.parse(last) as T;
  } catch {
    return undefined;
  }
}
