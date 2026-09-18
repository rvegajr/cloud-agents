import type { SendFn, TurnResult } from "../../src/lib/build-loop.js";
import { buildPrompt } from "../../src/lib/prompts.js";
import { extractJsonBlock } from "../../src/lib/report.js";
import {
  designExcerptFor,
  jobKindOf,
  mustHavesOf,
  parseCoverage,
  parseQaScenarios,
  parseQuality,
  parseRequirements,
  parseTasks,
  parseWorkflows,
  requirementsGaps,
  traceability,
  validateTasks,
  type BlueprintTask,
  type QaScenario,
  type QualityContract,
  type Requirement,
  type Workflow,
} from "./blueprint.js";
import { browserToolNote, scenarioNeedsBrowser } from "./browser.js";
import { gateFeedbackNote, type GateResult } from "./quality-gate.js";

/**
 * The architect–crew–gate loop (PATTERN.md section 3), independent of any
 * engine or SDK so it can be driven by a fake `send` and a fake `io` in tests.
 *
 *   requirements → blueprint → tasks (gated) → finish gate → qa → review → done
 *
 * The loop never trusts a model's report as a verdict. `io.gate` decides a task,
 * `io.runCommand` decides a review finding's check, and the QA turn runs in a
 * clone the crew never touched.
 */

export interface BlueprintIO {
  readFile(rel: string): string | undefined;
  /** Materialise an artifact the architect reported but did not write. */
  writeFile(rel: string, text: string): void;
  /** Test sources for traceability (path + text). */
  listTests(): { path: string; text: string }[];
  headSha(): string;
  /** Commit whatever the crew left uncommitted. Returns true if a commit was made. */
  commit(message: string): boolean;
  gate(kind: "task" | "finish", ctx: { allowedFiles?: string[]; baseSha?: string; taskCommands?: string[] }): Promise<GateResult>;
  runCommand(command: string, cwd?: string): Promise<{ code: number; output: string }>;
  /** A clone of the current branch the crew never touched; QA runs there. */
  freshClone(): Promise<string>;
  diffStat(base: string): string;
}

export interface TaskRecord {
  id: string;
  attempts: number;
  gatePassed: boolean;
  report?: unknown;
  failing?: string[];
}

export interface QaResult {
  id: string;
  requirement: string;
  passed: boolean;
  evidence?: string;
  defect?: { observed?: string; expected?: string; where?: string } | null;
}

export interface QaReport {
  results: QaResult[];
  traceability?: { covered?: string[]; uncovered?: string[] };
}

export interface ReviewFinding {
  id: string;
  severity: "high" | "medium" | "low";
  class?: string;
  file?: string;
  line?: number | null;
  problem: string;
  fix: string;
  check?: { command: string; expect_exit?: number };
}

export interface ReviewReport {
  verdict: "ship" | "fix";
  summary?: string;
  claims_disputed?: string[];
  findings: ReviewFinding[];
  rubric?: Record<string, number>;
}

export type BlueprintPhase = "requirements" | "blueprint" | "tasks" | "finish" | "qa" | "review" | "done" | "stopped";

export type BlueprintStopReason =
  | "complete"
  | "unparseable-report"
  | "requirements-incomplete"
  | "blueprint-incomplete"
  | "gate-failed"
  | "qa-failed"
  | "review-unresolved"
  | "run-failed";

export interface BlueprintState {
  phase: BlueprintPhase;
  jobKind?: "build" | "change" | "repair" | "maintain";
  requirements: Requirement[];
  /** The job's must-have bullets (M1..Mn), each of which stage 0 had to cover. */
  mustHaves?: string[];
  /** End-to-end journeys QA walks, each crossing several requirements. */
  workflows: Workflow[];
  quality?: QualityContract;
  tasks: BlueprintTask[];
  scenarios: QaScenario[];
  taskIndex: number;
  taskRecords: TaskRecord[];
  baselineSha?: string;
  finishGate?: { passed: boolean; failing: string[] };
  qa?: QaReport;
  qaAttempts: number;
  review?: ReviewReport;
  reviewChecks?: { id: string; command: string; expected: number; actual: number }[];
  runIds: string[];
  stopReason?: BlueprintStopReason;
  stopDetail?: string;
}

