import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultExec, type ExecFn } from "../../src/lib/engine-local.js";
import type { BlueprintIO } from "./blueprint-loop.js";
import { gateConfigFromEnv, runQualityGate, subprocessEnv, type GateConfig } from "./quality-gate.js";

/**
 * The real `BlueprintIO` over a git checkout. Everything the loop needs from
 * the world: files, shas, commits, the gate, shell commands, a fresh clone.
 */

const TEST_PATH = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$|Tests\.cs$/;

export function makeRepoIO(
  cwd: string,
  opts: { gateCfg?: GateConfig; exec?: ExecFn; log?: (l: string) => void; workRoot?: string } = {},
): BlueprintIO {
  const exec = opts.exec ?? defaultExec;
  const gateCfg = opts.gateCfg ?? gateConfigFromEnv();
  const git = (args: string[], dir = cwd): string =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", env: subprocessEnv() as NodeJS.ProcessEnv }).trim();

  return {
    readFile: (rel) => {
      const p = join(cwd, rel);
      return existsSync(p) ? readFileSync(p, "utf8") : undefined;
    },
    writeFile: (rel, text) => {
      const p = join(cwd, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    },
    listTests: () =>
      git(["ls-files"])
        .split("\n")
        .filter((f) => f && TEST_PATH.test(f))
        .map((path) => ({ path, text: readFileSync(join(cwd, path), "utf8") })),
    headSha: () => git(["rev-parse", "HEAD"]),
    commit: (message) => {
      if (!git(["status", "--porcelain"])) return false;
      execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
      execFileSync("git", ["-c", "user.name=cloud-agents", "-c", "user.email=cloud-agents@localhost", "commit", "-q", "-m", message], { cwd, stdio: "ignore" });
      opts.log?.(`committed: ${message}`);
      return true;
    },
    gate: (kind, ctx) =>
      runQualityGate(cwd, gateCfg, kind === "finish" ? "finish" : "iterate", {
        allowedFiles: ctx.allowedFiles,
        baseSha: ctx.baseSha,
        taskCommands: ctx.taskCommands,
        exec,
        log: opts.log,
      }),
    runCommand: async (command, dir = cwd) => {
      const out = await exec({ file: "sh", args: ["-c", command], env: subprocessEnv() }, dir, gateCfg.commandTimeoutMs);
      return { code: out.code, output: `${out.stdout}\n${out.stderr}`.trim() };
    },
    freshClone: async () => {
      const root = opts.workRoot ?? process.env.WORK_ROOT?.trim() ?? join(tmpdir(), "cloud-agents-work");
      const dir = mkdtempSync(join(root, "qa-"));
      const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
      execFileSync("git", ["clone", "-q", "--branch", branch, cwd, dir], { stdio: "ignore" });
      opts.log?.(`fresh clone for QA: ${dir}`);
      return dir;
    },
    diffStat: (base) => {
      try {
        return git(["diff", "--stat", `${base}...HEAD`]);
      } catch {
        return "";
      }
    },
  };
}
