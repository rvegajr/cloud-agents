import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import type { ExecFn, LocalCommand } from "../../src/lib/engine-local.js";
import { defaultExec } from "../../src/lib/engine-local.js";
import { hygienePatternToRegex, parseQuality, type QualityContract } from "./blueprint.js";

/**
 * Deterministic checks the orchestrator runs on a local model's turn, in its own
 * clone, with no model in the loop. This exists because the loop's only gate used
 * to be the model's own JSON report (`build-loop.ts`): nothing re-ran a command,
 * so "tests pass" and "complete: true" were the model grading its own homework.
 * A blind review of an unguarded hybrid build scored it 19/35 against 29/35 for an
 * all-Claude build, on defects every rule here targets directly: a stub test that
 * asserts nothing (vacuous-tests), an eslint rule bent around one variable and a
 * DB singleton (tamper/ownership), `.qwen/` committed (hygiene), `npm start`
 * broken from a clean clone (clean-start).
 */

export type GateRule = "ownership" | "quality-bar" | "hygiene" | "tamper" | "clean-start" | "vacuous-tests";

export interface GateFinding {
  rule: GateRule;
  ok: boolean;
  detail: string;
  command?: string;
  output?: string;
}

export interface GateResult {
  passed: boolean;
  findings: GateFinding[];
  seconds: number;
  skipped: GateRule[];
}

export interface GateConfig {
  enabled: boolean;
  retries: number;
  startTimeoutMs: number;
  commandTimeoutMs: number;
  /** Run rule 6 (stub src/, suite must fail) on: "finish" only, "every" turn, or never (""). */
  vacuous: "finish" | "every" | "";
  /** Run the clean-start rule every Nth iterate turn (always on finish). */
  startEvery: number;
}