export interface BlueprintOptions {
  job: string;
  repo: string;
  io: BlueprintIO;
  maxTasks?: number;
  /** Gate retries per task turn, each with the gate's feedback prepended. */
  taskRetries?: number;
  /** Scenarios per QA turn (default 4): a small batch keeps a local analyst inside its depth. */
  qaBatch?: number;
  /** After a local QA turn fails to report twice, run that batch on this tier (default none). */
  qaFallbackTier?: "claude";
  /** The engine can give the QA analyst a real browser (Playwright MCP); QA turns are sent with `browser: true`. */
  browser?: boolean;
  onState?: (state: BlueprintState) => void | Promise<void>;
  log?: (line: string) => void;
}

const PROMPTS = "architect-crew-gate/prompts";

const WRITE_REMINDER = (missing: string[]): string =>
  "## You did not write the files\n\n" +
  `Your previous attempt printed its answer but left the working tree untouched: ${missing.join(", ")} ` +
  "do not exist on disk. The orchestrator reads files, not your message. Create each file with your " +
  "file-writing tool, then `git add` and commit them, then reply again with the same JSON block.\n\n---\n\n";

const FENCE = "```";

/** A model's report: a fenced json block, else the whole reply as JSON, else the outermost {...}. Local models often skip the fence. */
export function lenientJson<T = Record<string, unknown>>(text: string | undefined): T | undefined {
  if (!text) return undefined;
  const fenced = extractJsonBlock<T>(text);
  if (fenced) return fenced;
  const tryParse = (s: string): T | undefined => {
    try {
      const v = JSON.parse(s) as T;
      return v && typeof v === "object" ? v : undefined;
    } catch {
      return undefined;
    }
  };
  const trimmed = text.trim();
  return tryParse(trimmed) ?? (trimmed.includes("{") ? tryParse(trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)) : undefined);
}

/** Rebuild the two stage-0 documents from the turn's JSON when the architect described them but did not write them. */
export function materialiseRequirements(report: {
  requirements?: { id: string; text?: string; check?: string }[];
  workflows?: { id: string; title?: string; requirements?: string[]; steps?: string[] }[];
  coverage?: Record<string, string[]>;
  quality?: { bar?: Record<string, string>; start?: unknown; hygiene_never_tracked?: string[]; rubric_targets?: Record<string, number> };
  job_kind?: string;
  non_goals?: string[];
  decisions?: string[];
}): { requirements?: string; quality?: string } {
  const out: { requirements?: string; quality?: string } = {};
  if (report.requirements?.length) {
    const lines = report.requirements.map((r) => `- **${r.id}** ${r.text ?? ""}${r.check ? `\n  Check: ${r.check}` : ""}`);
    const workflows = (report.workflows ?? [])
      .map((w) => `- **${w.id}** ${w.title ?? ""} (${(w.requirements ?? []).join(", ")})\n${(w.steps ?? []).map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`)
      .join("\n");
    const coverage = Object.entries(report.coverage ?? {}).map(([m, rs]) => `- ${m}: ${rs.join(", ")}`).join("\n");
    const nonGoals = (report.non_goals ?? []).map((n) => `- ${n}`).join("\n") || "- (none stated)";
    const decisions = (report.decisions ?? []).map((d) => `- ${d}`).join("\n");
    out.requirements =
      `# Requirements\n\n## Acceptance criteria\n\n${lines.join("\n")}\n\n` +
      (workflows ? `## Workflows\n\n${workflows}\n\n` : "") +
      (coverage ? `## Coverage\n\n${coverage}\n\n` : "") +
      `## Non-goals (v1)\n\n${nonGoals}\n\n` +
      `## Decisions\n\n- Job kind: ${report.job_kind ?? "unknown"}\n${decisions}\n\n` +
      `${FENCE}json requirements\n${JSON.stringify({ requirements: report.requirements, workflows: report.workflows ?? [], coverage: report.coverage ?? {} }, null, 2)}\n${FENCE}\n`;
  }
  if (report.quality?.bar) {
    const rows = Object.entries(report.quality.bar).map(([k, v]) => `| ${k} | \`${v}\` |`);
    out.quality =
      `# Quality standard\n\n## Quality bar\n\n| Purpose | Command |\n| --- | --- |\n${rows.join("\n")}\n\n` +
      `${FENCE}json quality\n${JSON.stringify(report.quality, null, 2)}\n${FENCE}\n`;
  }
  return out;
}

