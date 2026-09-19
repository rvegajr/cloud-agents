import type { SendFn, TurnResult } from "../../src/lib/build-loop.js";
import { buildPrompt } from "../../src/lib/prompts.js";
import { lenientJson, type BlueprintIO } from "../../architect-crew-gate/src/blueprint-loop.js";
import { browserToolNote, scenarioNeedsBrowser } from "../../architect-crew-gate/src/browser.js";
import { gateFeedbackNote, type GateResult } from "../../architect-crew-gate/src/quality-gate.js";
import { fileLessonsStore, priorLessonsNote, tagsForProblem, type LessonsStore, type NewLesson } from "./lessons.js";
import { ARTIFACTS, parsePlan, parseProblem, problemGaps, renderPlan, renderProblem, validateUnits, type DoneCheck, type Plan, type Problem, type Unit } from "./plan.js";

/**
 * The polya-craft loop (PATTERN.md section 4), engine-free so a fake `send`
 * and a fake `io` drive it in tests.
 *
 *   understand → devise (plan-lint) → carry out ×units (gate after each)
 *   → look back: (a) checks from a clean state, (b) a stranger walks the
 *   outer test, (c) fresh-session review, (d) LOOKBACK.md + ledger, always.
 *
 * Nothing here trusts a model's report as a verdict. `io.gate` decides a
 * unit, `io.runCommand` decides a done-check and a finding's check, the
 * Verifier runs in a clone the Hand never touched, and LOOKBACK.md is written
 * by this loop from evidence, not by the reviewer.
 */

export type PolyaIO = BlueprintIO & {
  /** Start a long-running command (the quality bar's `start`) in `cwd`; resolve once it has had time to listen. The loop stops it. */
  start?(command: string, cwd: string): Promise<{ stop(): void }>;
  /** Put every file changed since `baseSha` that is not in `allowed` back as it was, and commit. Returns what was reverted. */
  revertOutside?(baseSha: string, allowed: string[]): string[];
};

/** A done-check that curls a server needs the server running. */
const NEEDS_SERVER = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b|:\d{4,5}\//;

export type PolyaPhase = "understand" | "devise" | "carry-out" | "look-back" | "done" | "stopped";

export type PolyaStopReason =
  | "complete"
  | "understanding-incomplete"
  | "plan-not-workable"
  | "unit-not-workable"
  | "unit-gate-failed"
  | "finish-check-failed"
  | "verify-failed"
  | "review-unresolved"
  | "unparseable-report"
  | "run-failed";

export interface UnitRecord {
  id: string;
  attempts: number;
  passed: boolean;
  failing?: string[];
  report?: unknown;
  question?: string;
}

export interface CheckResult {
  id: string;
  passed: boolean;
  how: "mechanical" | "verifier";
  evidence?: string;
  where?: string;
}

export interface LookBackFinding {
  severity: "high" | "medium" | "low";
  where?: string;
  what: string;
  fix?: string;
  check?: { command: string; expect_exit?: number };
}

export interface LookBackReport {
  verdict: "done" | "fix" | "stop";
  answers_problem?: boolean;
  another_check?: string;
  findings: LookBackFinding[];
  worked?: string[];
  did_not?: string[];
  confirmed?: string[];
  lessons?: NewLesson[];
}

export interface PolyaState {
  phase: PolyaPhase;
  /** Cache; PROBLEM.md on disk wins on resume. */
  problem?: Problem;
  units: Unit[];
  unitIndex: number;
  unitRecords: UnitRecord[];
  /** HEAD after PLAN.md and the red tests were committed. */
  baselineSha?: string;
  /** A Hand's question, carried into the next Devise turn on resume. */
  replanNote?: string;
  finish?: { passed: boolean; failing: string[] };
  checks?: CheckResult[];
  verifyAttempts: number;
  review?: LookBackReport;
  reviewChecks?: { command: string; expected: number; actual: number }[];
  lookback?: { written: boolean; lessons: number; confirmed: number };
  runIds: string[];
  stopReason?: PolyaStopReason;
  stopDetail?: string;
}

export interface PolyaOptions {
  problem: string;
  repo: string;
  io: PolyaIO;
  /** The ledger. Default: the file store at POLYA_LESSONS_FILE or polya-craft/LESSONS.md. `null` = no ledger. */
  lessons?: LessonsStore | null;
  maxUnits?: number;
  /** Gate retries per unit turn, each with the gate's feedback prepended. */
  unitRetries?: number;
  /** After the cheap Verifier fails to report twice, run it on this tier. */
  verifyFallbackTier?: "claude";
  /** Software problems: unit Checks must be commands and the quality bar must name `test`. Default true. */
  software?: boolean;
  /** The engine can give a turn a real browser (Playwright MCP); a unit or a done-check that names a page is sent with `browser: true`. */
  browser?: boolean;
  onState?: (state: PolyaState) => void | Promise<void>;
  log?: (line: string) => void;
}

