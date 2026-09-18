import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The five architect documents (PATTERN.md section 2) as data. Each has a
 * human section and a fenced `json <tag>` machine block; the parsers prefer
 * the machine block and fall back to the markdown form so a hand-written
 * document still works. Nothing here runs a model or a command.
 */

export const ARTIFACTS = ["REQUIREMENTS.md", "QUALITY.md", "DESIGN.md", "TASKS.md", "QA.md"] as const;

export interface Requirement {
  id: string;
  text: string;
  check?: string;
}

export interface QualityContract {
  /** Purpose -> shell command (install, lint, typecheck, test, build). */
  bar: Record<string, string>;
  start?: {
    command: string;
    probe?: { http?: string; expect?: number; timeout_s?: number; exit?: number; args?: string[] };
  };
  hygieneNeverTracked: string[];
  rubricTargets: Record<string, number>;
}

export interface BlueprintTask {
  id: string;
  title: string;
  requirements: string[];
  files: string[];
  ports: string[];
  tests: string[];
  commands: string[];
  parallelOk: boolean;
  outOfScope?: string;
  goal?: string;
  /** The markdown block verbatim, for the crew prompt. */
  body: string;
}

export interface QaScenario {
  id: string;
  requirement: string;
  title?: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Machine blocks
// ---------------------------------------------------------------------------

/** The last fenced block opened with ```json <tag>. */
export function extractTaggedJson<T = unknown>(text: string | undefined, tag: string): T | undefined {
  if (!text) return undefined;
  const re = new RegExp("```json[ \\t]+" + tag + "[ \\t]*\\n([\\s\\S]*?)\\n```", "g");
  let last: string | undefined;
  for (const m of text.matchAll(re)) last = m[1];
  if (last === undefined) return undefined;
  try {
    return JSON.parse(last) as T;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// REQUIREMENTS.md
// ---------------------------------------------------------------------------

export function parseRequirements(md: string): Requirement[] {
  const block = extractTaggedJson<{ requirements?: Requirement[] }>(md, "requirements");
  if (block?.requirements?.length) {
    return block.requirements.filter((r) => r && typeof r.id === "string").map((r) => ({ id: r.id.trim(), text: String(r.text ?? "").trim(), check: r.check?.trim() }));
  }
  const out: Requirement[] = [];
  const parts = md.split(/^(?=\s*-\s*\*\*R\d+[a-z]?\*\*)/m).filter((p) => /^\s*-\s*\*\*R\d+/.test(p));
  for (const part of parts) {
    const m = part.match(/^\s*-\s*\*\*(R\d+[a-z]?)\*\*\s*([\s\S]*)$/);
    if (!m) continue;
    const end = m[2]!.search(/\n##\s|\n```json/);
    const body = (end === -1 ? m[2]! : m[2]!.slice(0, end)).trim();
    const check = body.match(/Check:\s*([\s\S]*)$/m)?.[1]?.replace(/\s+/g, " ").trim();
    const text = body.replace(/\n?\s*Check:[\s\S]*$/m, "").replace(/\s+/g, " ").trim();
    out.push({ id: m[1]!, text, check });
  }
  return out;
}

/**
 * The job's "Must have" bullets, numbered M1..Mn in order. The orchestrator
 * hands them to the architect and then checks that every one is covered by a
 * requirement and walked by a workflow; the snippet-vault build lost its edit
 * UI because nothing did this.
 */
export function mustHavesOf(job: string): string[] {
  const m = job.match(/^#{1,6}[ \t]*must[- ]haves?\b[^\n]*\n([\s\S]*?)(?=\n#{1,6}[ \t]|$(?![\r\n]))/im);
  if (!m) return [];
  return m[1]!
    .split("\n")
    .map((l) => l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/)?.[1])
    .filter((l): l is string => Boolean(l));
}

export interface Workflow {
  id: string;
  title: string;
  /** Requirement ids the workflow walks through, in order. */
  requirements: string[];
  steps: string[];
}

/**
 * `## Workflows`: the end-to-end journeys QA must walk, each crossing several
 * requirements ("create, find it by search, copy it, restart, it is still
 * there"). One scenario per requirement proves the parts; a workflow proves the
 * whole. Machine block `workflows[]` first, markdown `- **W1** title (R1, R3)` with
 * numbered steps beneath as the fallback.
 */
export function parseWorkflows(md: string): Workflow[] {
  const block = extractTaggedJson<{ workflows?: Partial<Workflow>[] }>(md, "requirements");
  if (block?.workflows?.length) {
    return block.workflows
      .filter((w) => w && typeof w.id === "string")
      .map((w) => ({
        id: w.id!.trim(),
        title: String(w.title ?? "").trim(),
        requirements: (w.requirements ?? []).map((r) => String(r).trim()).filter(Boolean),
        steps: (w.steps ?? []).map((s) => String(s).trim()).filter(Boolean),
      }));
  }
  const section = md.match(/^##\s+Workflows?\b[^\n]*\n([\s\S]*?)(?=\n##\s|\n```json|$(?![\r\n]))/im)?.[1];
  if (!section) return [];
  const out: Workflow[] = [];
  const parts = section.split(/^(?=\s*-\s*\*\*W\d+\*\*)/m).filter((p) => /^\s*-\s*\*\*W\d+/.test(p));
  for (const part of parts) {
    const m = part.match(/^\s*-\s*\*\*(W\d+)\*\*\s*([^\n]*)([\s\S]*)$/);
    if (!m) continue;
    const head = m[2]!.trim();
    const ids = [...new Set([...head.matchAll(/\bR\d+[a-z]?\b/g)].map((x) => x[0]))];
    const steps = m[3]!.split("\n").map((l) => l.match(/^\s*(?:\d+[.)]|[-*+])\s+(.*\S)\s*$/)?.[1]).filter((l): l is string => Boolean(l));
    for (const s of steps) for (const id of s.matchAll(/\bR\d+[a-z]?\b/g)) if (!ids.includes(id[0])) ids.push(id[0]);
    out.push({ id: m[1]!, title: head.replace(/\s*\((?:R\d+[a-z]?[,\s]*)+\)\s*$/, "").replace(/[—:-]\s*$/, "").trim(), requirements: ids, steps });
  }
  return out;
}

/** `## Coverage`: must-have -> requirement ids. Machine block `coverage` first, markdown `- M1: R1, R2` (or `M1 → R1`) as the fallback. */
export function parseCoverage(md: string): Record<string, string[]> | undefined {
  const block = extractTaggedJson<{ coverage?: Record<string, unknown> }>(md, "requirements");
  if (block?.coverage && typeof block.coverage === "object") {
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(block.coverage)) {
      const ids = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[,\s]+/) : [];
      out[k.trim().toUpperCase()] = ids.map((s) => s.trim()).filter(Boolean);
    }
    return out;
  }
  const section = md.match(/^##\s+Coverage\b[^\n]*\n([\s\S]*?)(?=\n##\s|\n```json|$(?![\r\n]))/im)?.[1];
  if (!section) return undefined;
  const out: Record<string, string[]> = {};
  for (const m of section.matchAll(/^\s*[-*]\s*\*{0,2}(M\d+)\*{0,2}\s*(?::|→|->|—|-)\s*([^\n]*)$/gim)) {
    out[m[1]!.toUpperCase()] = [...m[2]!.matchAll(/\bR\d+[a-z]?\b/g)].map((x) => x[0]);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * What stage 0 must get right before a blueprint is drawn: every must-have is
 * covered by an existing requirement and walked by a workflow; every workflow
 * names existing requirements; a build or change has at least one workflow.
 */
export function requirementsGaps(input: {
  mustHaves: string[];
  coverage?: Record<string, string[]>;
  requirements: Requirement[];
  workflows: Workflow[];
  jobKind?: string;
}): string[] {
  const ids = new Set(input.requirements.map((r) => r.id));
  const gaps: string[] = [];
  const walked = new Set(input.workflows.flatMap((w) => w.requirements));
  input.mustHaves.forEach((text, i) => {
    const key = `M${i + 1}`;
    const rs = (input.coverage?.[key] ?? []).filter((r) => ids.has(r));
    if (!rs.length) {
      gaps.push(`- ${key} "${text}" is covered by no requirement: add one (or map the ids that cover it under Coverage)`);
      return;
    }
    if (!rs.some((r) => walked.has(r))) gaps.push(`- ${key} "${text}" (${rs.join(", ")}) is walked by no workflow: add it to a workflow's steps`);
  });
  for (const w of input.workflows) {
    const unknown = w.requirements.filter((r) => !ids.has(r));
    if (!w.requirements.length) gaps.push(`- ${w.id} names no requirement ids`);
    else if (unknown.length) gaps.push(`- ${w.id} names requirement(s) that do not exist: ${unknown.join(", ")}`);
    if (!w.steps.length) gaps.push(`- ${w.id} has no steps`);
  }
  if (!input.workflows.length && (input.jobKind === "build" || input.jobKind === "change" || input.mustHaves.length))
    gaps.push("- no workflows: list at least one end-to-end workflow a user would walk, with its steps and the requirement ids each step exercises");
  return gaps;
}

export function jobKindOf(md: string): "build" | "change" | "repair" | "maintain" | undefined {
  const m = md.match(/Job kind:\s*(build|change|repair|maintain)/i) ?? md.match(/"job_kind"\s*:\s*"(build|change|repair|maintain)"/i);
  return m ? (m[1]!.toLowerCase() as "build" | "change" | "repair" | "maintain") : undefined;
}

// ---------------------------------------------------------------------------
// QUALITY.md
// ---------------------------------------------------------------------------

const DEFAULT_HYGIENE = ["node_modules/", "dist/", "build/", "coverage/", "*.db", "*.sqlite", "*.sqlite3", ".env", ".qwen/", ".aider*", ".cursor/worktrees/"];

export function parseQuality(md: string): QualityContract | undefined {
  const block = extractTaggedJson<{
    bar?: Record<string, string>;
    start?: QualityContract["start"];
    hygiene_never_tracked?: string[];
    rubric_targets?: Record<string, number>;
  }>(md, "quality");
  if (block?.bar) {
    const bar: Record<string, string> = {};
    for (const [k, v] of Object.entries(block.bar)) if (typeof v === "string" && v.trim() && !/^\.\.\.|^<.*>$/.test(v.trim())) bar[k] = v.trim();
    return {
      bar,
      start: block.start?.command && !/^\.\.\.|^<.*>$/.test(block.start.command) ? block.start : undefined,
      hygieneNeverTracked: block.hygiene_never_tracked?.length ? block.hygiene_never_tracked : DEFAULT_HYGIENE,
      rubricTargets: block.rubric_targets ?? {},
    };
  }
  // Markdown fallback: the quality-bar table.
  const bar: Record<string, string> = {};
  for (const m of md.matchAll(/^\|\s*([a-z]+)\s*\|\s*`([^`]+)`/gim)) bar[m[1]!.toLowerCase()] = m[2]!;
  if (!Object.keys(bar).length) return undefined;
  const start = bar.start ? { command: bar.start } : undefined;
  delete bar.start;
  return { bar, start, hygieneNeverTracked: DEFAULT_HYGIENE, rubricTargets: {} };
}

/** `dist/` -> ^dist/, `*.db` -> \.db$, `.aider*` -> ^\.aider, `.env` -> ^\.env$ */
export function hygienePatternToRegex(pattern: string): RegExp {
  const p = pattern.trim();
  if (p.endsWith("/")) return new RegExp("^" + escapeRe(p));
  if (p.startsWith("*.")) return new RegExp(escapeRe(p.slice(1)) + "$");
  if (p.endsWith("*")) return new RegExp("^" + escapeRe(p.slice(0, -1)));
  return new RegExp("^" + escapeRe(p) + "$");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// TASKS.md
// ---------------------------------------------------------------------------

const LIST_KEYS = ["requirements", "files", "ports", "tests", "commands"] as const;

export function parseTasks(md: string): BlueprintTask[] {
  const tasks: BlueprintTask[] = [];
  const sections = md.split(/^(?=##\s+T\d+[a-z]?:)/m).filter((s) => /^##\s+T\d+/.test(s));
  for (const sec of sections) {
    const header = sec.match(/^##\s+(T\d+[a-z]?):\s*(.*)$/m);
    if (!header) continue;
    const bodyEnd = sec.search(/\n```json|\n##\s|$/);
    const body = sec.slice(0, bodyEnd === -1 ? undefined : bodyEnd).trim();
    const field = (name: string): string | undefined => body.match(new RegExp("^" + name + ":[ \\t]*(.*)$", "im"))?.[1]?.trim();
    const list = (name: string): string[] =>
      (field(name) ?? "")
        .split(",")
        .map((s) => s.trim().replace(/^`|`$/g, ""))
        .filter((s) => s && s !== "-" && s.toLowerCase() !== "none");
    tasks.push({
      id: header[1]!,
      title: header[2]!.trim(),
      requirements: list("Requirements"),
      files: list("Files"),
      ports: list("Ports"),
      tests: list("Tests"),
      commands: list("Commands"),
      parallelOk: /^(yes|true)$/i.test(field("Parallel") ?? ""),
      outOfScope: field("Out of scope"),
      goal: field("Goal"),
      body,
    });
  }
  // Cross-check with the machine block when both exist: the block may carry parallel_ok and file lists.
  const block = extractTaggedJson<{ tasks?: Partial<Record<(typeof LIST_KEYS)[number], string[]> & { id: string; title: string; parallel_ok: boolean }>[] }>(md, "tasks");
  if (block?.tasks?.length) {
    if (!tasks.length) {
      for (const t of block.tasks) {
        if (!t?.id) continue;
        tasks.push({
          id: t.id,
          title: t.title ?? "",
          requirements: t.requirements ?? [],
          files: t.files ?? [],
          ports: t.ports ?? [],
          tests: t.tests ?? [],
          commands: t.commands ?? [],
          parallelOk: Boolean(t.parallel_ok),
          body: `## ${t.id}: ${t.title ?? ""}\nFiles: ${(t.files ?? []).join(", ")}\nTests: ${(t.tests ?? []).join(", ")}\nCommands: ${(t.commands ?? []).join(", ")}`,
        });
      }
    } else {
      for (const t of block.tasks) {
        const md = tasks.find((x) => x.id === t?.id);
        if (!md || !t) continue;
        for (const k of LIST_KEYS) if (!md[k].length && t[k]?.length) md[k] = t[k]!;
        if (t.parallel_ok !== undefined) md.parallelOk = Boolean(t.parallel_ok);
      }
    }
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// QA.md
// ---------------------------------------------------------------------------

export function parseQaScenarios(md: string): QaScenario[] {
  const out: QaScenario[] = [];
  const sections = md.split(/^(?=##\s+Q\d+)/m).filter((s) => /^##\s+Q\d+/.test(s));
  for (const sec of sections) {
    // `## Q3 (R3): title` proves one requirement; `## Q12 (W1): title` walks one workflow.
    const h = sec.match(/^##\s+(Q\d+)\s*\(([RW]\d+[a-z]?)\)\s*:?\s*(.*)$/m) ?? sec.match(/^##\s+(Q\d+)\s*:?\s*(.*)$/m);
    if (!h) continue;
    const bodyEnd = sec.search(/\n```json|\n##\s|$/);
    const body = sec.slice(0, bodyEnd === -1 ? undefined : bodyEnd).trim();
    if (h.length === 4) out.push({ id: h[1]!, requirement: h[2]!, title: h[3]?.trim(), body });
    else out.push({ id: h[1]!, requirement: "", title: h[2]?.trim(), body });
  }
  const block = extractTaggedJson<{ scenarios?: { id: string; requirement: string }[] }>(md, "qa");
  for (const s of block?.scenarios ?? []) {
    const md = out.find((x) => x.id === s.id);
    if (md && !md.requirement) md.requirement = s.requirement;
    if (!md) out.push({ id: s.id, requirement: s.requirement, body: `## ${s.id} (${s.requirement})` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Traceability and ownership
// ---------------------------------------------------------------------------

const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$|Tests\.cs$/;
const ARCHITECT_DOC = /^(REQUIREMENTS|QUALITY|DESIGN|TASKS|QA|SPEC|ROADMAP)\.md$/;

/**
 * A task the crew can legally do: it names at least one file, none of them a
 * test (tests are architect-owned and already written) or an architect document.
 */
export function validateTasks(tasks: BlueprintTask[]): { id: string; problem: string }[] {
  const problems: { id: string; problem: string }[] = [];
  for (const t of tasks) {
    if (!t.files.length) problems.push({ id: t.id, problem: "names no files under Files:" });
    const tests = t.files.filter((f) => TEST_FILE.test(f));
    if (tests.length) problems.push({ id: t.id, problem: `names test file(s) under Files: (${tests.join(", ")}); tests are written by the architect in the blueprint, never by a crew task` });
    const docs = t.files.filter((f) => ARCHITECT_DOC.test(f));
    if (docs.length) problems.push({ id: t.id, problem: `names architect document(s) under Files: (${docs.join(", ")})` });
    if (!t.tests.length) problems.push({ id: t.id, problem: "names no tests under Tests: that must go green" });
    const prose = t.commands.filter(looksLikeProse);
    if (prose.length) problems.push({ id: t.id, problem: `Commands: contains prose, not shell (${prose.map((c) => JSON.stringify(c)).join(", ")}); each entry must run as-is under \`sh -c\`` });
  }
  return problems;
}

/** "npm start (background) then curl … expect 200" is an instruction, not a command. */
export function looksLikeProse(command: string): boolean {
  return /\b(then|expect|background|manual(ly)?|verify|confirm|should)\b|\(background\)|^\s*(then|and)\b/i.test(command) && !/^\s*(sh|bash)\s+-c\s/.test(command);
}

export interface Traceability {
  covered: string[];
  uncovered: { id: string; missing: ("test" | "task" | "qa")[] }[];
}

/** Every requirement needs a test tagged with its id, a task listing it, and a QA scenario; every workflow needs a QA scenario that walks it. */
export function traceability(
  reqs: Requirement[],
  tasks: BlueprintTask[],
  qa: QaScenario[],
  testSources: { path: string; text: string }[],
  workflows: Workflow[] = [],
): Traceability {
  const covered: string[] = [];
  const uncovered: Traceability["uncovered"] = [];
  for (const r of reqs) {
    const tag = new RegExp("\\b" + r.id + "\\b");
    const missing: ("test" | "task" | "qa")[] = [];
    if (!testSources.some((t) => tag.test(t.text))) missing.push("test");
    if (!tasks.some((t) => t.requirements.includes(r.id))) missing.push("task");
    if (!qa.some((q) => q.requirement === r.id)) missing.push("qa");
    if (missing.length) uncovered.push({ id: r.id, missing });
    else covered.push(r.id);
  }
  for (const w of workflows) {
    if (qa.some((q) => q.requirement === w.id)) covered.push(w.id);
    else uncovered.push({ id: w.id, missing: ["qa"] });
  }
  return { covered, uncovered };
}

/** The design sections a crew turn needs: layout lines for its files, port sections it implements or consumes, wiring, data model, contract. */
export function designExcerptFor(design: string, task: BlueprintTask): string {
  const sections = design.split(/^(?=##\s)/m);
  const keep: string[] = [];
  for (const sec of sections) {
    const h = sec.match(/^##\s+(.*)$/m)?.[1]?.trim().toLowerCase() ?? "";
    if (h.startsWith("layout")) {
      const lines = sec.split("\n").filter((l) => task.files.some((f) => l.includes(f)));
      if (lines.length) keep.push(`## Layout (your files)\n${lines.join("\n")}`);
    } else if (h.startsWith("ports")) {
      const subs = sec.split(/^(?=###\s)/m).filter((s) => /^###\s/.test(s));
      const mine = subs.filter((s) => task.ports.some((p) => new RegExp("###\\s+" + escapeRe(p) + "\\b").test(s)));
      if (mine.length) keep.push(`## Ports\n${mine.join("\n").trim()}`);
    } else if (/^(wiring|data model|api contract|cli contract|existing code)/.test(h)) {
      keep.push(sec.trim());
    }
  }
  return keep.join("\n\n").trim() || design.slice(0, 6000);
}

/** Read the five documents from a checkout, if present. */
export function readArtifacts(cwd: string): Partial<Record<(typeof ARTIFACTS)[number], string>> {
  const out: Partial<Record<(typeof ARTIFACTS)[number], string>> = {};
  for (const name of ARTIFACTS) {
    const p = join(cwd, name);
    if (existsSync(p)) out[name] = readFileSync(p, "utf8");
  }
  return out;
}