export function gateConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GateConfig {
  const int = (name: string, fallback: number): number => {
    const n = Number(env[name]);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  const vacuousRaw = env.LOCAL_GATE_VACUOUS?.trim().toLowerCase();
  return {
    enabled: (env.LOCAL_GATE ?? "1").trim() !== "0",
    retries: int("LOCAL_GATE_RETRIES", 2),
    startTimeoutMs: int("LOCAL_GATE_START_SEC", 30) * 1000,
    commandTimeoutMs: int("LOCAL_GATE_CMD_MIN", 10) * 60_000,
    vacuous: vacuousRaw === "every" ? "every" : vacuousRaw === "0" || vacuousRaw === "" ? "" : "finish",
    startEvery: int("LOCAL_GATE_START_EVERY", 3),
  };
}

// ---------------------------------------------------------------------------
// Repo introspection
// ---------------------------------------------------------------------------

export interface PackageJsonLike {
  name?: string;
  main?: string;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function readPackageJson(cwd: string): PackageJsonLike | undefined {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJsonLike;
  } catch {
    return undefined;
  }
}

const QUALITY_BAR_SCRIPTS = ["lint", "typecheck", "test", "build"] as const;

/** Scripts to actually run, plus scripts SPEC.md's "Quality bar" promised that do not exist. */
export function discoverQualityBar(
  cwd: string,
  pkg: PackageJsonLike | undefined,
): { toRun: string[]; specPromisedMissing: string[] } {
  const scripts = pkg?.scripts ?? {};
  const toRun = QUALITY_BAR_SCRIPTS.filter((s) => typeof scripts[s] === "string" && scripts[s]!.trim());
  const specPath = join(cwd, "SPEC.md");
  const specPromisedMissing: string[] = [];
  if (existsSync(specPath)) {
    const spec = readFileSync(specPath, "utf8");
    const section = spec.match(/##\s*Quality bar[\s\S]*?(?=\n##\s|\n?$)/i)?.[0] ?? "";
    for (const cmd of section.match(/`npm run ([a-z:_-]+)`/g) ?? []) {
      const name = cmd.match(/`npm run ([a-z:_-]+)`/)?.[1];
      if (name && !scripts[name]) specPromisedMissing.push(name);
    }
  }
  return { toRun, specPromisedMissing };
}

export type AppType = { type: "http"; start: string[]; port: true } | { type: "cli"; start: string[] } | { type: "library" };

const HTTP_DEPS = ["express", "fastify", "koa", "hono", "next", "@hapi/hapi"];

export function detectAppType(pkg: PackageJsonLike | undefined): AppType {
  if (!pkg) return { type: "library" };
  if (pkg.bin) return { type: "cli", start: binCommand(pkg) };
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const scripts = pkg.scripts ?? {};
  if (HTTP_DEPS.some((d) => deps[d]) || scripts.start) return { type: "http", start: ["npm", "start"], port: true };
  return { type: "library" };
}

function binCommand(pkg: PackageJsonLike): string[] {
  const bin = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin ?? {})[0];
  return bin ? ["node", bin, "--help"] : ["npm", "start", "--", "--help"];
}

// ---------------------------------------------------------------------------
// Rule 1: ownership — the diff must stay inside files the task/turn owns
// ---------------------------------------------------------------------------

export interface ChangedFile {
  path: string;
  /** From `git diff --name-status`: A(dded), M(odified), D(eleted), R(enamed), C(opied). */
  status: string;
}

/**
 * Hard-owned from the first commit that names them: only exist once a blueprint
 * (REQUIREMENTS/QUALITY/DESIGN/TASKS/QA) or a spec (SPEC.md) has been written by
 * the architect, so any crew touch at all is a violation. ROADMAP.md is excluded:
 * `iterate.md` requires the crew to tick its own status lines.
 */
const ARCHITECT_OWNED_DOCS = [/^SPEC\.md$/, /^REQUIREMENTS\.md$/, /^QUALITY\.md$/, /^QA\.md$/, /^TASKS\.md$/, /^DESIGN\.md$/];

/**
 * The crew legitimately creates these on M1 (a fresh test, a fresh eslint config);
 * flagging that would break the walking skeleton. What is never legitimate is
 * going back to *modify* one later — that is the "bend the gate to pass it"
 * pattern (an eslint rule whitelisted around one variable, a test edited to match
 * broken behaviour instead of the code being fixed).
 */
const OWNED_ONCE_CREATED = [
  /^eslint\.config\.(js|mjs|cjs|ts)$/,
  /^\.eslintrc/,
  /^tsconfig.*\.json$/,
  /^(vitest|jest)\.config\.(js|mjs|ts)$/,
  /^\.mocharc/,
  /^test\//,
  /^tests\//,
  /^__tests__\//,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
];

export function ownershipFindings(changes: ChangedFile[], allowedFiles?: string[], opts: { finish?: boolean } = {}): GateFinding[] {
  const findings: GateFinding[] = [];
  // The finish gate spans the whole job, including the architect's own documents and any operator
  // correction to them; every crew turn was already held to document ownership individually.
  const docHits = opts.finish ? [] : changes.filter((c) => ARCHITECT_OWNED_DOCS.some((re) => re.test(c.path)));
  if (docHits.length) {
    findings.push({
      rule: "ownership",
      ok: false,
      detail: `touched architect-owned document(s): ${docHits.map((c) => c.path).join(", ")}. Ask for that change in your report instead of making it.`,
    });
  }
  const modifiedOwned = changes.filter(
    (c) => c.status.startsWith("M") && OWNED_ONCE_CREATED.some((re) => re.test(c.path)) && !docHits.includes(c),
  );
  if (modifiedOwned.length) {
    findings.push({
      rule: "ownership",
      ok: false,
      detail: `modified an existing test or tooling config: ${modifiedOwned
        .map((c) => c.path)
        .join(", ")}. Creating one is fine; going back to change one to get green is not — fix the code it tests instead.`,
    });
  }
  if (allowedFiles?.length) {
    const owned = new Set([...docHits, ...modifiedOwned].map((c) => c.path));
    const outOfScope = changes.filter(
      (c) => !allowedFiles.includes(c.path) && !owned.has(c.path) && !(opts.finish && ARCHITECT_OWNED_DOCS.some((re) => re.test(c.path))),
    );
    if (outOfScope.length) {
      findings.push({
        rule: "ownership",
        ok: false,
        detail: `touched file(s) outside this task's scope (${allowedFiles.join(", ")}): ${outOfScope.map((c) => c.path).join(", ")}`,
      });
    }
  }
  if (!findings.length) {
    findings.push({ rule: "ownership", ok: true, detail: "diff stayed within owned files" });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 3: hygiene
// ---------------------------------------------------------------------------

const HYGIENE_PATTERNS: { re: RegExp; ignoreLine: string; label: string }[] = [
  { re: /^\.qwen\//, ignoreLine: ".qwen/", label: ".qwen/ (tool state)" },
  { re: /^\.aider/, ignoreLine: ".aider*", label: ".aider* (tool state)" },
  { re: /^\.cursor\/worktrees\//, ignoreLine: ".cursor/worktrees/", label: ".cursor/worktrees/" },
  { re: /^(dist|build|coverage)\//, ignoreLine: "dist/ build/ coverage/", label: "build output" },
  { re: /^node_modules\//, ignoreLine: "node_modules/", label: "node_modules/" },
  { re: /\.(db|sqlite3?)$/, ignoreLine: "*.db *.sqlite*", label: "a database file" },
  { re: /^\.env$/, ignoreLine: ".env", label: ".env" },
];

export function hygieneFindings(lsFiles: string[], gitignore: string, patterns?: string[]): GateFinding[] {
  const findings: GateFinding[] = [];
  const rules = patterns?.length
    ? patterns.map((pat) => ({ re: hygienePatternToRegex(pat), ignoreLine: pat, label: pat }))
    : HYGIENE_PATTERNS;
  for (const p of rules) {
    const hits = lsFiles.filter((f) => p.re.test(f));
    if (hits.length) {
      findings.push({
        rule: "hygiene",
        ok: false,
        detail: `${p.label} is tracked: ${hits.slice(0, 5).join(", ")}${hits.length > 5 ? ` (+${hits.length - 5} more)` : ""}. Add \`${p.ignoreLine}\` to .gitignore and \`git rm --cached\` these.`,
        command: `git rm --cached ${hits[0]}`,
      });
    }
  }
  if (!findings.length) findings.push({ rule: "hygiene", ok: true, detail: "no tool state, build output, or secrets tracked" });
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 4: tamper — config drift and non-tests, independent of ownership diffing
// ---------------------------------------------------------------------------

export interface TestSource {
  path: string;
  text: string;
}

export function tamperFindings(opts: {
  scriptsBefore?: Record<string, string>;
  scriptsAfter?: Record<string, string>;
  testSources: TestSource[];
  srcModules: string[];
}): GateFinding[] {
  const findings: GateFinding[] = [];
  if (opts.scriptsBefore && opts.scriptsAfter) {
    const changed = Object.keys({ ...opts.scriptsBefore, ...opts.scriptsAfter }).filter(
      (k) => opts.scriptsBefore![k] !== opts.scriptsAfter![k],
    );
    if (changed.length) {
      findings.push({
        rule: "tamper",
        ok: false,
        detail: `package.json scripts changed after the blueprint commit: ${changed
          .map((k) => `${k}: "${opts.scriptsBefore![k] ?? "(new)"}" -> "${opts.scriptsAfter![k] ?? "(removed)"}"`)
          .join("; ")}`,
      });
    }
  }
  for (const t of opts.testSources) {
    const imports = [...t.text.matchAll(/(?:import[^'"]*from\s*|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    const local = imports.filter((i) => i.startsWith(".") || i.startsWith("/"));
    const touchesApp = local.some((i) => opts.srcModules.some((m) => i.includes(m)));
    if (local.length === 0 || !touchesApp) {
      findings.push({
        rule: "tamper",
        ok: false,
        detail: `${t.path} imports no app module (${local.join(", ") || "none"}); it cannot be testing this app`,
      });
    }
    if (/\.only\(|test\.todo|xit\(|it\.skip\(|test\.skip\(|describe\.skip\(/.test(t.text)) {
      findings.push({ rule: "tamper", ok: false, detail: `${t.path} has a skipped/only test (.only/.skip/.todo)` });
    }
    if (/http\.createServer\(|createServer\(/.test(t.text) && !touchesApp) {
      findings.push({ rule: "tamper", ok: false, detail: `${t.path} builds its own stub server instead of importing the app` });
    }
  }
  if (!findings.length) findings.push({ rule: "tamper", ok: true, detail: "no config drift or vacuous test file detected" });
  return findings;
}

export function tamperEslintFindings(eslintConfigText: string | undefined): GateFinding[] {
  if (!eslintConfigText) return [];
  const m = eslintConfigText.match(/varsIgnorePattern["']?\s*:\s*["']([^"']+)["']/);
  if (m && m[1] !== "^_") {
    return [
      {
        rule: "tamper",
        ok: false,
        detail: `eslint varsIgnorePattern is "${m[1]}", not the standard "^_" — this whitelists a specific unused variable instead of fixing it`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Execution helpers
// ---------------------------------------------------------------------------

/**
 * Strip the orchestrator's own `node --test` markers (and other run-specific
 * noise) before spawning a gate subprocess. Without this, a target repo's own
 * `node --test` sees `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` inherited from
 * this process, decides it is a recursive test run, and silently skips running
 * anything — the suite "passes" no matter what the code does.
 */
export function subprocessEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  delete out.NODE_TEST_CONTEXT;
  delete out.NODE_TEST_WORKER_ID;
  return out;
}

function npmCmd(args: string[]): LocalCommand {
  return { file: "npm", args, env: subprocessEnv() };
}

/** A QUALITY.md command is a shell line (`npm test`, `pytest -q`, `go test ./...`). */
function shCmd(command: string, extraEnv: Record<string, string> = {}): LocalCommand {
  return { file: "sh", args: ["-c", command], env: { ...subprocessEnv(), ...extraEnv } };
}

const BAR_ORDER = ["lint", "typecheck", "test", "build"];

function gitCmd(args: string[]): LocalCommand {
  return { file: "git", args, env: subprocessEnv() };
}

async function run(exec: ExecFn, cwd: string, cmd: LocalCommand, timeoutMs: number) {
  return exec(cmd, cwd, timeoutMs);
}

async function runQualityBar(
  cwd: string,
  cfg: GateConfig,
  exec: ExecFn,
  log?: (l: string) => void,
  contract?: QualityContract,
  taskCommands?: string[],
): Promise<GateFinding[]> {
  if (contract) {
    const findings: GateFinding[] = [];
    const names = Object.keys(contract.bar).filter((k) => k !== "install" && k !== "start" && !(taskCommands && k === "test"));
    names.sort((a, b) => (BAR_ORDER.indexOf(a) === -1 ? 99 : BAR_ORDER.indexOf(a)) - (BAR_ORDER.indexOf(b) === -1 ? 99 : BAR_ORDER.indexOf(b)));
    for (const name of names) {
      const command = contract.bar[name]!;
      log?.(`gate: ${name}: ${command}`);
      const out = await run(exec, cwd, shCmd(command), cfg.commandTimeoutMs);
      findings.push({
        rule: "quality-bar",
        ok: out.code === 0,
        detail: out.code === 0 ? `${name} passed (${command})` : `${name} exited ${out.code} (${command})`,
        command,
        output: out.code === 0 ? undefined : `${out.stdout}\n${out.stderr}`.trim().slice(-2000),
      });
    }
    for (const command of taskCommands ?? []) {
      log?.(`gate: task command: ${command}`);
      const out = await run(exec, cwd, shCmd(command), cfg.commandTimeoutMs);
      findings.push({
        rule: "quality-bar",
        ok: out.code === 0,
        detail: out.code === 0 ? `task command passed (${command})` : `task command exited ${out.code} (${command})`,
        command,
        output: out.code === 0 ? undefined : `${out.stdout}\n${out.stderr}`.trim().slice(-2000),
      });
    }
    if (!names.length && !taskCommands?.length) findings.push({ rule: "quality-bar", ok: false, detail: "QUALITY.md quality bar names no lint/typecheck/test/build command" });
    return findings;
  }
  const pkg = readPackageJson(cwd);
  const { toRun, specPromisedMissing } = discoverQualityBar(cwd, pkg);
  const findings: GateFinding[] = [];
  for (const name of specPromisedMissing) {
    findings.push({ rule: "quality-bar", ok: false, detail: `SPEC.md promises \`npm run ${name}\` but package.json has no such script` });
  }
  for (const script of toRun) {
    const cmdStr = `npm run ${script}`;
    log?.(`gate: running ${cmdStr}`);
    const out = await run(exec, cwd, npmCmd(["run", script]), cfg.commandTimeoutMs);
    findings.push({
      rule: "quality-bar",
      ok: out.code === 0,
      detail: out.code === 0 ? `${cmdStr} passed` : `${cmdStr} exited ${out.code}`,
      command: cmdStr,
      output: out.code === 0 ? undefined : `${out.stdout}\n${out.stderr}`.trim().slice(-2000),
    });
  }
  if (!toRun.length) {
    findings.push({ rule: "quality-bar", ok: false, detail: "package.json has none of lint/typecheck/test/build; nothing to gate" });
  }
  return findings;
}

async function runCleanStart(
  cwd: string,
  cfg: GateConfig,
  exec: ExecFn,
  log?: (l: string) => void,
  contract?: QualityContract,
): Promise<GateFinding[]> {
  const pkg = readPackageJson(cwd);
  const appType: AppType = contract?.start
    ? contract.start.probe?.http !== undefined || (!contract.start.probe?.args && contract.start.probe?.exit === undefined)
      ? { type: "http", start: ["sh", "-c", contract.start.command], port: true }
      : { type: "cli", start: ["sh", "-c", `${contract.start.command} ${(contract.start.probe?.args ?? []).join(" ")}`.trim()] }
    : contract
      ? { type: "library" }
      : detectAppType(pkg);
  if (appType.type === "library") return [{ rule: "clean-start", ok: true, detail: "no start command; treated as a library, skipped" }];

  const scratch = mkdtempSync(join(tmpdir(), "gate-clone-"));
  try {
    const clone = await run(exec, cwd, gitCmd(["clone", "-q", ".", scratch]), cfg.commandTimeoutMs);
    if (clone.code !== 0) {
      return [{ rule: "clean-start", ok: false, detail: `git clone into scratch failed: ${clone.stderr.slice(-500)}` }];
    }
    const install = contract?.bar.install ?? (pkg ? "npm ci" : undefined);
    if (install) {
      log?.(`gate: clean-clone install: ${install}`);
      const ci = await run(exec, scratch, shCmd(install), cfg.commandTimeoutMs);
      if (ci.code !== 0) {
        return [{ rule: "clean-start", ok: false, detail: `install failed from a clean clone (${install}): ${ci.stderr.slice(-1000)}`, command: install }];
      }
    }
    if (appType.type === "cli") {
      const [file, ...args] = appType.start;
      log?.(`gate: ${appType.start.join(" ")}`);
      const out = await run(exec, scratch, { file: file!, args, env: subprocessEnv() }, cfg.startTimeoutMs);
      return [
        {
          rule: "clean-start",
          ok: out.code === 0,
          detail: out.code === 0 ? `${appType.start.join(" ")} exited 0` : `${appType.start.join(" ")} exited ${out.code} from a clean clone`,
          command: appType.start.join(" "),
          output: out.code === 0 ? undefined : `${out.stdout}\n${out.stderr}`.trim().slice(-1000),
        },
      ];
    }
    const port = 20000 + Math.floor(Math.random() * 10000);
    const startCmd = contract?.start?.command ?? "npm start";
    const probePath = contract?.start?.probe?.http ?? "/";
    const expect = contract?.start?.probe?.expect;
    const timeoutMs = contract?.start?.probe?.timeout_s ? contract.start.probe.timeout_s * 1000 : cfg.startTimeoutMs;
    log?.(`gate: ${startCmd} on port ${port} from a clean clone, probing ${probePath}`);
    const started = await pollHttpStart(scratch, exec, port, timeoutMs, startCmd, probePath, expect);
    return [started];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function pollHttpStart(
  scratch: string,
  exec: ExecFn,
  port: number,
  timeoutMs: number,
  startCmd = "npm start",
  probePath = "/",
  expect?: number,
): Promise<GateFinding> {
  const startExec = exec(shCmd(startCmd, { PORT: String(port) }), scratch, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  let ok = false;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${probePath}`, { signal: AbortSignal.timeout(1500) });
      if (expect !== undefined ? res.status === expect : res.status < 500) {
        ok = true;
        break;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  // We don't own the process handle here (exec runs to completion); a short-lived
  // server that never exits will simply hit the ExecFn's own timeout and be killed.
  void startExec;
  return ok
    ? { rule: "clean-start", ok: true, detail: `${startCmd} answered ${probePath} on :${port} from a clean clone` }
    : { rule: "clean-start", ok: false, detail: `${startCmd} did not answer ${probePath} on :${port} within ${timeoutMs / 1000}s: ${lastErr}`, command: startCmd };
}

async function runVacuousProbe(
  cwd: string,
  cfg: GateConfig,
  exec: ExecFn,
  log?: (l: string) => void,
  contract?: QualityContract,
): Promise<GateFinding[]> {
  const pkg = readPackageJson(cwd);
  const testCmd = contract?.bar.test ?? (pkg?.scripts?.test ? "npm test" : undefined);
  if (!testCmd) return [{ rule: "vacuous-tests", ok: true, detail: "no test command; skipped" }];
  const srcRoot = join(cwd, "src");
  if (!existsSync(srcRoot)) return [{ rule: "vacuous-tests", ok: true, detail: "no src/ directory; skipped" }];

  const backup = mkdtempSync(join(tmpdir(), "gate-src-backup-"));
  const files = listFilesRecursive(srcRoot).filter((f) => /\.(js|ts|mjs|cjs)$/.test(f));
  try {
    for (const f of files) {
      const rel = relative(srcRoot, f);
      const dest = join(backup, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(f, dest);
      writeFileSync(f, `throw new Error("gate-stub: ${rel} stubbed by the vacuous-tests probe");\n`);
    }
    log?.(`gate: vacuous-suite probe (${files.length} files stubbed): ${testCmd}`);
    const out = await run(exec, cwd, shCmd(testCmd), Math.max(30_000, cfg.commandTimeoutMs / 2));
    if (out.code === 0) {
      return [
        {
          rule: "vacuous-tests",
          ok: false,
          detail: "the test suite still passed with every src/ file replaced by a throw — the tests do not exercise the app",
          command: `${testCmd} (with src/ stubbed)`,
        },
      ];
    }
    return [{ rule: "vacuous-tests", ok: true, detail: "test suite correctly fails when src/ is broken" }];
  } finally {
    for (const f of files) {
      const rel = relative(srcRoot, f);
      const src = join(backup, rel);
      if (existsSync(src)) copyFileSync(src, f);
    }
    rmSync(backup, { recursive: true, force: true });
  }
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface RunGateOpts {
  /** Files this turn was allowed to write (task ownership); undefined = no scope check. */
  allowedFiles?: string[];
  /** Commit before the turn; the ownership diff is `baseSha..HEAD`. Default: HEAD~1. */
  baseSha?: string;
  /** package.json scripts as of the blueprint commit, for tamper detection. */
  scriptsBaseline?: Record<string, string>;
  /** The QUALITY.md contract. Default: read from `<cwd>/QUALITY.md`; absent = package.json fallback. */
  quality?: QualityContract | null;
  /**
   * Task profile: the commands that must pass for THIS turn (the task's `Commands:` plus the
   * commands of every task already passed). They replace the bar's `test` — the whole suite is
   * red by design until the last task, and only the finish gate runs it.
   */
  taskCommands?: string[];
  exec?: ExecFn;
  log?: (line: string) => void;
}

export function readQualityContract(cwd: string): QualityContract | undefined {
  const p = join(cwd, "QUALITY.md");
  if (!existsSync(p)) return undefined;
  return parseQuality(readFileSync(p, "utf8"));
}

export async function runQualityGate(
  cwd: string,
  cfg: GateConfig,
  kind: "iterate" | "finish",
  opts: RunGateOpts = {},
): Promise<GateResult> {
  const exec = opts.exec ?? defaultExec;
  const started = Date.now();
  const findings: GateFinding[] = [];
  const skipped: GateRule[] = [];

  if (!cfg.enabled) {
    return { passed: true, findings: [{ rule: "quality-bar", ok: true, detail: "LOCAL_GATE=0; gate disabled" }], seconds: 0, skipped: [] };
  }

  const contract = opts.quality === null ? undefined : (opts.quality ?? readQualityContract(cwd));
  const lsOut = await run(exec, cwd, gitCmd(["ls-files"]), 30_000);
  const changed = lsOut.code === 0 ? lsOut.stdout.split("\n").filter(Boolean) : [];
  const diffOut = await run(exec, cwd, gitCmd(["diff", "--name-status", `${opts.baseSha ?? "HEAD~1"}..HEAD`]), 30_000);
  const changedThisTurn: ChangedFile[] = diffOut.code === 0
    ? diffOut.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [status, ...rest] = line.split("\t");
          return { status: status ?? "M", path: rest.at(-1) ?? "" };
        })
        .filter((c) => c.path)
    : [];
  findings.push(...ownershipFindings(changedThisTurn, opts.allowedFiles, { finish: kind === "finish" }));

  const gitignorePath = join(cwd, ".gitignore");
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  findings.push(...hygieneFindings(changed, gitignore, contract?.hygieneNeverTracked));

  if (opts.scriptsBaseline) {
    const pkg = readPackageJson(cwd);
    findings.push(...tamperFindings({ scriptsBefore: opts.scriptsBaseline, scriptsAfter: pkg?.scripts, testSources: [], srcModules: [] }));
  }
  const eslintPath = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs"].map((f) => join(cwd, f)).find(existsSync);
  if (eslintPath) findings.push(...tamperEslintFindings(readFileSync(eslintPath, "utf8")));

  findings.push(...(await runQualityBar(cwd, cfg, exec, opts.log, contract, kind === "iterate" ? opts.taskCommands : undefined)));

  // A task-scoped turn (blueprint loop) never probes the start command: the app cannot start until the
  // wiring task lands, and a crew told "the server does not answer" will leave its files to fix it.
  const runStart = kind === "finish" || (!opts.taskCommands && cfg.startEvery > 0 && Math.random() < 1 / cfg.startEvery);
  if (runStart) {
    findings.push(...(await runCleanStart(cwd, cfg, exec, opts.log, contract)));
  } else {
    skipped.push("clean-start");
  }

  const runVacuous = cfg.vacuous === "every" || (cfg.vacuous === "finish" && kind === "finish");
  if (runVacuous && findings.every((f) => f.ok)) {
    findings.push(...(await runVacuousProbe(cwd, cfg, exec, opts.log, contract)));
  } else if (cfg.vacuous) {
    skipped.push("vacuous-tests");
  }

  const passed = findings.every((f) => f.ok);
  return { passed, findings, seconds: Math.round((Date.now() - started) / 1000), skipped };
}

export function gateFeedbackNote(attempt: number, result: GateResult): string {
  const failing = result.findings.filter((f) => !f.ok);
  const lines = failing.map((f) => {
    const cmd = f.command ? ` (\`${f.command}\`)` : "";
    const out = f.output ? `\n  last output:\n  ${f.output.split("\n").slice(-40).join("\n  ")}` : "";
    return `- [${f.rule}] ${f.detail}${cmd}${out}`;
  });
  return (
    `## Quality gate failed (attempt ${attempt})\n\n` +
    `The orchestrator, not you, decides this turn is done. It ran the quality contract ` +
    `in your clone and found:\n\n${lines.join("\n")}\n\n` +
    `Fix the cause of each, not the check. Do not edit tests, config, or files outside ` +
    `this task's scope to make these pass.\n\n---\n\n`
  );
}

export function formatGateSummary(result: GateResult): string {
  const failing = result.findings.filter((f) => !f.ok).map((f) => f.rule);
  return result.passed
    ? `gate: PASS in ${result.seconds}s`
    : `gate: FAIL (${[...new Set(failing)].join(", ")}) in ${result.seconds}s`;
}