const PROMPTS = "polya-craft/prompts";
const FENCE = "```";

const WRITE_REMINDER = (missing: string): string =>
  `## You did not write ${missing}\n\n` +
  `Your previous attempt printed its answer but left the working tree untouched: ${missing} does not exist on disk. ` +
  `The orchestrator reads files, not your message. Create it with your file-writing tool, commit, then reply again with the same JSON block.\n\n---\n\n`;

export function initialPolyaState(): PolyaState {
  return { phase: "understand", units: [], unitIndex: 0, unitRecords: [], verifyAttempts: 0, runIds: [] };
}

/** Where a stopped run resumes: the stage that stopped, not the beginning. */
export function polyaResumePhase(state: PolyaState): PolyaPhase {
  if (state.phase !== "stopped") return state.phase;
  switch (state.stopReason) {
    case "understanding-incomplete":
      return "understand";
    case "plan-not-workable":
    case "unit-not-workable":
      return "devise";
    case "unit-gate-failed":
      return "carry-out";
    case "finish-check-failed":
    case "verify-failed":
    case "review-unresolved":
      return "look-back";
    case "unparseable-report":
      return state.units.length ? (state.unitIndex < state.units.length ? "carry-out" : "look-back") : state.problem ? "devise" : "understand";
    default:
      return state.units.length ? "carry-out" : "understand";
  }
}

function tail(text: string, lines = 60): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

function union(...lists: (string[] | undefined)[]): string[] {
  return [...new Set(lists.flat().filter((f): f is string => Boolean(f)))];
}

function failingRules(gate: GateResult): string[] {
  return [...new Set(gate.findings.filter((f) => !f.ok).map((f) => f.rule))];
}

function gateSummary(records: UnitRecord[], finish?: PolyaState["finish"]): string {
  const lines = records.map((r) => `- ${r.id}: ${r.passed ? "PASS" : "FAIL"} after ${r.attempts} attempt(s)${r.failing?.length ? ` (${r.failing.join(", ")})` : ""}${r.question ? ` — asked: ${r.question}` : ""}`);
  if (finish) lines.push(`- finish check: ${finish.passed ? "PASS" : `FAIL (${finish.failing.join(", ")})`}`);
  return lines.join("\n") || "(no gate records)";
}

/** The done-check lines a unit serves, for its packet. */
function doneLines(problem: Problem | undefined, unit: Unit): string {
  const lines = (problem?.done ?? []).filter((d) => unit.serves.includes(d.id)).map((d) => `- ${d.id}: ${d.text} — Check: ${d.check}`);
  return lines.join("\n") || "(no done-check named)";
}

function unitBlockForFix(id: string, what: string, touches: string[], check: string): string {
  return `## ${id}: fix what the look back found\nServes:   (the findings below)\nProduces: the fix\nGiven:    the findings, verbatim:\n${what.split("\n").map((l) => `          ${l}`).join("\n")}\nDo:       1. Fix the cause of each finding, not the check. 2. Run Check.\nTouches:  ${touches.join(", ")}\nCheck:    ${check} — Now: unmet\nDepends:  none\nNot:      any file not under Touches; any test or check.`;
}

