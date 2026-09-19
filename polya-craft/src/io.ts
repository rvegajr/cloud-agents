import { execFileSync, spawn } from "node:child_process";
import type { ExecFn } from "../../src/lib/engine-local.js";
import { defaultExec } from "../../src/lib/engine-local.js";
import { makeRepoIO } from "../../architect-crew-gate/src/io.js";
import { gateConfigFromEnv, runQualityGate, subprocessEnv, type GateConfig } from "../../architect-crew-gate/src/quality-gate.js";
import { ARTIFACTS, contractOf, parseProblem } from "./plan.js";
import type { PolyaIO } from "./polya-loop.js";

/**
 * The loop's I/O is architect-crew-gate's repo I/O with one override: the gate
 * receives the quality contract from PROBLEM.md. Without a contract the
 * borrowed gate ignores per-unit commands and runs the whole suite on every
 * unit turn, which is the defect ACG measured on its first six-task build.
 */

export type { PolyaIO };

export function makePolyaIO(
  cwd: string,
  opts: { gateCfg?: GateConfig; exec?: ExecFn; log?: (l: string) => void; workRoot?: string; startWaitMs?: number } = {},
): PolyaIO {
  const base = makeRepoIO(cwd, opts);
  const gateCfg = opts.gateCfg ?? gateConfigFromEnv();
  const exec = opts.exec ?? defaultExec;
  const git = (args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: subprocessEnv() as NodeJS.ProcessEnv }).trim();
  let warned = false;
  return {
    ...base,
    revertOutside: (baseSha, allowed) => {
      const changed = git(["diff", "--name-status", `${baseSha}..HEAD`])
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [status, ...rest] = line.split("\t");
          return { status: status ?? "M", path: rest.at(-1) ?? "" };
        })
        .filter((c) => c.path && !allowed.includes(c.path));
      for (const c of changed) {
        if (c.status.startsWith("A")) execFileSync("git", ["rm", "-q", "-f", "--", c.path], { cwd, stdio: "ignore" });
        else execFileSync("git", ["checkout", baseSha, "--", c.path], { cwd, stdio: "ignore" });
      }
      const paths = changed.map((c) => c.path);
      if (paths.length) base.commit(`orchestrator: reverted files outside Touches (${paths.join(", ")})`);
      return paths;
    },
    start: async (command, dir) => {
      // Its own process group, so stop() takes the whole tree (npm start -> node) with it.
      const child = spawn("sh", ["-c", command], { cwd: dir, env: subprocessEnv() as NodeJS.ProcessEnv, detached: true, stdio: "ignore" });
      child.unref();
      await new Promise((r) => setTimeout(r, opts.startWaitMs ?? 2000));
      return {
        stop: () => {
          try {
            if (child.pid) process.kill(-child.pid, "SIGTERM");
          } catch {
            /* already gone */
          }
        },
      };
    },
    gate: (kind, ctx) => {
      const md = base.readFile(ARTIFACTS.problem);
      const contract = contractOf(md ? parseProblem(md) : undefined);
      if (!contract && !warned) {
        opts.log?.("gate: PROBLEM.md has no quality bar; the gate falls back to package.json scripts and runs the whole suite");
        warned = true;
      }
      // A unit turn runs the unit's Check and the Checks of the units already passed, nothing else from the
      // bar: lint, typecheck and build are look back (a). (A scaffold unit can never pass `tsc` on an empty src.)
      const unitContract = contract && kind === "task" && ctx.taskCommands?.length ? { ...contract, bar: Object.fromEntries(Object.entries(contract.bar).filter(([k]) => k === "install")) } : contract;
      return runQualityGate(cwd, gateCfg, kind === "finish" ? "finish" : "iterate", {
        allowedFiles: ctx.allowedFiles,
        baseSha: ctx.baseSha,
        taskCommands: ctx.taskCommands,
        // `null` stops the gate from picking up a stale QUALITY.md left by an ACG run in the same repo.
        quality: unitContract ?? null,
        exec,
        log: opts.log,
      });
    },
  };
}