/** Rebuild TASKS.md from the blueprint turn's JSON when the architect did not write it. */
export function materialiseTasks(report: {
  tasks?: { id: string; title?: string; requirements?: string[]; files?: string[]; ports?: string[]; tests?: string[]; commands?: string[]; parallel_ok?: boolean; goal?: string }[];
}): string | undefined {
  if (!report.tasks?.length) return undefined;
  const blocks = report.tasks.map(
    (t) =>
      `## ${t.id}: ${t.title ?? ""}\nRequirements: ${(t.requirements ?? []).join(", ")}\nFiles: ${(t.files ?? []).join(", ")}\n` +
      `Ports: ${(t.ports ?? []).join(", ")}\nTests: ${(t.tests ?? []).join(", ")}\nCommands: ${(t.commands ?? []).join(", ")}\n` +
      `Parallel: ${t.parallel_ok ? "yes" : "no"}\nGoal: ${t.goal ?? ""}`,
  );
  return `# Tasks\n\n${blocks.join("\n\n")}\n\n${FENCE}json tasks\n${JSON.stringify({ tasks: report.tasks }, null, 2)}\n${FENCE}\n`;
}

export function initialBlueprintState(): BlueprintState {
  return { phase: "requirements", requirements: [], workflows: [], tasks: [], scenarios: [], taskIndex: 0, taskRecords: [], qaAttempts: 0, runIds: [] };
}

function tail(text: string, lines = 60): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

function unionFiles(...lists: ((string | undefined)[] | undefined)[]): string[] {
  return [...new Set(lists.flat().filter((f): f is string => Boolean(f)))];
}

function gateSummary(records: TaskRecord[], finish?: BlueprintState["finishGate"]): string {
  const lines = records.map((r) => `- ${r.id}: ${r.gatePassed ? "PASS" : "FAIL"} after ${r.attempts} attempt(s)${r.failing?.length ? ` (${r.failing.join(", ")})` : ""}`);
  if (finish) lines.push(`- finish gate: ${finish.passed ? "PASS" : `FAIL (${finish.failing.join(", ")})`}`);
  return lines.join("\n") || "(no gate records)";
}