/** LOOKBACK.md, rendered by the loop from evidence (PATTERN.md section 2.3). */
export function renderLookback(state: PolyaState, problem: Problem | undefined, added: { id: string }[] = []): string {
  const title = problem?.title ?? "(untitled)";
  const results = (problem?.done ?? []).map((d) => {
    const c = state.checks?.find((x) => x.id === d.id);
    const met = c ? c.passed : undefined;
    return `| ${d.id} | ${met === undefined ? "not run" : met ? "yes" : "no"} | ${c?.evidence ?? c?.where ?? (c ? c.how : "")} |`;
  });
  const r = state.review;
  const findings = (r?.findings ?? []).map((f) => `  - [${f.severity}] ${f.where ?? ""} — ${f.what}${f.fix ? ` — fix: ${f.fix}` : ""}${f.check?.command ? ` — check: \`${f.check.command}\`` : ""}`);
  const didNot = [
    ...(r?.did_not ?? []),
    ...state.unitRecords.filter((u) => u.attempts > 1 || !u.passed || u.question).map((u) => `${u.id}: ${u.question ? `asked "${u.question}"` : `${u.attempts} attempt(s)${u.failing?.length ? `, ${u.failing.join(", ")}` : ""}${u.passed ? "" : ", not passed"}`}`),
  ];
  const lessons = (r?.lessons ?? []).map((l, i) => `## ${added[i]?.id ?? "(not appended)"}\nTags:     ${l.tags.join(" ")}\nWhen:     ${l.when}\nLesson:   ${l.lesson}\nEvidence: ${l.evidence}\nStatus:   candidate`);
  return (
    `# Look back: ${title}\n\n` +
    `Outcome: ${state.stopReason ?? "in progress"}${state.stopDetail ? ` — ${state.stopDetail}` : ""}\n\n` +
    `## Result\n| D | Met | Evidence |\n| --- | --- | --- |\n${results.join("\n") || "| — | — | — |"}\n\n` +
    `## Judgment\n- Answers the restated problem: ${r ? (r.answers_problem === false ? "no" : "yes") : "not reviewed"}\n- Another way to check it: ${r?.another_check ?? ""}\n- Findings:\n${findings.join("\n") || "  - none"}\n\n` +
    `## What worked\n${(r?.worked ?? []).map((w) => `- ${w}`).join("\n") || "- (not recorded)"}\n\n` +
    `## What did not\n${didNot.map((w) => `- ${w}`).join("\n") || "- nothing: every unit passed first time"}\n\n` +
    `## Lessons\n${lessons.join("\n\n") || "No lesson: the plan held."}\n\n` +
    (r?.confirmed?.length ? `Confirmed: ${r.confirmed.join(", ")}\n\n` : "") +
    `## Units\n${gateSummary(state.unitRecords, state.finish)}\n\n` +
    `${FENCE}json lookback\n${JSON.stringify({ verdict: r?.verdict ?? (state.stopReason === "complete" ? "done" : "stop"), results: (problem?.done ?? []).map((d) => ({ id: d.id, met: state.checks?.find((x) => x.id === d.id)?.passed ?? null })), findings: r?.findings ?? [], lessons: added.map((a) => a.id), confirmed: r?.confirmed ?? [] }, null, 2)}\n${FENCE}\n`
  );
}

