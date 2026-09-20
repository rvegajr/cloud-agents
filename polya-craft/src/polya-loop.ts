import type { SendFn, TurnResult } from "../../src/lib/build-loop.js";
import { buildPrompt } from "../../src/lib/prompts.js";
import { lenientJson, type BlueprintIO } from "../../architect-crew-gate/src/blueprint-loop.js";
import { browserToolNote, scenarioNeedsBrowser } from "../../architect-crew-gate/src/browser.js";
import { gateFeedbackNote, type GateResult } from "../../architect-crew-gate/src/quality-gate.js";
import { fileLessonsStore, priorLessonsNote, tagsForProblem, type LessonsStore, type NewLesson } from "./lessons.js";
import { ARTIFACTS, POLYA_DIR, immovableOf, oracleNote, parsePlan, parseProblem, parseRequest, problemGaps, renderPlan, renderProblem, requestNote, validateUnits, type DoneCheck, type Plan, type Problem, type Unit } from "./plan.js";

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
  /** Is `sha` an ancestor of HEAD? False after a Hand rebased, reset, or amended history. */
  isAncestor?(sha: string): boolean;
  /** Discard everything after `sha`: the answer to a turn that rewrote history. */
  resetTo?(sha: string): void;
  /** Delete a file from the working tree (the next commit records it). */
  removeFile?(rel: string): boolean;
  /** Paths changed between `sha` and HEAD. */
  changedFiles?(sha: string): string[];
  /** Stop tracking files the repo's own .gitignore covers (a model may have forced them in). Returns what it untracked. */
  untrackIgnored?(): string[];
  /**
   * Run a done-check: finished when its shell exits, whatever it left running in the background, and everything it
   * started is killed with it. `runCommand` waits for every holder of the output pipe, so a check that starts a
   * watch-mode server never returns.
   */
  runCheck?(command: string, cwd: string): Promise<{ code: number; output: string }>;
};

/** A check that backgrounds its own server (`npm run dev &`, `node server.js &`) needs the port free. */
const SELF_SERVES = /(?:npm\s+(?:start|run\s+\S+)|node\s+\S+)[^;&|\n]*&(?!&)/;

/** The kit seeds a template AGENTS.md and a QWEN.md of ACG gate rules; on a polya run both are false for the repo and the prompts carry the rules. */
const SEEDED_AGENTS = /Copy this file to the root of any repository you want cloud agents to work on/;
const SEEDED_QWEN = /^## Orchestrator quality gate/m;

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
  /** Files the Solver itself committed after the baseline (a repair's red test); the finish check allows them. */
  solverFiles?: string[];
  /** Units the Solver has already been asked to re-plan once, so a bad unit cannot loop. */
  replanned?: string[];
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
  /** Prose done-checks per Verifier turn (default 2): a local model walking five pages in one turn hits its tool-call cap. */
  verifyBatch?: number;
  /** New lessons the ledger takes per run (default 2); the rest stay in LOOKBACK.md. */
  lessonsPerRun?: number;
  /** Put the oracle checklist in the Understand prompt and require a disposition for every line (POLYA_ORACLE=1). */
  oracle?: boolean;
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