export async function runBlueprintLoop(
  send: SendFn,
  opts: BlueprintOptions,
  initial?: Partial<BlueprintState>,
): Promise<BlueprintState & { stopReason: BlueprintStopReason }> {
  const log = opts.log ?? (() => {});
  const io = opts.io;
  const retries = opts.taskRetries ?? 2;
  const state: BlueprintState = { ...initialBlueprintState(), ...initial };
  const persist = async () => opts.onState?.(state);
  const stop = async (reason: BlueprintStopReason, detail?: string, phase: BlueprintPhase = "stopped") => {
    state.phase = phase;
    state.stopReason = reason;
    state.stopDetail = detail;
    log(`stop: ${reason}${detail ? ` — ${detail}` : ""}`);
    await persist();
    return { ...state, stopReason: reason };
  };
  const track = (t: TurnResult) => {
    if (t.runId) state.runIds.push(t.runId);
  };
  const artifact = (name: string) => io.readFile(name);

  // ---- Stage 0: requirements + standard ------------------------------------
  if (state.phase === "requirements") {
    log("stage 0: requirements and quality standard");
    state.mustHaves = mustHavesOf(opts.job);
    const mustHavesMd = state.mustHaves.length
      ? state.mustHaves.map((m, i) => `- **M${i + 1}** ${m}`).join("\n")
      : "(the job lists no must-have bullets; derive M1..Mn from its text and write them under Coverage)";
    const reqPrompt = buildPrompt(`${PROMPTS}/requirements`, "", { job: opts.job, repo: opts.repo, must_haves: mustHavesMd });
    let t = await send(reqPrompt, { mode: "agent" });
    track(t);
    if (t.status !== "finished") return stop("run-failed", "requirements turn did not finish");
    io.commit("docs: requirements and quality standard");
    let report = lenientJson<Parameters<typeof materialiseRequirements>[0]>(t.result) ?? {};
    let missing = ["REQUIREMENTS.md", "QUALITY.md"].filter((f) => !artifact(f));
    if (missing.length) {
      log(`architect did not write ${missing.join(", ")}; asking once more`);
      t = await send(`${WRITE_REMINDER(missing)}${reqPrompt}`, { mode: "agent" });
      track(t);
      if (t.status !== "finished") return stop("run-failed", "requirements retry did not finish");
      io.commit("docs: requirements and quality standard");
      missing = ["REQUIREMENTS.md", "QUALITY.md"].filter((f) => !artifact(f));
      const again = lenientJson<Parameters<typeof materialiseRequirements>[0]>(t.result);
      if (again?.requirements?.length) report = again;
    }
    if (missing.length) {
      const made = materialiseRequirements(report);
      if (missing.includes("REQUIREMENTS.md") && made.requirements) io.writeFile("REQUIREMENTS.md", made.requirements);
      if (missing.includes("QUALITY.md") && made.quality) io.writeFile("QUALITY.md", made.quality);
      if (io.commit("docs: requirements and quality standard (materialised from the architect's report)")) log(`materialised ${missing.join(", ")} from the report`);
    }
    const readStage0 = () => {
      const reqMd = artifact("REQUIREMENTS.md");
      const qMd = artifact("QUALITY.md");
      state.requirements = reqMd ? parseRequirements(reqMd) : [];
      state.workflows = reqMd ? parseWorkflows(reqMd) : [];
      state.quality = qMd ? parseQuality(qMd) : undefined;
      state.jobKind = (reqMd && jobKindOf(reqMd)) || (report.job_kind as BlueprintState["jobKind"]) || undefined;
      return reqMd;
    };
    let reqMd = readStage0();
    if (!state.requirements.length) return stop("unparseable-report", "REQUIREMENTS.md has no acceptance criteria with ids");
    if (!state.quality?.bar.test) return stop("unparseable-report", "QUALITY.md names no test command in its quality bar");
    if (state.requirements.some((r) => !r.check)) log(`warning: ${state.requirements.filter((r) => !r.check).map((r) => r.id).join(", ")} have no check`);
    // Every must-have covered by a requirement and walked by a workflow, before any blueprint is drawn:
    // the cheapest place to catch "the edit flow never became a requirement".
    const stage0Gaps = () =>
      requirementsGaps({
        mustHaves: state.mustHaves ?? [],
        coverage: (reqMd ? parseCoverage(reqMd) : undefined) ?? report.coverage,
        requirements: state.requirements,
        workflows: state.workflows,
        jobKind: state.jobKind,
      });
    let gaps = stage0Gaps();
    if (gaps.length) {
      log(`requirements have gaps; asking the architect once more:\n${gaps.join("\n")}`);
      const note =
        `## Requirements incomplete\n\nREQUIREMENTS.md and QUALITY.md are on disk but the orchestrator found these gaps against the job's must-haves. ` +
        `Fix only these in REQUIREMENTS.md (add requirements with checks, workflows with steps, and the Coverage map), commit, then reply with the same JSON block.\n\n${gaps.join("\n")}\n\n---\n\n`;
      const t2 = await send(`${note}${reqPrompt}`, { mode: "agent" });
      track(t2);
      if (t2.status !== "finished") return stop("run-failed", "requirements retry did not finish");
      io.commit("docs: requirements gap fixes");
      const again = lenientJson<Parameters<typeof materialiseRequirements>[0]>(t2.result);
      if (again?.requirements?.length) report = again;
      reqMd = readStage0();
      gaps = stage0Gaps();
      if (gaps.length) return stop("requirements-incomplete", gaps.join("; "));
    }
    log(`requirements: ${state.requirements.length} (${state.jobKind ?? "kind unknown"}), ${state.workflows.length} workflow(s), ${state.mustHaves.length} must-have(s) covered; bar: ${Object.keys(state.quality.bar).join(", ")}`);
    state.phase = "blueprint";
    await persist();
  }

  // ---- Stage 1: blueprint --------------------------------------------------
  if (state.phase === "blueprint") {
    log("stage 1: blueprint");
    const bpPrompt = buildPrompt(`${PROMPTS}/blueprint`, "", {
      job: opts.job,
      max_tasks: String(opts.maxTasks ?? 12),
      workflow_ids: state.workflows.map((w) => `${w.id} (${w.requirements.join(", ")})`).join(", ") || "(none listed in REQUIREMENTS.md)",
    });
    let t = await send(bpPrompt, { mode: "agent" });
    track(t);
    if (t.status !== "finished") return stop("run-failed", "blueprint turn did not finish");
    io.commit("blueprint: design, red tests, stubs, tasks, qa");
    let bpReport = lenientJson<Parameters<typeof materialiseTasks>[0]>(t.result) ?? {};
    let missing = ["DESIGN.md", "TASKS.md", "QA.md"].filter((f) => !artifact(f));
    if (missing.length) {
      log(`architect did not write ${missing.join(", ")}; asking once more`);
      t = await send(`${WRITE_REMINDER(missing)}${bpPrompt}`, { mode: "agent" });
      track(t);
      if (t.status !== "finished") return stop("run-failed", "blueprint retry did not finish");
      io.commit("blueprint: design, red tests, stubs, tasks, qa");
      missing = ["DESIGN.md", "TASKS.md", "QA.md"].filter((f) => !artifact(f));
      const again = lenientJson<Parameters<typeof materialiseTasks>[0]>(t.result);
      if (again?.tasks?.length) bpReport = again;
    }
    if (missing.includes("TASKS.md")) {
      const made = materialiseTasks(bpReport);
      if (made) {
        io.writeFile("TASKS.md", made);
        io.commit("blueprint: TASKS.md (materialised from the architect's report)");
        log("materialised TASKS.md from the report");
      }
    }
    const tasksMd = artifact("TASKS.md");
    const qaMd = artifact("QA.md");
    state.tasks = tasksMd ? parseTasks(tasksMd) : [];
    state.scenarios = qaMd ? parseQaScenarios(qaMd) : [];
    if (!artifact("DESIGN.md")) return stop("blueprint-incomplete", "DESIGN.md missing");
    if (!state.tasks.length) return stop("blueprint-incomplete", "TASKS.md has no tasks");
    // Gaps the architect can fix in one targeted retry: an unlawful task (names a test or a
    // document under Files:, or no tests to turn green) or a requirement with no test, task, or scenario.
    const gapsOf = (): string[] => {
      const lines = validateTasks(state.tasks).map((p) => `- ${p.id}: ${p.problem}`);
      const trace = traceability(state.requirements, state.tasks, state.scenarios, io.listTests(), state.workflows);
      for (const u of trace.uncovered) {
        const qaNote = u.id.startsWith("W") ? "a QA scenario headed `## Qn (" + u.id + ")` that walks every step of the workflow" : "a QA scenario headed `## Qn (" + u.id + ")`";
        lines.push(`- ${u.id}: missing ${u.missing.map((m) => ({ test: "a test whose name contains the id", task: "a task listing it under Requirements:", qa: qaNote })[m]).join("; ")}`);
      }
      return lines;
    };
    let gaps = gapsOf();
    if (gaps.length) {
      log(`blueprint has gaps; asking the architect once more:\n${gaps.join("\n")}`);
      const note =
        `## Blueprint incomplete\n\nYour blueprint is on disk but the orchestrator found these gaps. Fix only these and commit, then reply with the same JSON block. ` +
        `Rules: tests are written by you now and never listed under a task's Files:; every task names the source files it may write and the tests that must go green; ` +
        `every requirement id appears in a test name, a task's Requirements:, and a QA scenario heading; every workflow id has a QA scenario.\n\n${gaps.join("\n")}\n\n---\n\n`;
      const t2 = await send(`${note}${bpPrompt}`, { mode: "agent" });
      track(t2);
      if (t2.status !== "finished") return stop("run-failed", "blueprint retry did not finish");
      io.commit("blueprint: gap fixes");
      state.tasks = parseTasks(artifact("TASKS.md") ?? "");
      state.scenarios = parseQaScenarios(artifact("QA.md") ?? "");
      gaps = gapsOf();
      if (gaps.length) return stop("blueprint-incomplete", gaps.join("; "));
    }
    if (state.jobKind !== "maintain" && state.quality?.bar.test) {
      const red = await io.runCommand(state.quality.bar.test);
      if (red.code === 0) return stop("blueprint-incomplete", "the test suite is already green before any implementation; the blueprint wrote no red tests");
    }
    state.baselineSha = io.headSha();
    log(`blueprint: ${state.tasks.length} tasks, ${state.scenarios.length} QA scenarios, baseline ${state.baselineSha.slice(0, 8)}`);
    state.phase = "tasks";
    state.taskIndex = 0;
    await persist();
  }

  // ---- Stage 2: crew tasks, gated -----------------------------------------
  if (state.phase === "tasks") {
    // TASKS.md on disk is the source of truth (an operator may correct an architect-owned document
    // between resumes); the persisted copy is only a cache.
    const onDisk = artifact("TASKS.md");
    if (onDisk) {
      const parsed = parseTasks(onDisk);
      if (parsed.length) state.tasks = parsed;
    }
    const design = artifact("DESIGN.md") ?? "";
    for (; state.taskIndex < state.tasks.length; state.taskIndex++) {
      const task = state.tasks[state.taskIndex]!;
      log(`task ${task.id} (${state.taskIndex + 1}/${state.tasks.length}): ${task.title}`);
      const baseSha = io.headSha();
      const redCmd = task.commands[0] ?? state.quality?.bar.test ?? "";
      const red = redCmd ? await io.runCommand(redCmd) : { code: 1, output: "" };
      const base = buildPrompt(`${PROMPTS}/task`, "", {
        task_id: task.id,
        task_block: task.body,
        design_excerpt: designExcerptFor(design, task),
        red_output: tail(red.output) || "(no output)",
      });
      let prompt = base;
      // A resumed run re-attempts the task that stopped it; keep one record per task.
      state.taskRecords = state.taskRecords.filter((r) => r.id !== task.id);
      const record: TaskRecord = { id: task.id, attempts: 0, gatePassed: false };
      let passed = false;
      for (let attempt = 0; attempt <= retries; attempt++) {
        record.attempts = attempt + 1;
        const t = await send(prompt, { mode: "agent" });
        track(t);
        record.report = extractJsonBlock(t.result);
        if (t.status !== "finished") {
          state.taskRecords.push(record);
          return stop("run-failed", `task ${task.id} turn did not finish`);
        }
        io.commit(`crew: ${task.id} attempt ${attempt + 1}`);
        // This task's commands plus every already-passed task's: earlier green tests must stay green,
        // but the whole suite is red by design until the last task, so the bar's `test` waits for the finish gate.
        const taskCommands = unionFiles(...state.taskRecords.filter((r) => r.gatePassed).map((r) => state.tasks.find((k) => k.id === r.id)?.commands ?? []), task.commands);
        const gate = await io.gate("task", { allowedFiles: task.files, baseSha, taskCommands });
        record.failing = gate.findings.filter((f) => !f.ok).map((f) => f.rule);
        log(`gate ${task.id}: ${gate.passed ? "PASS" : `FAIL (${[...new Set(record.failing)].join(", ")})`} attempt ${attempt + 1}`);
        if (gate.passed) {
          passed = true;
          break;
        }
        prompt = `${gateFeedbackNote(attempt + 1, gate)}${base}`;
      }
      record.gatePassed = passed;
      state.taskRecords.push(record);
      await persist();
      if (!passed) return stop("gate-failed", `task ${task.id} failed the gate after ${record.attempts} attempt(s): ${[...new Set(record.failing)].join(", ")}`);
    }
    state.phase = "finish";
    await persist();
  }

  const allTaskFiles = unionFiles(...state.tasks.map((t) => t.files));

  // ---- Stage 3: finish gate ------------------------------------------------
  if (state.phase === "finish") {
    log("stage 3: finish gate");
    let gate = await io.gate("finish", { allowedFiles: allTaskFiles, baseSha: state.baselineSha });
    if (!gate.passed) {
      const findingsText = gate.findings.filter((f) => !f.ok).map((f) => `- [${f.rule}] ${f.detail}${f.command ? ` (\`${f.command}\`)` : ""}${f.output ? `\n  ${tail(f.output, 30).replace(/\n/g, "\n  ")}` : ""}`).join("\n");
      log(`finish gate failed: ${[...new Set(gate.findings.filter((f) => !f.ok).map((f) => f.rule))].join(", ")}; one crew fix turn`);
      const t = await send(buildPrompt(`${PROMPTS}/review-fix`, "", { findings: findingsText, allowed_files: allTaskFiles.join(", ") }), { mode: "agent" });
      track(t);
      if (t.status !== "finished") return stop("run-failed", "finish fix turn did not finish");
      io.commit("crew: finish-gate fixes");
      gate = await io.gate("finish", { allowedFiles: allTaskFiles, baseSha: state.baselineSha });
    }
    state.finishGate = { passed: gate.passed, failing: [...new Set(gate.findings.filter((f) => !f.ok).map((f) => f.rule))] };
    await persist();
    if (!gate.passed) return stop("gate-failed", `finish gate: ${state.finishGate.failing.join(", ")}`);
    state.phase = "qa";
    await persist();
  }

  // ---- Stage 4: QA on a fresh clone ----------------------------------------
  if (state.phase === "qa") {
    const batchSize = Math.max(1, opts.qaBatch ?? 4);
    for (;;) {
      log(`stage 4: QA (attempt ${state.qaAttempts + 1})`);
      const clone = await io.freshClone();
      const qaMd = artifact("QA.md") ?? "";
      const reqMd = artifact("REQUIREMENTS.md") ?? "";
      const readme = (artifact("README.md") ?? "(no README)").slice(0, 4000);
      // Small batches keep a local analyst inside its depth; every batch is one black-box run in the same fresh clone.
      const batches: QaScenario[][] = [];
      for (let i = 0; i < state.scenarios.length; i += batchSize) batches.push(state.scenarios.slice(i, i + batchSize));
      if (!batches.length) batches.push([]);
      const results: QaResult[] = [];
      let failedStage: string | undefined;
      for (const [bi, batch] of batches.entries()) {
        const scenarioMd = batch.length ? batch.map((q) => q.body).join("\n\n") : qaMd;
        // A browser only for a batch with a step on a page; a pipeline, database, CLI, or library job never gets one.
        const needsBrowser = scenarioNeedsBrowser(scenarioMd);
        const browser = needsBrowser && opts.browser === true;
        const prompt = buildPrompt(`${PROMPTS}/qa`, "", {
          qa_md: scenarioMd,
          requirements_md: reqMd,
          run_instructions: readme,
          browser_tools: browserToolNote(!needsBrowser ? "unneeded" : browser ? "available" : "absent"),
        });
        let report: QaReport | undefined;
        const attempts: { note: string; tier?: "claude" }[] = [
          { note: "" },
          { note: "## Your previous reply had no results block\n\nExecute the scenarios and end with the single fenced json block the Output section specifies. Nothing after it.\n\n---\n\n" },
        ];
        if (opts.qaFallbackTier === "claude") attempts.push({ note: "", tier: "claude" });
        for (const [ai, a] of attempts.entries()) {
          log(`qa batch ${bi + 1}/${batches.length}${ai ? ` (attempt ${ai + 1}${a.tier ? `, ${a.tier}` : ""})` : ""}: ${batch.map((q) => q.id).join(", ") || "all"}`);
          const t = await send(`${a.note}${prompt}`, { mode: "agent", fresh: true, cwd: clone, ...(browser ? { browser: true } : {}), ...(a.tier ? { tier: a.tier } : {}) });
          track(t);
          if (t.status !== "finished") continue;
          const r = lenientJson<QaReport>(t.result);
          if (r?.results && Array.isArray(r.results)) {
            report = r;
            break;
          }
        }
        if (!report) {
          failedStage = `QA batch ${bi + 1} returned no results block`;
          break;
        }
        results.push(...report.results);
      }
      if (failedStage) return stop("unparseable-report", failedStage);
      // An attempt counts once it produced a report. Dedupe by scenario id: an analyst that reports a
      // scenario twice keeps its first verdict, and a passing duplicate never erases a failure.
      state.qaAttempts++;
      const byId = new Map<string, QaResult>();
      for (const r of results) {
        const prev = byId.get(r.id);
        if (!prev || (prev.passed && !r.passed)) byId.set(r.id, r);
      }
      if (byId.size !== results.length) log(`qa: ${results.length - byId.size} duplicate result(s) collapsed`);
      results.splice(0, results.length, ...byId.values());
      const report: QaReport = {
        results,
        traceability: {
          covered: [...new Set(results.filter((r) => r.passed).map((r) => r.requirement))],
          uncovered: [...state.requirements.map((r) => r.id), ...state.workflows.map((w) => w.id)].filter((id) => !results.some((r) => r.requirement === id)),
        },
      };
      state.qa = report;
      await persist();
      const failed = report.results.filter((r) => !r.passed);
      const missing = state.scenarios.filter((s) => !report.results.some((r) => r.id === s.id));
      log(`qa: ${report.results.length - failed.length}/${report.results.length} passed${missing.length ? `, ${missing.length} scenario(s) not reported` : ""}`);
      if (!failed.length && !missing.length) break;
      if (state.qaAttempts >= 2) return stop("qa-failed", `QA still failing: ${[...failed.map((f) => f.id), ...missing.map((m) => m.id)].join(", ")}`);
      const defects = failed.map((f) => `- ${f.id} (${f.requirement}): observed ${JSON.stringify(f.defect?.observed ?? f.evidence ?? "")}; expected ${JSON.stringify(f.defect?.expected ?? "")}; where ${f.defect?.where ?? "unknown"}`).join("\n")
        + (missing.length ? `\n- not executed: ${missing.map((m) => m.id).join(", ")} — run them` : "");
      const whereFiles = failed.map((f) => f.defect?.where).filter((w): w is string => Boolean(w && /[/.]/.test(w) && !/\s/.test(w)));
      const allowed = unionFiles(allTaskFiles, whereFiles);
      const baseSha = io.headSha();
      const fix = await send(buildPrompt(`${PROMPTS}/qa-fix`, "", { defects, allowed_files: allowed.join(", ") }), { mode: "agent" });
      track(fix);
      if (fix.status !== "finished") return stop("run-failed", "QA fix turn did not finish");
      io.commit("crew: qa fixes");
      const gate = await io.gate("task", { allowedFiles: allowed, baseSha });
      if (!gate.passed) return stop("gate-failed", `qa fix failed the gate: ${[...new Set(gate.findings.filter((f) => !f.ok).map((f) => f.rule))].join(", ")}`);
    }
    state.phase = "review";
    await persist();
  }

  // ---- Stage 5: independent review -----------------------------------------
  if (state.phase === "review") {
    log("stage 5: review (fresh session, read-only)");
    const base = state.baselineSha ?? "HEAD~1";
    const t = await send(
      buildPrompt(`${PROMPTS}/review`, "", {
        job: opts.job,
        base,
        diff_stat: io.diffStat(base) || "(no diff)",
        gates: gateSummary(state.taskRecords, state.finishGate),
        qa_report: JSON.stringify(state.qa ?? {}, null, 2),
        claims: JSON.stringify(state.taskRecords.map((r) => ({ id: r.id, report: r.report })), null, 2),
      }),
      { mode: "agent", fresh: true },
    );
    track(t);
    if (t.status !== "finished") return stop("run-failed", "review turn did not finish");
    const review = extractJsonBlock<ReviewReport>(t.result);
    if (!review || !Array.isArray(review.findings) || !review.verdict) return stop("unparseable-report", "review returned no findings block");
    state.review = review;
    await persist();
    const high = review.findings.filter((f) => f.severity === "high");
    log(`review: ${review.verdict}, ${review.findings.length} finding(s), ${high.length} high`);
    if (high.length) {
      const allowed = unionFiles(allTaskFiles, high.map((f) => f.file));
      const baseSha = io.headSha();
      const fix = await send(
        buildPrompt(`${PROMPTS}/review-fix`, "", { findings: JSON.stringify(high, null, 2), allowed_files: allowed.join(", ") }),
        { mode: "agent" },
      );
      track(fix);
      if (fix.status !== "finished") return stop("run-failed", "review fix turn did not finish");
      io.commit("crew: review fixes");
      const gate = await io.gate("task", { allowedFiles: allowed, baseSha });
      if (!gate.passed) return stop("review-unresolved", `review fix failed the gate: ${[...new Set(gate.findings.filter((f) => !f.ok).map((f) => f.rule))].join(", ")}`);
      state.reviewChecks = [];
      for (const f of high) {
        if (!f.check?.command) continue;
        const r = await io.runCommand(f.check.command);
        const expected = f.check.expect_exit ?? 0;
        state.reviewChecks.push({ id: f.id, command: f.check.command, expected, actual: r.code });
      }
      await persist();
      const unresolved = state.reviewChecks.filter((c) => c.actual !== c.expected);
      if (unresolved.length) return stop("review-unresolved", `checks failed: ${unresolved.map((c) => `${c.id} (${c.command} -> ${c.actual}, expected ${c.expected})`).join("; ")}`);
    }
    state.phase = "done";
    return stop("complete", undefined, "done");
  }

  return stop((state.stopReason as BlueprintStopReason) ?? "run-failed", "loop entered with no runnable phase", state.phase);
}