export async function runPolyaLoop(send: SendFn, opts: PolyaOptions, initial?: Partial<PolyaState>): Promise<PolyaState & { stopReason: PolyaStopReason }> {
  const log = opts.log ?? (() => {});
  const io = opts.io;
  const retries = opts.unitRetries ?? 2;
  const maxUnits = opts.maxUnits ?? 8;
  const software = opts.software ?? true;
  const lessons: LessonsStore | undefined = opts.lessons === null ? undefined : (opts.lessons ?? fileLessonsStore());
  const state: PolyaState = { ...initialPolyaState(), ...initial };
  const persist = async () => opts.onState?.(state);
  const artifact = (name: string) => io.readFile(name);
  const track = (t: TurnResult) => {
    if (t.runId) state.runIds.push(t.runId);
  };
  const readProblem = (): Problem | undefined => {
    const md = artifact(ARTIFACTS.problem);
    const p = md ? parseProblem(md) : undefined;
    if (p) state.problem = p;
    return state.problem;
  };
  const readPlan = (): Plan | undefined => {
    const md = artifact(ARTIFACTS.plan);
    return md ? parsePlan(md) : undefined;
  };

  /** (d): always, even after a stop inside look back. Written from evidence; the reviewer never writes it. */
  let lookbackWritten = false;
  const writeLookback = async (): Promise<void> => {
    if (lookbackWritten) return;
    lookbackWritten = true;
    const problem = state.problem ?? readProblem();
    const report = state.review;
    let added: { id: string }[] = [];
    let confirmed = 0;
    if (lessons) {
      try {
        // "No lesson: the plan held" is an entry in LOOKBACK.md, never in the ledger.
        const real = (report?.lessons ?? []).filter((l) => l && l.lesson && !/^\s*no lesson\b/i.test(l.lesson));
        if (real.length) added = lessons.append(real.map((l) => ({ tags: l.tags ?? [], when: l.when ?? problem?.title ?? "", lesson: l.lesson, evidence: l.evidence ?? problem?.title ?? "" })));
        if (report?.confirmed?.length) {
          lessons.confirm(report.confirmed);
          confirmed = report.confirmed.length;
        }
      } catch (err) {
        log(`ledger: could not write (${(err as Error).message})`);
      }
    }
    io.writeFile(ARTIFACTS.lookback, renderLookback(state, problem, added));
    io.commit("look back: LOOKBACK.md");
    state.lookback = { written: true, lessons: added.length, confirmed };
    log(`look back written: ${added.length} lesson(s) appended, ${confirmed} confirmed`);
  };

  const stop = async (reason: PolyaStopReason, detail?: string, phase: PolyaPhase = "stopped") => {
    state.stopReason = reason;
    state.stopDetail = detail;
    if (state.phase === "look-back" || phase === "done") await writeLookback();
    state.phase = phase;
    log(`stop: ${reason}${detail ? ` — ${detail}` : ""}`);
    await persist();
    return { ...state, stopReason: reason };
  };

  /** A Solver turn that must leave an artifact on disk: send → commit → write reminder once → materialise from the report. */
  const strongTurn = async <R>(prompt: string, file: string, commitMsg: string, render: (report: R) => string | undefined): Promise<{ turn: TurnResult; report: R | undefined } | PolyaStopReason> => {
    let t = await send(prompt, { mode: "agent" });
    track(t);
    if (t.status !== "finished") return "run-failed";
    io.commit(commitMsg);
    let report = lenientJson<R>(t.result);
    if (!artifact(file)) {
      log(`the Solver did not write ${file}; asking once more`);
      t = await send(`${WRITE_REMINDER(file)}${prompt}`, { mode: "agent" });
      track(t);
      if (t.status !== "finished") return "run-failed";
      io.commit(commitMsg);
      report = lenientJson<R>(t.result) ?? report;
    }
    if (!artifact(file) && report) {
      const made = render(report);
      if (made) {
        io.writeFile(file, made);
        io.commit(`${commitMsg} (materialised from the Solver's report)`);
        log(`materialised ${file} from the report`);
      }
    }
    return { turn: t, report };
  };

  /** One Hand turn on a unit or a fix, gated; the gate's feedback is fed back up to `retries` times. */
  const handTurn = async (unit: { id: string; block: string; touches: string[]; command?: string }, excerpt: string, taskCommands: string[], tier?: "claude"): Promise<{ record: UnitRecord; gate?: GateResult; blocked?: string } | "run-failed"> => {
    const baseSha = io.headSha();
    const red = unit.command ? await io.runCommand(unit.command) : { code: 1, output: "" };
    // A unit whose steps happen on a page gets the browser for that turn only; a library or CLI unit never does.
    const needsBrowser = scenarioNeedsBrowser(unit.block);
    const browser = needsBrowser && opts.browser === true;
    const base = buildPrompt(`${PROMPTS}/carry-out`, "", {
      unit_id: unit.id,
      unit_block: unit.block,
      problem_excerpt: excerpt,
      red_output: tail(red.output) || "(no output)",
      browser_tools: browserToolNote(!needsBrowser ? "unneeded" : browser ? "available" : "absent"),
    });
    let prompt = base;
    const record: UnitRecord = { id: unit.id, attempts: 0, passed: false };
    let gate: GateResult | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      record.attempts = attempt + 1;
      const t = await send(prompt, { mode: "agent", ...(tier ? { tier } : {}), ...(browser ? { browser: true } : {}) });
      track(t);
      if (t.status !== "finished") return "run-failed";
      const report = lenientJson<{ blocked?: boolean; question?: string }>(t.result);
      record.report = report;
      io.commit(`carry out: ${unit.id} attempt ${attempt + 1}`);
      if (report?.blocked && report.question) {
        record.question = report.question;
        return { record, blocked: report.question };
      }
      gate = await io.gate("task", { allowedFiles: unit.touches, baseSha, taskCommands });
      record.failing = failingRules(gate);
      log(`gate ${unit.id}: ${gate.passed ? "PASS" : `FAIL (${record.failing.join(", ")})`} attempt ${attempt + 1}`);
      if (gate.passed) {
        record.passed = true;
        return { record, gate };
      }
      // Rule 1 of the pattern is enforced by the orchestrator, not delegated: what the Hand wrote outside
      // Touches is put back, so the next attempt starts inside its scope and is told why.
      let revertNote = "";
      if (record.failing.includes("ownership") && io.revertOutside) {
        const reverted = io.revertOutside(baseSha, unit.touches);
        if (reverted.length) {
          log(`reverted outside Touches: ${reverted.join(", ")}`);
          revertNote = `## Files outside Touches were reverted\n\nThe orchestrator put ${reverted.join(", ")} back as they were. Only ${unit.touches.join(", ")} may change. If the unit cannot be done inside them, say so in \`notes\` and stop.\n\n`;
        }
      }
      prompt = `${revertNote}${gateFeedbackNote(attempt + 1, gate)}${base}`;
    }
    return { record, gate };
  };

  // ---- 1. Understand --------------------------------------------------------
  if (state.phase === "understand") {
    log("understand");
    const offered = lessons ? lessons.select(tagsForProblem(opts.problem, opts.repo)) : [];
    const prompt = buildPrompt(`${PROMPTS}/understand`, "", {
      problem: opts.problem,
      repo: opts.repo,
      prior_lessons: priorLessonsNote(offered, artifact(ARTIFACTS.lookback)),
    });
    const gapsOf = () => problemGaps(readProblem(), { maxDone: 8, software, offeredLessons: offered.map((l) => l.id) });
    // Already on disk (a resume, or a person wrote it): do not pay for the full turn again. Gaps get the one targeted retry below.
    if (artifact(ARTIFACTS.problem)) {
      log(`${ARTIFACTS.problem} is on disk; ${gapsOf().length ? "it has gaps, asking the Solver to fix only those" : "skipping the Solver turn"}`);
    } else {
      const r = await strongTurn<Parameters<typeof renderProblem>[0]>(prompt, ARTIFACTS.problem, "understand: PROBLEM.md", renderProblem);
      if (typeof r === "string") return stop(r, "understand turn did not finish");
    }
    let problem = readProblem();
    if (!problem) return stop("unparseable-report", `${ARTIFACTS.problem} is missing or has no title`);
    let gaps = gapsOf();
    if (gaps.length) {
      log(`understanding has gaps; asking the Solver once more:\n${gaps.join("\n")}`);
      const note = `## Understanding incomplete\n\n${ARTIFACTS.problem} is on disk but the orchestrator found these gaps. Fix only these, commit, then reply with the same JSON block.\n\n${gaps.join("\n")}\n\n---\n\n`;
      const t = await send(`${note}${prompt}`, { mode: "agent" });
      track(t);
      if (t.status !== "finished") return stop("run-failed", "understand retry did not finish");
      io.commit("understand: gap fixes");
      gaps = gapsOf();
      if (gaps.length) return stop("understanding-incomplete", gaps.join("; "));
    }
    problem = state.problem!;
    log(`understood: "${problem.title}" (${problem.kind ?? "kind ?"}, ${problem.size ?? "size ?"}); ${problem.done.length} done-check(s), ${problem.done.filter((d) => d.command).length} mechanical; ${problem.lessons.length} lesson(s) consulted`);
    state.phase = "devise";
    await persist();
  }

  // ---- 2. Devise ------------------------------------------------------------
  if (state.phase === "devise") {
    log("devise");
    const problem = readProblem();
    if (!problem) return stop("unparseable-report", `${ARTIFACTS.problem} missing at devise`);
    const problemMd = artifact(ARTIFACTS.problem) ?? "";
    const carried = problem.done.map((d) => d.id);
    const replan = state.replanNote ? `## Re-plan\n\nThe previous plan stopped because a Hand had to ask a question. ${state.replanNote}\n\nRewrite the unit it names so the question is answered inside the unit; leave the units that already passed unchanged.\n\n---\n\n` : "";
    const prompt = `${replan}${buildPrompt(`${PROMPTS}/devise`, "", { problem_md: problemMd, max_units: String(maxUnits), done_ids: carried.join(" ") })}`;
    const exists = (p: string) => artifact(p) !== undefined;
    const gapsOf = (): string[] => {
      const plan = readPlan();
      if (!plan) return [`- ${ARTIFACTS.plan} missing`];
      state.units = plan.units;
      const lines = validateUnits(plan.units, problem, { requireCommand: software, exists, doneIds: carried }).map((p) => `- ${p.id}: ${p.problem}`);
      if (!plan.units.length) lines.push("- no units under `## Units`");
      if (plan.units.length > maxUnits) lines.push(`- ${plan.units.length} units; at most ${maxUnits}. Split the problem into sub-problems`);
      if (!plan.outer.length) lines.push("- no `## Outer test` steps");
      return lines;
    };
    // Already on disk and no question to re-plan for: do not pay for the full turn again. Gaps get the one targeted retry below.
    if (artifact(ARTIFACTS.plan) && !state.replanNote) {
      log(`${ARTIFACTS.plan} is on disk; ${gapsOf().length ? "it has gaps, asking the Solver to fix only those" : "skipping the Solver turn"}`);
    } else {
      const r = await strongTurn<Parameters<typeof renderPlan>[0]>(prompt, ARTIFACTS.plan, "devise: PLAN.md", renderPlan);
      if (typeof r === "string") return stop(r, "devise turn did not finish");
      state.replanNote = undefined;
    }
    let gaps = gapsOf();
    if (gaps.length) {
      log(`plan is not workable; asking the Solver once more:\n${gaps.join("\n")}`);
      const note = `## Plan not workable\n\n${ARTIFACTS.plan} is on disk but these units fail the stranger test or the plan rules. Fix only these, commit, then reply with the same JSON block.\n\n${gaps.join("\n")}\n\n---\n\n`;
      const t = await send(`${note}${prompt}`, { mode: "agent" });
      track(t);
      if (t.status !== "finished") return stop("run-failed", "devise retry did not finish");
      io.commit("devise: gap fixes");
      gaps = gapsOf();
      if (gaps.length) return stop("plan-not-workable", gaps.join("; "));
    }
    // A first plan must leave the suite red. A re-plan after a Hand's question keeps the units that passed, so the suite may be partly green.
    const anyPassed = state.unitRecords.some((r) => r.passed);
    if (software && problem.bar.test && !anyPassed) {
      const red = await io.runCommand(problem.bar.test);
      if (red.code === 0) return stop("plan-not-workable", "the test suite is already green before any unit ran; every Check must be unmet now (write the red tests at Devise)");
    }
    state.baselineSha = io.headSha();
    state.unitIndex = 0;
    log(`plan: ${state.units.length} unit(s), baseline ${state.baselineSha.slice(0, 8)}`);
    state.phase = "carry-out";
    await persist();
  }

  // ---- 3. Carry out ---------------------------------------------------------
  if (state.phase === "carry-out") {
    // PLAN.md on disk is the source of truth; the persisted units are a cache.
    const plan = readPlan();
    if (plan?.units.length) state.units = plan.units;
    const problem = readProblem();
    for (; state.unitIndex < state.units.length; state.unitIndex++) {
      const unit = state.units[state.unitIndex]!;
      if (state.unitRecords.some((r) => r.id === unit.id && r.passed)) {
        log(`carry out ${unit.id}: already passed; kept`);
        continue;
      }
      log(`carry out ${unit.id} (${state.unitIndex + 1}/${state.units.length}): ${unit.title}`);
      state.unitRecords = state.unitRecords.filter((r) => r.id !== unit.id);
      const excerpt = `${problem?.restated ?? ""}\n\nDone-checks this unit serves:\n${doneLines(problem, unit)}`;
      const passedCommands = state.unitRecords.filter((r) => r.passed).map((r) => state.units.find((u) => u.id === r.id)?.command).filter((c): c is string => Boolean(c));
      const taskCommands = union(passedCommands, unit.command ? [unit.command] : []);
      const strong = /^\s*strong\s*$/i.test(unit.body.match(/^Owner:\s*(.*)$/im)?.[1] ?? "");
      const r = await handTurn({ id: unit.id, block: unit.body, touches: unit.touches, command: unit.command }, excerpt, taskCommands, strong ? "claude" : undefined);
      if (r === "run-failed") return stop("run-failed", `unit ${unit.id} turn did not finish`);
      state.unitRecords.push(r.record);
      await persist();
      if (r.blocked) {
        state.replanNote = `Unit ${unit.id} asked: "${r.blocked}"`;
        if (lessons) {
          try {
            lessons.append([{ tags: [`kind:${problem?.kind ?? "build"}`, "stage:devise", "source:hand-question"], when: problem?.title ?? opts.problem.slice(0, 80), lesson: `Unit ${unit.id} was not workable; the Hand asked: ${r.blocked}. Decide it in the unit next time.`, evidence: `${problem?.title ?? "this problem"}, ${unit.id}` }]);
          } catch {
            /* the ledger is optional */
          }
        }
        return stop("unit-not-workable", `${unit.id} asked: ${r.blocked}`);
      }
      if (!r.record.passed) return stop("unit-gate-failed", `${unit.id} failed the gate after ${r.record.attempts} attempt(s): ${(r.record.failing ?? []).join(", ")}`);
    }
    state.phase = "look-back";
    await persist();
  }

  const allTouches = union(...state.units.map((u) => u.touches));
  // The finish check spans the whole job; the loop's own artifacts (written on an earlier pass, or corrected by hand) are not the Hand's doing.
  const finishAllowed = union(allTouches, [ARTIFACTS.problem, ARTIFACTS.plan, ARTIFACTS.lookback]);

  // ---- 4. Look back ---------------------------------------------------------
  if (state.phase === "look-back") {
    const problem = readProblem();
    const plan = readPlan();
    if (!problem) return stop("unparseable-report", `${ARTIFACTS.problem} missing at look back`);

    // (a) the finish check: ownership over the whole job, hygiene, the bar, clean start, vacuous suite.
    log("look back (a): checks from a clean state");
    let gate = await io.gate("finish", { allowedFiles: finishAllowed, baseSha: state.baselineSha });
    if (!gate.passed) {
      const what = gate.findings.filter((f) => !f.ok).map((f) => `- [${f.rule}] ${f.detail}${f.command ? ` (\`${f.command}\`)` : ""}${f.output ? `\n  ${tail(f.output, 30).replace(/\n/g, "\n  ")}` : ""}`).join("\n");
      log(`finish check failed: ${failingRules(gate).join(", ")}; one fix turn`);
      const fix = await handTurn({ id: "U-FIX", block: unitBlockForFix("U-FIX", what, allTouches, problem.bar.test ?? "the finish check"), touches: allTouches }, problem.restated ?? "", []);
      if (fix === "run-failed") return stop("run-failed", "finish fix turn did not finish");
      state.unitRecords.push(fix.record);
      if (!fix.record.passed) {
        state.finish = { passed: false, failing: fix.record.failing ?? failingRules(gate) };
        return stop("finish-check-failed", `fix turn failed the gate: ${state.finish.failing.join(", ")}`);
      }
      gate = await io.gate("finish", { allowedFiles: finishAllowed, baseSha: state.baselineSha });
    }
    state.finish = { passed: gate.passed, failing: failingRules(gate) };
    await persist();
    if (!gate.passed) return stop("finish-check-failed", state.finish.failing.join(", "));

    // (b) every done-check from a fresh clone: commands mechanically, the rest by a stranger.
    for (;;) {
      state.verifyAttempts++;
      log(`look back (b): done-checks from a fresh clone (attempt ${state.verifyAttempts})`);
      const clone = await io.freshClone();
      if (problem.bar.install) await io.runCommand(problem.bar.install, clone);
      const checks: CheckResult[] = [];
      const mechanical = problem.done.filter((d) => d.command);
      // A check that curls the app needs the app up: start the bar's `start` in the clone for the duration of the checks.
      let running: { stop(): void } | undefined;
      if (problem.bar.start && io.start && mechanical.some((d) => NEEDS_SERVER.test(d.command!))) {
        log(`starting \`${problem.bar.start}\` in the clone for the done-checks`);
        running = await io.start(problem.bar.start, clone);
      }
      try {
        for (const d of mechanical) {
          const r = await io.runCommand(d.command!, clone);
          checks.push({ id: d.id, passed: r.code === 0, how: "mechanical", evidence: `\`${d.command}\` exited ${r.code}${r.code ? `: ${tail(r.output, 5)}` : ""}` });
        }
      } finally {
        running?.stop();
      }
      const prose: DoneCheck[] = problem.done.filter((d) => !d.command);
      if (prose.length) {
        const mechanical = checks.map((c) => `- ${c.id}: ${c.passed ? "PASS" : "FAIL"} — ${c.evidence}`).join("\n") || "(none)";
        const outer = plan?.outerText || prose.map((d) => `- ${d.id}: ${d.text} — Check: ${d.check}`).join("\n");
        const readme = (artifact("README.md") ?? "(no README)").slice(0, 4000);
        const outerFull = `${outer}\n\nDone-checks a stranger observes:\n${prose.map((d) => `- ${d.id}: ${d.text} — Check: ${d.check}`).join("\n")}`;
        const needsBrowser = scenarioNeedsBrowser(outerFull);
        const browser = needsBrowser && opts.browser === true;
        const prompt = buildPrompt(`${PROMPTS}/verify`, "", {
          outer_test: outerFull,
          mechanical_results: mechanical,
          run_instructions: readme,
          browser_tools: browserToolNote(!needsBrowser ? "unneeded" : browser ? "available" : "absent"),
        });
        const attempts: { note: string; tier?: "claude" }[] = [{ note: "" }, { note: "## Your previous reply had no results block\n\nWalk the steps and end with the single fenced json block the Output section specifies. Nothing after it.\n\n---\n\n" }];
        if (opts.verifyFallbackTier === "claude") attempts.push({ note: "", tier: "claude" });
        let report: { results?: { step?: number; d?: string; passed?: boolean; evidence?: string; where?: string }[] } | undefined;
        for (const [ai, a] of attempts.entries()) {
          log(`verifier${ai ? ` (attempt ${ai + 1}${a.tier ? `, ${a.tier}` : ""})` : ""}: ${prose.map((d) => d.id).join(", ")}`);
          const t = await send(`${a.note}${prompt}`, { mode: "agent", fresh: true, cwd: clone, ...(browser ? { browser: true } : {}), ...(a.tier ? { tier: a.tier } : {}) });
          track(t);
          if (t.status !== "finished") continue;
          const r = lenientJson<typeof report>(t.result);
          if (r?.results && Array.isArray(r.results)) {
            report = r;
            break;
          }
        }
        if (!report) return stop("unparseable-report", "the Verifier returned no results block");
        for (const d of prose) {
          const mine = report.results!.filter((r) => r.d === d.id);
          const passed = mine.length > 0 && mine.every((r) => r.passed);
          checks.push({ id: d.id, passed, how: "verifier", evidence: mine.map((r) => r.evidence).filter(Boolean).join("; ") || (mine.length ? "" : "not walked"), where: mine.find((r) => !r.passed)?.where });
        }
      }
      state.checks = checks;
      await persist();
      const failed = checks.filter((c) => !c.passed);
      log(`done-checks: ${checks.length - failed.length}/${checks.length} met`);
      if (!failed.length) break;
      if (state.verifyAttempts >= 2) return stop("verify-failed", `still unmet: ${failed.map((f) => f.id).join(", ")}`);
      const what = failed.map((f) => `- ${f.id}: ${f.evidence ?? ""}${f.where ? ` (where: ${f.where})` : ""}`).join("\n");
      const where = failed.map((f) => f.where).filter((w): w is string => Boolean(w && /[/.]/.test(w) && !/\s/.test(w)));
      const allowed = union(allTouches, where);
      const fix = await handTurn({ id: "U-FIX", block: unitBlockForFix("U-FIX", what, allowed, failed.map((f) => problem.done.find((d) => d.id === f.id)?.command).filter(Boolean).join(" && ") || "the done-checks above"), touches: allowed }, problem.restated ?? "", []);
      if (fix === "run-failed") return stop("run-failed", "verify fix turn did not finish");
      if (!fix.record.passed) return stop("verify-failed", `fix turn failed the gate: ${(fix.record.failing ?? []).join(", ")}`);
    }

    // (c) the review: fresh session, read-only, Pólya's questions, lessons.
    log("look back (c): review (fresh session, read-only)");
    const base = state.baselineSha ?? "HEAD~1";
    const t = await send(
      buildPrompt(`${PROMPTS}/look-back`, "", {
        problem: artifact(ARTIFACTS.problem) ?? "",
        base,
        diff_stat: io.diffStat(base) || "(no diff)",
        gates: gateSummary(state.unitRecords, state.finish),
        verify_report: (state.checks ?? []).map((c) => `- ${c.id}: ${c.passed ? "met" : "unmet"} (${c.how}) ${c.evidence ?? ""}`).join("\n") || "(none)",
        claims: JSON.stringify(state.unitRecords.map((r) => ({ id: r.id, report: r.report })), null, 2),
        lessons_consulted: problem.lessons.map((l) => `- ${l.id}: ${l.applied ? "applied" : "not applicable"}${l.how ? ` — ${l.how}` : ""}`).join("\n") || "(none)",
      }),
      { mode: "agent", fresh: true },
    );
    track(t);
    if (t.status !== "finished") return stop("run-failed", "review turn did not finish");
    const review = lenientJson<LookBackReport>(t.result);
    if (!review || !Array.isArray(review.findings) || !review.verdict) return stop("unparseable-report", "the review returned no findings block");
    state.review = review;
    await persist();
    const high = review.findings.filter((f) => f.severity === "high");
    log(`review: ${review.verdict}, ${review.findings.length} finding(s), ${high.length} high, ${review.lessons?.length ?? 0} lesson(s)`);
    if (high.length || review.answers_problem === false) {
      if (review.answers_problem === false && !high.length) return stop("review-unresolved", "the review says the result does not answer the restated problem; the done-checks were wrong (a stage:understand lesson)");
      const allowed = union(allTouches, high.map((f) => f.where).filter((w): w is string => Boolean(w && /[/.]/.test(w) && !/\s/.test(w))));
      const what = high.map((f) => `- ${f.where ?? ""}: ${f.what}${f.fix ? ` — fix: ${f.fix}` : ""}`).join("\n");
      const fix = await handTurn({ id: "U-FIX", block: unitBlockForFix("U-FIX", what, allowed, high.map((f) => f.check?.command).filter(Boolean).join(" && ") || "the findings' checks"), touches: allowed }, problem.restated ?? "", []);
      if (fix === "run-failed") return stop("run-failed", "review fix turn did not finish");
      if (!fix.record.passed) return stop("review-unresolved", `fix turn failed the gate: ${(fix.record.failing ?? []).join(", ")}`);
      state.reviewChecks = [];
      for (const f of high) {
        if (!f.check?.command) continue;
        const r = await io.runCommand(f.check.command);
        state.reviewChecks.push({ command: f.check.command, expected: f.check.expect_exit ?? 0, actual: r.code });
      }
      await persist();
      const unresolved = state.reviewChecks.filter((c) => c.actual !== c.expected);
      if (unresolved.length) return stop("review-unresolved", `checks failed: ${unresolved.map((c) => `${c.command} -> ${c.actual}, expected ${c.expected}`).join("; ")}`);
    }
    return stop("complete", undefined, "done");
  }

  return stop((state.stopReason as PolyaStopReason) ?? "run-failed", "loop entered with no runnable phase", state.phase);
}