/** LOOKBACK.md, rendered by the loop from evidence (PATTERN.md section 2.3). */
/** `labels[i]` names what became of the reviewer's i-th lesson in the ledger. */
export function renderLookback(state: PolyaState, problem: Problem | undefined, labels: string[] = []): string {
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
  const lessons = (r?.lessons ?? []).map((l, i) => `## ${labels[i] ?? "(not appended)"}\nTags:     ${(l.tags ?? []).join(" ")}\nWhen:     ${l.when ?? ""}\nLesson:   ${l.lesson}\nEvidence: ${l.evidence ?? ""}\nStatus:   candidate`);
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
    `${FENCE}json lookback\n${JSON.stringify({ verdict: r?.verdict ?? (state.stopReason === "complete" ? "done" : "stop"), results: (problem?.done ?? []).map((d) => ({ id: d.id, met: state.checks?.find((x) => x.id === d.id)?.passed ?? null })), findings: r?.findings ?? [], lessons: labels.filter((x) => /^L-/.test(x)).map((x) => x.split(" ")[0]), confirmed: r?.confirmed ?? [] }, null, 2)}\n${FENCE}\n`
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
  // The requester's J/W/M lines, if the problem came from REQUEST.md; the same text on a resume, so nothing to persist.
  const request = parseRequest(opts.problem);
  const immovable = immovableOf(request);
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

  // Whatever phase this run starts in: a record a model forced into git makes every later Hand turn look like an
  // ownership violation, because edits to a tracked file are visible to the gate.
  {
    const forced = io.untrackIgnored?.() ?? [];
    if (forced.length) {
      io.commit(`polya: untrack ${forced.length} ignored file(s) (${forced.slice(0, 3).join(", ")}${forced.length > 3 ? ", …" : ""})`);
      log(`untracked ${forced.join(", ")}`);
    }
  }

  /** (d): always, even after a stop inside look back. Written from evidence; the reviewer never writes it. */
  let lookbackWritten = false;
  const writeLookback = async (): Promise<void> => {
    if (lookbackWritten) return;
    lookbackWritten = true;
    const problem = state.problem ?? readProblem();
    const report = state.review;
    const cap = opts.lessonsPerRun ?? 2;
    const all = report?.lessons ?? [];
    // Every lesson stays in LOOKBACK.md; what the ledger takes is labelled there.
    const labels: string[] = all.map((l) =>
      !l?.lesson || /^\s*no lesson\b/i.test(l.lesson) ? "(no lesson)" : !l.when?.trim() ? "(not appended: no When)" : "(not appended: over the per-run cap)",
    );
    let added = 0;
    let confirmed = 0;
    if (lessons) {
      try {
        const eligible = all.map((l, i) => ({ l, i })).filter(({ i }) => labels[i] === "(not appended: over the per-run cap)").slice(0, cap);
        const results = eligible.length ? lessons.append(eligible.map(({ l }) => ({ tags: l.tags ?? [], when: l.when!, lesson: l.lesson, evidence: l.evidence ?? problem?.title ?? "" }))) : [];
        results.forEach((res, k) => {
          labels[eligible[k]!.i] = res.merged ? `${res.id} (confirmed: says what this entry already said)` : res.id;
          if (!res.merged) added++;
        });
        if (report?.confirmed?.length) {
          lessons.confirm(report.confirmed);
          confirmed = report.confirmed.length;
        }
      } catch (err) {
        log(`ledger: could not write (${(err as Error).message})`);
      }
    }
    io.writeFile(ARTIFACTS.lookback, renderLookback(state, problem, labels));
    io.commit("look back: LOOKBACK.md");
    state.lookback = { written: true, lessons: added, confirmed };
    log(`look back written: ${added} lesson(s) appended, ${confirmed} confirmed`);
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
      // The gate diffs base..HEAD; a rebase, reset, or amend makes that diff lie. A turn that rewrote history is
      // discarded whole and the Hand is told; nothing it did survives to be judged.
      if (io.isAncestor && !io.isAncestor(baseSha)) {
        log(`gate ${unit.id}: history rewritten (base ${baseSha.slice(0, 8)} is no longer an ancestor of HEAD); turn discarded, attempt ${attempt + 1}`);
        io.resetTo?.(baseSha);
        record.failing = ["ownership"];
        gate = { passed: false, seconds: 0, skipped: [], findings: [{ rule: "ownership", ok: false, detail: `this turn rewrote git history (rebase, reset, or amend); the orchestrator discarded it. Commit on top of HEAD; never rewrite what is already committed` }] };
        prompt = `${gateFeedbackNote(attempt + 1, gate)}${base}`;
        continue;
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

  /**
   * The commands a unit's gate runs: its own Check, plus the Checks of the units already passed — except a Check
   * that pins the hash of a file this unit may change. A repair that edits a file an earlier unit wrote whole can
   * never match that unit's hash again, and the earlier unit's behaviour is still covered by the finish check.
   */
  const taskCommandsFor = (unit: { touches: string[]; command?: string }): string[] => {
    const passed = state.unitRecords
      .filter((r) => r.passed)
      .map((r) => state.units.find((x) => x.id === r.id)?.command)
      .filter((c): c is string => Boolean(c))
      .filter((c) => !(/\b(?:sha(?:256|1|512)(?:sum)?|shasum|md5sum|createHash)\b/.test(c) && unit.touches.some((t) => c.includes(t))));
    return union(passed, unit.command ? [unit.command] : []);
  };

  /**
   * A check failed at look back. The Solver writes the repair as ordinary units (plan-lint, a red Check, the Hand,
   * the gate); the loop never writes a unit itself. Returns undefined when every repair unit passed its gate.
   */
  const repair = async (stage: "finish" | "verify" | "review" | "unit", evidence: string, revise?: Unit): Promise<{ reason: PolyaStopReason; detail: string } | undefined> => {
    const stopFor: PolyaStopReason = stage === "finish" ? "finish-check-failed" : stage === "verify" ? "verify-failed" : stage === "unit" ? "unit-gate-failed" : "review-unresolved";
    const problem = readProblem();
    // Ids the Solver must not reuse: everything in PLAN.md, including a repair an earlier pass rejected and left there.
    const before = readPlan()?.units.map((u) => u.id) ?? [];
    const nextId = `U${before.reduce((n, id) => Math.max(n, Number(id.match(/\d+/)?.[0] ?? 0)), 0) + 1}`;
    // What counts as new: a unit the loop never accepted. A rejected repair's id rewritten by the Solver is new
    // (live jsoncount, 2026-09-20: a U4 the old recognizer had rejected made the next pass's U4 "no new unit").
    const prompt = buildPrompt(`${PROMPTS}/repair`, "", {
      stage: stage === "finish" ? "the finish check" : stage === "verify" ? "done-checks from a fresh clone" : stage === "unit" ? `unit ${revise?.id}'s own Check` : "the review",
      evidence,
      revise_note: revise
        ? `The unit below could not pass its own Check after every attempt, and the Hand reproduced what its Do says. That is a defect in the unit, not in the work: its Check may depend on a deliverable of a later unit, its Do may be incomplete, or its Touches may be too narrow. Revise **${revise.id} in place** under \`## Units\` — its Check, Do, Touches or Depends — so that it can pass once ${revise.id} and the units it depends on are done. Write no new unit unless the work genuinely splits in two.`
        : "",
      problem_md: artifact(ARTIFACTS.problem) ?? "",
      plan_md: artifact(ARTIFACTS.plan) ?? "",
      next_id: nextId,
    });
    log(`repair (${stage}): asking the Solver for units from ${nextId}`);
    const beforeSha = io.headSha();
    let t = await send(prompt, { mode: "agent" });
    track(t);
    if (t.status !== "finished") return { reason: "run-failed", detail: "repair turn did not finish" };
    io.commit("repair: PLAN.md");
    const report = lenientJson<{ check_wrong?: boolean; notes?: string }>(t.result);
    if (report?.check_wrong) {
      // Nothing of this turn belongs in the repo: PLAN.md lives under the ignored .polya/, and what the Solver ran to
      // reach its verdict is scratch. Left committed, it fails ownership at the next finish check.
      if (io.headSha() !== beforeSha && io.resetTo) io.resetTo(beforeSha);
      return { reason: stopFor, detail: `the Solver says the check is wrong, not the product: ${report.notes ?? ""}`.trim() };
    }
    const accepted = state.units.map((u) => u.id);
    const fresh = () => (readPlan()?.units ?? []).filter((u) => !accepted.includes(u.id) || (revise && u.id === revise.id));
    const gapsOf = (): string[] => {
      const units = fresh();
      if (!units.length) return ["- no new unit under `## Repairs`"];
      const lines = validateUnits(units, problem, {
        requireCommand: software,
        exists: (p) => artifact(p) !== undefined,
        doneIds: [],
        knownUnitIds: (readPlan()?.units ?? []).map((u) => u.id),
        // A repair for a failed done-check names it; one for the finish check or a review finding answers the whole job.
        requireServes: stage === "verify",
        immovable,
      }).map((p) => `- ${p.id}: ${p.problem}`);
      return lines;
    };
    let gaps = gapsOf();
    if (gaps.length) {
      log(`repair not workable; asking the Solver once more:\n${gaps.join("\n")}`);
      t = await send(`## Repair not workable\n\nFix only these in the repair units, commit, then reply with the same JSON block.\n\n${gaps.join("\n")}\n\n---\n\n${prompt}`, { mode: "agent" });
      track(t);
      if (t.status !== "finished") return { reason: "run-failed", detail: "repair retry did not finish" };
      io.commit("repair: gap fixes");
      gaps = gapsOf();
      if (gaps.length) return { reason: stopFor, detail: `repair not workable: ${gaps.join("; ")}` };
    }
    const units = fresh();
    for (const u of units) {
      if (u.command && (await io.runCommand(u.command)).code === 0) return { reason: stopFor, detail: `repair ${u.id}'s Check already passes; it measures nothing` };
    }
    if (revise) {
      // A revised unit replaces the one that could not pass; it is carried out again below.
      state.units = state.units.filter((u) => !units.some((n) => n.id === u.id));
      state.unitRecords = state.unitRecords.filter((r) => !units.some((n) => n.id === r.id));
    }
    // The red test the Solver wrote for the repair is the Solver's file, not a Hand's: the finish check allows it.
    state.solverFiles = union(state.solverFiles, io.changedFiles?.(beforeSha) ?? []);
    state.units = [...state.units, ...units];
    await persist();
    for (const u of units) {
      log(`carry out ${u.id} (repair): ${u.title}`);
      const r = await handTurn({ id: u.id, block: u.body, touches: u.touches, command: u.command }, `${problem?.restated ?? ""}\n\nDone-checks this unit serves:\n${problem ? doneLines(problem, u) : ""}`, taskCommandsFor(u));
      if (r === "run-failed") return { reason: "run-failed", detail: `repair ${u.id} did not finish` };
      state.unitRecords = state.unitRecords.filter((x) => x.id !== u.id);
      state.unitRecords.push(r.record);
      await persist();
      if (r.blocked) {
        state.replanNote = `Repair ${u.id} asked: "${r.blocked}"`;
        return { reason: "unit-not-workable", detail: `${u.id} asked: ${r.blocked}` };
      }
      if (!r.record.passed) return { reason: stopFor, detail: `repair ${u.id} failed the gate after ${r.record.attempts} attempt(s): ${(r.record.failing ?? []).join(", ")}` };
    }
    return undefined;
  };

  // ---- 1. Understand --------------------------------------------------------
  if (state.phase === "understand") {
    log("understand");
    // The loop's record is for the loop and for a person reading the run, not part of what the product ships:
    // blind reviewers dock a tree that carries the build tool's planning state, wherever it sits.
    const ignore = artifact(".gitignore") ?? "";
    if (!/^\.polya\/?$/m.test(ignore)) {
      io.writeFile(".gitignore", `${ignore.trim() ? `${ignore.trim()}\n` : ""}${POLYA_DIR}/\n`);
      io.commit(`polya: ignore ${POLYA_DIR}/, the loop's own record`);
      log(`${POLYA_DIR}/ is ignored in this repo; the record stays out of the product`);
    }
    // A template AGENTS.md tells every Hand the wrong layout and commands, and ships as instructions for another
    // project (ledger L-2026-09-19-06). Only the unmodified seed is removed; a person's AGENTS.md stays.
    if (io.removeFile) {
      const removed = [
        SEEDED_AGENTS.test(artifact("AGENTS.md") ?? "") && io.removeFile("AGENTS.md") ? "AGENTS.md" : "",
        SEEDED_QWEN.test(artifact("QWEN.md") ?? "") && io.removeFile("QWEN.md") ? "QWEN.md" : "",
      ].filter(Boolean);
      if (removed.length) {
        io.commit(`polya: remove the kit's seeded ${removed.join(" and ")}; the prompts carry the rules`);
        log(`removed the kit's seeded ${removed.join(", ")}`);
      }
    }
    const offered = lessons ? lessons.select(tagsForProblem(opts.problem, opts.repo)) : [];
    const prompt = buildPrompt(`${PROMPTS}/understand`, "", {
      problem: opts.problem,
      repo: opts.repo,
      prior_lessons: priorLessonsNote(offered, artifact(ARTIFACTS.lookback)),
      oracle: opts.oracle ? oracleNote() : "",
      request: requestNote(request),
    });
    const gapsOf = () => problemGaps(readProblem(), { maxDone: opts.oracle ? 10 : 8, software, offeredLessons: offered.map((l) => l.id), oracle: opts.oracle, request });
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
    // A J or W line the Solver could only meet by moving an M line is a defect in the request, not in the product.
    // The requester fixes it in five minutes now (ACCEPT.md, before any unit runs); a unit would fail ownership on it later.
    const conflicts = request.filter((r) => r.kind !== "immovable").map((r) => ({ r, d: problem!.request[r.id] ?? "" })).filter(({ d }) => /\bdismissed\b/i.test(d) && /\bM\d+\b/.test(d));
    if (conflicts.length) return stop("understanding-incomplete", `the request conflicts with itself: ${conflicts.map(({ r, d }) => `${r.id} (${r.text.slice(0, 70)}) — ${d.slice(0, 240)}`).join("; ")}. Edit the request and start again; the Understand turn is the cheap one.`);
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
      const lines = validateUnits(plan.units, problem, { requireCommand: software, exists, doneIds: carried, immovable }).map((p) => `- ${p.id}: ${p.problem}`);
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
      const taskCommands = taskCommandsFor(unit);
      const strong = /^\s*strong\s*$/i.test(unit.body.match(/^Owner:\s*(.*)$/im)?.[1] ?? "");
      const r = await handTurn({ id: unit.id, block: unit.body, touches: unit.touches, command: unit.command }, excerpt, taskCommands, strong ? "claude" : undefined);
      if (r === "run-failed") return stop("run-failed", `unit ${unit.id} turn did not finish`);
      state.unitRecords.push(r.record);
      await persist();
      if (!r.blocked && !r.record.passed && !(state.replanned ?? []).includes(unit.id)) {
        // A unit the Hand cannot pass, having done what its Do says, is a defect in the unit: back to the Solver, once.
        state.replanned = union(state.replanned, [unit.id]);
        await persist();
        const evidence = `- ${unit.id} failed its own Check after ${r.record.attempts} attempt(s) (${(r.record.failing ?? []).join(", ")}).\n  Check: ${unit.check}\n  Last output:\n${tail((await io.runCommand(unit.command ?? "true")).output, 25)}`;
        const stopped = await repair("unit", evidence, unit);
        if (stopped) return stop(stopped.reason, stopped.detail);
        state.unitIndex -= 1; // the revised unit is carried out again
        continue;
      }
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
  const finishAllowed = () => union(allTouches, ...state.units.map((u) => u.touches), state.solverFiles, [ARTIFACTS.problem, ARTIFACTS.plan, ARTIFACTS.lookback]);

  // ---- 4. Look back ---------------------------------------------------------
  if (state.phase === "look-back") {
    const problem = readProblem();
    const plan = readPlan();
    if (!problem) return stop("unparseable-report", `${ARTIFACTS.problem} missing at look back`);
    // A LOOKBACK.md on disk is from an earlier pass that stopped. It is regenerated from evidence at the end of this
    // one; left in place it reads as the current verdict to the reviewer and to anyone opening the PR.
    if (artifact(ARTIFACTS.lookback)) {
      io.writeFile(ARTIFACTS.lookback, `# Look back: ${problem.title}\n\n(in progress: an earlier pass stopped; this file is rewritten when the pass ends)\n`);
      io.commit("look back: clear the previous pass's LOOKBACK.md");
      log("cleared the previous pass's LOOKBACK.md");
    }

    // A unit that has not passed its gate (a repair from an earlier pass, or a resume mid-stage) runs first.
    for (const u of state.units.filter((x) => !state.unitRecords.find((r) => r.id === x.id)?.passed)) {
      log(`carry out ${u.id} (unfinished): ${u.title}`);
      const r = await handTurn({ id: u.id, block: u.body, touches: u.touches, command: u.command }, `${problem.restated ?? ""}\n\nDone-checks this unit serves:\n${doneLines(problem, u)}`, taskCommandsFor(u));
      if (r === "run-failed") return stop("run-failed", `${u.id} turn did not finish`);
      state.unitRecords = state.unitRecords.filter((x) => x.id !== u.id);
      state.unitRecords.push(r.record);
      await persist();
      if (r.blocked) {
        state.replanNote = `Unit ${u.id} asked: "${r.blocked}"`;
        return stop("unit-not-workable", `${u.id} asked: ${r.blocked}`);
      }
      if (!r.record.passed) return stop("unit-gate-failed", `${u.id} failed the gate after ${r.record.attempts} attempt(s): ${(r.record.failing ?? []).join(", ")}`);
    }

    // (a) the finish check: ownership over the whole job, hygiene, the bar, clean start, vacuous suite.
    // A workspace that reaches here without a carry-out turn in it (every unit already passed on a resume,
    // e.g. after a reboot lost the old one) has no node_modules yet. The bar's lint/test/build commands would
    // then fail on a bare "module not found", read as a product defect it isn't. (b) already installs into its
    // fresh clone for the same reason; this is that same step for the workspace itself.
    if (problem.bar.install) await io.runCommand(problem.bar.install);
    log("look back (a): checks from a clean state");
    let gate = await io.gate("finish", { allowedFiles: finishAllowed(), baseSha: state.baselineSha });
    if (!gate.passed) {
      const what = gate.findings.filter((f) => !f.ok).map((f) => `- [${f.rule}] ${f.detail}${f.command ? ` (\`${f.command}\`)` : ""}${f.output ? `\n  ${tail(f.output, 30).replace(/\n/g, "\n  ")}` : ""}`).join("\n");
      log(`finish check failed: ${failingRules(gate).join(", ")}; the Solver devises a repair`);
      const stopped = await repair("finish", what);
      if (stopped) {
        state.finish = { passed: false, failing: failingRules(gate) };
        return stop(stopped.reason, stopped.detail);
      }
      gate = await io.gate("finish", { allowedFiles: finishAllowed(), baseSha: state.baselineSha });
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
      const run = (command: string) => (io.runCheck ? io.runCheck(command, clone) : io.runCommand(command, clone));
      const record = (d: DoneCheck, r: { code: number; output: string }) =>
        checks.push({ id: d.id, passed: r.code === 0, how: "mechanical", evidence: `\`${d.command}\` exited ${r.code}${r.code ? `: ${tail(r.output, 5)}` : ""}` });
      // Checks that start their own server go first, while the port is free; then the loop starts the app for the
      // checks that only curl it, and stops it after.
      const selfServing = mechanical.filter((d) => SELF_SERVES.test(d.command!));
      const rest = mechanical.filter((d) => !selfServing.includes(d));
      for (const d of selfServing) record(d, await run(d.command!));
      let running: { stop(): void } | undefined;
      // A build's Understand runs before the app exists, so its bar may name no `start`; the repo's own start script is the fallback.
      const startCmd = problem.bar.start ?? problem.bar.dev ?? problem.bar.serve ?? (/"start"\s*:/.test(artifact("package.json") ?? "") ? "npm start" : undefined);
      if (startCmd && io.start && rest.some((d) => NEEDS_SERVER.test(d.command!))) {
        log(`starting \`${startCmd}\` in the clone for the done-checks`);
        running = await io.start(startCmd, clone);
      }
      try {
        for (const d of rest) record(d, await run(d.command!));
      } finally {
        running?.stop();
      }

      const prose: DoneCheck[] = problem.done.filter((d) => !d.command);
      if (prose.length) {
        const mechanical = checks.map((c) => `- ${c.id}: ${c.passed ? "PASS" : "FAIL"} — ${c.evidence}`).join("\n") || "(none)";
        const readme = (artifact("README.md") ?? "(no README)").slice(0, 4000);
        const size = Math.max(1, opts.verifyBatch ?? 2);
        const batches: DoneCheck[][] = [];
        for (let i = 0; i < prose.length; i += size) batches.push(prose.slice(i, i + size));
        for (const [bi, batch] of batches.entries()) {
          const ids = new Set(batch.map((d) => d.id));
          // Only the outer-test steps this batch exercises; the whole walk is what overflowed one turn.
          const steps = (plan?.outer ?? []).filter((o) => o.d && ids.has(o.d)).map((o) => `${o.step}. ${o.text}`);
          const lines = batch.map((d) => `- ${d.id}: ${d.text} — Check: ${d.check}`).join("\n");
          const outerFull = `${steps.length ? `${steps.join("\n")}\n\n` : ""}Done-checks a stranger observes (walk only these):\n${lines}`;
          const needsBrowser = scenarioNeedsBrowser(outerFull);
          const browser = needsBrowser && opts.browser === true;
          const prompt = buildPrompt(`${PROMPTS}/verify`, "", {
            outer_test: outerFull,
            mechanical_results: mechanical,
            run_instructions: readme,
            browser_tools: browserToolNote(!needsBrowser ? "unneeded" : browser ? "available" : "absent"),
          });
          type Walked = { step?: number; d?: string; passed?: boolean; evidence?: string; where?: string };
          const seen = new Map<string, Walked[]>();
          const missing = () => batch.map((d) => d.id).filter((id) => !seen.has(id));
          const tiers: ("local" | "claude")[] = ["local", "local", ...(opts.verifyFallbackTier === "claude" ? (["claude"] as const) : [])];
          for (const [ai, tier] of tiers.entries()) {
            const left = missing();
            if (!left.length) break;
            // A silent reply and a reply that walks one check of two are the same failure: ask again for what is missing.
            const note = ai === 0 ? "" : `## Your previous reply did not report ${left.join(" and ")}\n\nWalk ${left.length > 1 ? "each of them" : "it"} now and end with the single fenced json block the Output section specifies, one result per id, nothing after it.\n\n---\n\n`;
            log(`verifier batch ${bi + 1}/${batches.length}${ai ? ` (attempt ${ai + 1}${tier === "claude" ? ", claude" : ""})` : ""}: ${left.join(", ")}`);
            const t = await send(`${note}${prompt}`, { mode: "agent", fresh: true, cwd: clone, ...(browser ? { browser: true } : {}), ...(tier === "claude" ? { tier } : {}) });
            track(t);
            if (t.status !== "finished") continue;
            const r = lenientJson<{ results?: Walked[] }>(t.result);
            if (!r?.results || !Array.isArray(r.results)) continue;
            for (const id of batch.map((d) => d.id)) {
              const mine = r.results.filter((x) => x.d === id);
              if (mine.length) seen.set(id, mine);
            }
          }
          // A check nobody walked is not a failed check: the run stops and says so, rather than repairing a defect no one saw.
          const unwalked = missing();
          if (unwalked.length) return stop("unparseable-report", `the Verifier did not report ${unwalked.join(", ")} after ${tiers.length} attempt(s)`);
          for (const d of batch) {
            const mine = seen.get(d.id)!;
            checks.push({ id: d.id, passed: mine.every((r) => r.passed), how: "verifier", evidence: mine.map((r) => r.evidence).filter(Boolean).join("; "), where: mine.find((r) => !r.passed)?.where });
          }
        }
      }
      // Report in the order PROBLEM.md lists them.
      checks.sort((a, b) => problem.done.findIndex((d) => d.id === a.id) - problem.done.findIndex((d) => d.id === b.id));
      state.checks = checks;
      await persist();
      const failed = checks.filter((c) => !c.passed);
      log(`done-checks: ${checks.length - failed.length}/${checks.length} met`);
      if (!failed.length) break;
      if (state.verifyAttempts >= 2) return stop("verify-failed", `still unmet: ${failed.map((f) => f.id).join(", ")}`);
      const what = failed
        .map((f) => {
          const d = problem.done.find((x) => x.id === f.id);
          return `- ${f.id}: ${d?.text ?? ""}\n  Check: ${d?.check ?? ""}\n  Observed (${f.how}): ${f.evidence ?? ""}${f.where ? `\n  Where: ${f.where}` : ""}`;
        })
        .join("\n");
      const stopped = await repair("verify", what);
      if (stopped) return stop(stopped.reason, stopped.detail);
    }

    // (c) the review: fresh session, read-only, Pólya's questions, lessons.
    log("look back (c): review (fresh session, read-only)");
    const base = state.baselineSha ?? "HEAD~1";
    const beforeReview = io.headSha();
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
    // A review is read-only by contract, but a shell redirection (`> out.txt`) still writes, and the engine commits
    // whatever a turn leaves. Those files are nobody's; the finish check would fail ownership on them next pass
    // (live jsoncount, 2026-09-20: six scratch files). The review's report is in `t`; the repo goes back as it was.
    if (io.headSha() !== beforeReview && io.resetTo) {
      io.resetTo(beforeReview);
      log("the review turn left changes in the repo; discarded (a review is read-only)");
    }
    if (t.status !== "finished") return stop("run-failed", "review turn did not finish");
    const review = lenientJson<LookBackReport>(t.result);
    if (!review || !Array.isArray(review.findings) || !review.verdict) return stop("unparseable-report", "the review returned no findings block");
    state.review = review;
    await persist();
    // A finding about the loop's own record (PROBLEM.md, PLAN.md, LOOKBACK.md) is a process finding: it is recorded in
    // LOOKBACK.md and the ledger, never handed to the Hand, which may not touch those files.
    const artifactRe = /\b(PROBLEM|PLAN|LOOKBACK)\.md\b/;
    const process = review.findings.filter((f) => f.severity === "high" && (artifactRe.test(f.where ?? "") || artifactRe.test(f.check?.command ?? "")));
    const high = review.findings.filter((f) => f.severity === "high" && !process.includes(f));
    log(`review: ${review.verdict}, ${review.findings.length} finding(s), ${high.length} high${process.length ? ` (+${process.length} about the record, kept in LOOKBACK.md)` : ""}, ${review.lessons?.length ?? 0} lesson(s)`);
    if (high.length || review.answers_problem === false) {
      if (review.answers_problem === false && !high.length) return stop("review-unresolved", "the review says the result does not answer the restated problem; the done-checks were wrong (a stage:understand lesson)");
      const what = high.map((f) => `- [high] ${f.where ?? ""}: ${f.what}${f.fix ? `\n  Suggested fix: ${f.fix}` : ""}${f.check?.command ? `\n  Its check: \`${f.check.command}\` should exit ${f.check.expect_exit ?? 0}` : ""}`).join("\n");
      const stopped = await repair("review", what);
      if (stopped) return stop(stopped.reason, stopped.detail);
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
