import type { ExecFn } from "../../src/lib/engine-local.js";
import { defaultExec } from "../../src/lib/engine-local.js";
import type { BlueprintIO } from "../../architect-crew-gate/src/blueprint-loop.js";
import { makeRepoIO } from "../../architect-crew-gate/src/io.js";
import { gateConfigFromEnv, runQualityGate, type GateConfig } from "../../architect-crew-gate/src/quality-gate.js";
import { ARTIFACTS, contractOf, parseProblem } from "./plan.js";

/**
 * The loop's I/O is architect-crew-gate's repo I/O with one override: the gate
 * receives the quality contract from PROBLEM.md. Without a contract the
 * borrowed gate ignores per-unit commands and runs the whole suite on every
 * unit turn, which is the defect ACG measured on its first six-task build.
 */

export type PolyaIO = BlueprintIO;

export function makePolyaIO(
  cwd: string,
  opts: { gateCfg?: GateConfig; exec?: ExecFn; log?: (l: string) => void; workRoot?: string } = {},
): PolyaIO {
  const base = makeRepoIO(cwd, opts);
  const gateCfg = opts.gateCfg ?? gateConfigFromEnv();
  const exec = opts.exec ?? defaultExec;
  let warned = false;
  return {
    ...base,
    gate: (kind, ctx) => {
      const md = base.readFile(ARTIFACTS.problem);
      const contract = contractOf(md ? parseProblem(md) : undefined);
      if (!contract && !warned) {
        opts.log?.("gate: PROBLEM.md has no quality bar; the gate falls back to package.json scripts and runs the whole suite");
        warned = true;
      }
      return runQualityGate(cwd, gateCfg, kind === "finish" ? "finish" : "iterate", {
        allowedFiles: ctx.allowedFiles,
        baseSha: ctx.baseSha,
        taskCommands: ctx.taskCommands,
        // `null` stops the gate from picking up a stale QUALITY.md left by an ACG run in the same repo.
        quality: contract ?? null,
        exec,
        log: opts.log,
      });
    },
  };
}
