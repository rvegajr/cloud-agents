import { extractTaggedJson, looksLikeProse, type QualityContract } from "../../architect-crew-gate/src/blueprint.js";

/**
 * The three polya-craft artifacts (PATTERN.md section 2) as data, and the
 * mechanical half of the stranger test (section 3.1). Each artifact has a
 * human part and a fenced `json <tag>` block; the markdown is the source of
 * truth for what a person reads, the block fills what the markdown omits.
 * Nothing here runs a model or a command.
 */

/** The loop's own record lives in `.polya/`, out of the product's tree (blind reviewers docked structure for it at the root). */
export const POLYA_DIR = ".polya";
export const ARTIFACTS = { problem: `${POLYA_DIR}/PROBLEM.md`, plan: `${POLYA_DIR}/PLAN.md`, lookback: `${POLYA_DIR}/LOOKBACK.md` } as const;

export type ProblemKind = "repair" | "change" | "build" | "answer";
export type ProblemSize = "S" | "M" | "L";

export interface DoneCheck {
  id: string;
  text: string;
  check: string;
  /** D1, or any D flagged `outer` in the block: the answer in use. */
  outer: boolean;
  now: "unmet" | "met";
  /** A shell command the loop can run itself (exit 0 = met). Undefined = a stranger observes it. */
  command?: string;
}

export interface LessonDisposition {
  id: string;
  applied: boolean;
  how?: string;
}

export interface Problem {
  title: string;
  kind?: ProblemKind;
  size?: ProblemSize;
  given: string[];
  unknown?: string;
  condition?: string;
  restated?: string;
  done: DoneCheck[];
  notThis: string[];
  lessons: LessonDisposition[];
  split: { name: string; bound?: string; done: string[] }[];
  /** Purpose -> shell (install, test, lint, typecheck, start). Software only. */
  bar: Record<string, string>;
}

export interface Unit {
  id: string;
  title: string;
  serves: string[];
  level?: string;
  produces: string;
  given: string;
  do: string;
  touches: string[];
  check: string;
  /** `check` as a runnable command, when it is one. */
  command?: string;
  depends: string[];
  not?: string;
  /** The markdown block verbatim, for the Hand's packet. */
  body: string;
}

export interface Plan {
  units: Unit[];
  levels: { id: string; check: string }[];
  outer: { step: number; d?: string; text: string }[];
  trace: Record<string, string[]>;
  /** The `## Outer test` section verbatim, for the Verifier. */
  outerText: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$|Tests\.cs$/;
const ARTIFACT_FILE = /^(\.polya\/.*|(PROBLEM|PLAN|LOOKBACK|ONE-PAGE|LESSONS)\.md)$/;
const COMMAND_HEAD = /^(npm|npx|pnpm|yarn|node|deno|bun|curl|wget|sh|bash|zsh|git|python3?|pytest|pip|go|cargo|make|mvn|gradle|dotnet|ruby|bundle|\[|ls|cat|grep|diff|cmp|wc|jq|docker|kubectl|railway|gh)\b|^test\s+\S/;
/** A backticked path or glob (`test/*.test.js`, `src/app.js`) is a name, not a command. */
const LOOKS_LIKE_PATH = /^[\w.@-]*[\/*][\w.*\/@-]*$/;
const FORBIDDEN_IN_DO = /\b(choose|decide|appropriate|as needed|best|etc\.?|or similar|something like|if you (?:think|want|prefer)|use your judg?e?ment)\b/i;
const DEFAULT_HYGIENE = ["node_modules/", "dist/", "build/", "coverage/", "*.db", "*.sqlite", "*.sqlite3", ".env", ".qwen/", ".aider*", ".cursor/worktrees/"];

function section(md: string, heading: string): string | undefined {
  const re = new RegExp("^##\\s+" + heading + "\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|\\n```json|$(?![\\r\\n]))", "im");
  return md.match(re)?.[1];
}

function bullets(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((l) => l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/)?.[1])
    .filter((l): l is string => Boolean(l) && !/^<.*>$/.test(l!));
}

function prose(text: string | undefined): string | undefined {
  const t = text?.replace(/<!--[\s\S]*?-->/g, "").trim();
  return t && !/^<.*>$/.test(t) ? t : undefined;
}

function strip(s: string): string {
  return s.trim().replace(/^`|`$/g, "").trim();
}

function idList(s: string | undefined, prefix: string): string[] {
  if (!s) return [];
  return [...new Set([...s.matchAll(new RegExp("\\b" + prefix + "\\d+[a-z]?\\b", "g"))].map((m) => m[0]))];
}

/**
 * The runnable command inside a Check, if there is one: a backticked segment
 * that starts like a command, else the whole line when it does. A prose
 * check ("a reader scores it ≥ 4") has none and is the Verifier's.
 */
export function commandOf(check: string | undefined): string | undefined {
  if (!check) return undefined;
  const isCommand = (c: string) => COMMAND_HEAD.test(c) && !LOOKS_LIKE_PATH.test(c) && /\s/.test(c) && !/<[a-z][\w-]*>/i.test(c);
  const segments = [...check.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim());
  const ticked = segments.filter(isCommand);
  if (ticked.length === 1) return ticked[0];
  if (ticked.length > 1) {
    // Several backticked commands are one check only when nothing but connectors sits between them
    // ("`a` and `b`"). Commands mentioned inside a sentence ("run `npm ci`, then `npm start` and open …")
    // describe what a stranger does: that is the Verifier's, not a command.
    const residue = check.replace(/`[^`]+`/g, " ").replace(/\b(and|then|also|&&|;|,)\b/gi, " ").replace(/[\s,;.—–-]+/g, " ").trim();
    return residue ? undefined : ticked.join(" && ");
  }
  const candidate = check.trim();
  if (!isCommand(candidate) || looksLikeProse(candidate)) return undefined;
  return candidate;
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function normNow(v: unknown): "unmet" | "met" {
  return /^\s*met\b/i.test(String(v ?? "")) ? "met" : "unmet";
}

// ---------------------------------------------------------------------------
// PROBLEM.md
// ---------------------------------------------------------------------------

/** The `json problem` block, with the aliases a model tends to use (done_checks, statement, status, quality_bar). */
interface ProblemBlock {
  kind?: string;
  size?: string;
  done?: Partial<DoneCheck & { statement: string; status: string }>[];
  done_checks?: Partial<DoneCheck & { statement: string; status: string }>[];
  lessons?: Partial<LessonDisposition>[];
  split?: { name?: string; bound?: string; done?: string[] }[] | false;
  bar?: Record<string, string>;
  quality_bar?: Record<string, string>;
}

/**
 * One done-check per bullet: `- D1: text — Check: how — Now: unmet`. Models
 * drift: `**D1** —` for the id, `Check:` and `Now:` on their own indented
 * lines, `met (invariant)`. All of that is one item; the bullet that starts
 * the next D id ends it.
 */
function parseDoneChecks(text: string | undefined): DoneCheck[] {
  if (!text) return [];
  const out: DoneCheck[] = [];
  const items = text.split(/\n(?=\s*[-*]\s*\*{0,2}D\d+\*{0,2}\s*(?::|—|–|-))/);
  for (const item of items) {
    const m = item.match(/^\s*[-*]\s*\*{0,2}(D\d+)\*{0,2}\s*(?::|—|–|-)?\s*([\s\S]*)$/);
    if (!m) continue;
    const rest = m[2]!.replace(/\s*\n\s*/g, " ").trim();
    const checkM = rest.match(/\bCheck:\s*([\s\S]*?)(?=\s*(?:—|–|--|-)?\s*\bNow:|$)/i);
    const check = checkM?.[1]?.trim().replace(/\s*(?:—|–|--|-)\s*$/, "") ?? "";
    const nowM = rest.match(/\bNow:\s*(unmet|met)/i);
    const textPart = rest.split(/\s*(?:—|–|--|-)?\s*\bCheck:/i)[0]!.replace(/\s*(?:—|–|--|-)?\s*\bNow:.*$/i, "").trim();
    if (!textPart || /^<.*>$/.test(textPart)) continue;
    out.push({ id: m[1]!, text: textPart, check, outer: m[1] === "D1", now: nowM ? normNow(nowM[1]) : "unmet", command: commandOf(check) });
  }
  return out;
}

function parseBarTable(text: string | undefined): Record<string, string> {
  const bar: Record<string, string> = {};
  if (!text) return bar;
  // The command is the first backticked thing in the second cell; a note after it ("(no dependencies)") is allowed.
  for (const m of text.matchAll(/^\|\s*([a-z]+)\s*\|[^|`\n]*`([^`]+)`/gim)) {
    const cmd = m[2]!.trim();
    if (cmd && !/^<.*>$/.test(cmd)) bar[m[1]!.toLowerCase()] = cmd;
  }
  return bar;
}

export function parseProblem(md: string): Problem | undefined {
  const title = md.match(/^#\s+Problem:\s*(.+)$/m)?.[1]?.trim() ?? md.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!title) return undefined;
  const block = extractTaggedJson<ProblemBlock>(md, "problem");
  const kindRaw = (md.match(/^Kind:\s*(repair|change|build|answer)\b/im)?.[1] ?? block?.kind)?.toLowerCase();
  const sizeRaw = (md.match(/^Size:\s*([SML])\b/im)?.[1] ?? block?.size)?.toUpperCase();
  let done = parseDoneChecks(section(md, "Done-checks?"));
  const blockDone = arr<NonNullable<ProblemBlock["done"]>[number]>(block?.done ?? block?.done_checks).filter((d) => d && typeof d.id === "string");
  if (!done.length && blockDone.length) {
    done = blockDone.map((d) => ({ id: d.id!, text: String(d.text ?? d.statement ?? ""), check: String(d.check ?? ""), outer: Boolean(d.outer) || d.id === "D1", now: normNow(d.now ?? d.status), command: commandOf(d.check) }));
  } else {
    for (const d of blockDone) {
      const mine = done.find((x) => x.id === d.id);
      if (mine && d.outer) mine.outer = true;
    }
  }
  const lessonsMd: LessonDisposition[] = [];
  for (const l of bullets(section(md, "Lessons consulted"))) {
    const m = l.match(/^\*{0,2}(L-[\w-]+)\*{0,2}\s*[:—–-]?\s*(.*)$/);
    if (!m) continue;
    const applied = /\bapplied\b/i.test(m[2]!) && !/\bnot applicable\b/i.test(m[2]!);
    lessonsMd.push({ id: m[1]!, applied, how: m[2]!.trim() });
  }
  const lessons = lessonsMd.length ? lessonsMd : arr<Partial<LessonDisposition>>(block?.lessons).filter((l) => l && typeof l.id === "string").map((l) => ({ id: l.id!, applied: Boolean(l.applied), how: l.how }));
  const splitMd = [...(section(md, "Split") ?? "").matchAll(/^\|\s*(P\d+[^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/gm)]
    .filter((m) => !/^-+$/.test(m[1]!.trim()) && !/sub-problem/i.test(m[1]!))
    .map((m) => ({ name: m[1]!.trim(), bound: m[2]!.trim() || undefined, done: idList(m[3], "D") }));
  const split = splitMd.length ? splitMd : arr<{ name?: string; bound?: string; done?: string[] }>(block?.split).filter((s) => s && s.name).map((s) => ({ name: String(s.name), bound: s.bound, done: arr<string>(s.done).map(String) }));
  const barMd = parseBarTable(section(md, "Quality bar"));
  const barBlock = block?.bar && typeof block.bar === "object" ? block.bar : block?.quality_bar && typeof block.quality_bar === "object" ? block.quality_bar : {};
  const bar = Object.keys(barMd).length ? barMd : Object.fromEntries(Object.entries(barBlock).filter(([, v]) => typeof v === "string" && v.trim() && !/^<.*>$/.test(v)));
  return {
    title,
    kind: kindRaw === "repair" || kindRaw === "change" || kindRaw === "build" || kindRaw === "answer" ? kindRaw : undefined,
    size: sizeRaw === "S" || sizeRaw === "M" || sizeRaw === "L" ? sizeRaw : undefined,
    given: bullets(section(md, "Given")),
    unknown: prose(section(md, "Unknown")),
    condition: prose(section(md, "Condition")),
    restated: prose(section(md, "Restated")),
    done,
    notThis: bullets(section(md, "Not this")),
    lessons,
    split,
    bar,
  };
}

/** What Understand must get right before a plan is drawn (PATTERN.md section 2.1). */
export function problemGaps(p: Problem | undefined, opts: { maxDone?: number; software?: boolean; offeredLessons?: string[] } = {}): string[] {
  const gaps: string[] = [];
  if (!p) return ["- PROBLEM.md is missing or has no `# Problem:` title"];
  const max = opts.maxDone ?? 8;
  if (!p.done.length) gaps.push("- no done-checks: list D1..Dn under `## Done-check`, each `- D<n>: <statement> — Check: <what a stranger runs> — Now: unmet|met`");
  if (p.done.length > max) gaps.push(`- ${p.done.length} done-checks; at most ${max}. More means the problem is not yet understood, or is size L and needs a Split table`);
  for (const d of p.done) if (!d.check) gaps.push(`- ${d.id} has no Check`);
  if (!p.restated) gaps.push("- no `## Restated` section in your own words");
  if (p.size === "L" && !p.split.length) gaps.push("- Size L but no `## Split` table: sub-problems, the existing check that bounds each, the D ids each carries");
  if (p.split.length) {
    const carried = new Set(p.split.flatMap((s) => s.done));
    const lost = p.done.filter((d) => !carried.has(d.id)).map((d) => d.id);
    if (lost.length) gaps.push(`- Split carries no row for ${lost.join(", ")}; every D belongs to at least one sub-problem`);
  }
  if (opts.software && !p.bar.test) gaps.push("- `## Quality bar` names no `test` command; discover it from the repo (package.json scripts, Makefile, pyproject)");
  for (const id of opts.offeredLessons ?? []) if (!p.lessons.some((l) => l.id === id)) gaps.push(`- ${id} was offered and has no disposition under \`## Lessons consulted\``);
  return gaps;
}

// ---------------------------------------------------------------------------
// PLAN.md
// ---------------------------------------------------------------------------

const UNIT_FIELDS = ["Serves", "Level", "Produces", "Given", "Do", "Touches", "Check", "Depends", "Not"] as const;

/**
 * A field runs from its `Field:` line to the next field line at column 0. Its
 * value may start on the next line (`Do:` then numbered steps), carry fenced
 * code (a whole file the Hand must type), and contain blank lines.
 */
function parseUnitFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string | undefined;
  for (const line of body.split("\n").slice(1)) {
    const m = line.match(/^([A-Z][a-z]+):[ \t]*(.*)$/);
    if (m && (UNIT_FIELDS as readonly string[]).includes(m[1]!)) {
      current = m[1]!;
      out[current] = m[2]!.trim();
      continue;
    }
    if (current) out[current] = out[current] ? `${out[current]}\n${line}` : line;
  }
  for (const k of Object.keys(out)) out[k] = out[k]!.trim();
  return out;
}

/** Numbered steps in a Do, not counting lines inside fenced code. */
function countSteps(doText: string): number {
  let inFence = false;
  let n = 0;
  for (const line of doText.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^\s*\d+[.)]\s/.test(line)) n++;
  }
  return n;
}

/** One line of a multi-line field, for single-line fields like Serves and Touches. */
function firstLine(v: string | undefined): string | undefined {
  return v?.split("\n")[0]?.trim();
}

interface PlanBlock {
  levels?: { id?: string; check?: string }[];
  units?: Partial<Record<"id" | "title" | "level" | "produces" | "given" | "do" | "check" | "not", string> & { serves: string[]; touches: string[]; depends: string[] }>[];
  outer?: { step?: number; d?: string; text?: string }[];
  trace?: Record<string, string[]>;
}

export function parsePlan(md: string): Plan {
  const units: Unit[] = [];
  // Units are `## U1:` or `### U1:`; a unit ends at the next unit heading, the next `## ` section, or the json block.
  const sections = md.split(/^(?=#{2,3}\s+U\d+[a-z]?:)/m).filter((s) => /^#{2,3}\s+U\d+/.test(s));
  for (const sec of sections) {
    const header = sec.match(/^#{2,3}\s+(U\d+[a-z]?):\s*(.*)$/m);
    if (!header) continue;
    const rest = sec.slice(header[0].length);
    // A fenced block may contain "## " lines (a README the Hand must write); only count fences outside them.
    let bodyEnd = -1;
    let inFence = false;
    let offset = 0;
    for (const line of rest.split("\n")) {
      if (/^\s*```/.test(line)) inFence = !inFence;
      else if (!inFence && /^(##\s|```json)/.test(line)) {
        bodyEnd = offset;
        break;
      }
      offset += line.length + 1;
    }
    const body = (header[0] + (bodyEnd === -1 ? rest : rest.slice(0, bodyEnd))).trim();
    const f = parseUnitFields(body);
    // "`node_modules/` (generated, gitignored)" is one entry with a note, not three.
    const list = (v: string | undefined) => (firstLine(v) ?? "").replace(/\([^)]*\)/g, "").split(",").map(strip).filter((s) => s && s !== "-" && !/^none$/i.test(s) && !/^<.*>$/.test(s));
    const check = (f.Check ?? "").replace(/\s+(?:—|–|--|-)\s+[Nn]ow:\s*(?:unmet|met)[^\n]*$/i, "").trim();
    units.push({
      id: header[1]!,
      title: header[2]!.trim(),
      serves: idList(firstLine(f.Serves), "D"),
      level: strip(firstLine(f.Level) ?? "") || undefined,
      produces: f.Produces ?? "",
      given: f.Given ?? "",
      do: f.Do ?? "",
      touches: list(f.Touches),
      check,
      command: commandOf(check),
      depends: idList(firstLine(f.Depends), "U"),
      not: f.Not || undefined,
      body,
    });
  }
  const block = extractTaggedJson<PlanBlock>(md, "plan");
  if (!units.length && arr(block?.units).length) {
    for (const u of arr<NonNullable<PlanBlock["units"]>[number]>(block?.units)) {
      if (!u?.id) continue;
      const check = u.check ?? "";
      const body =
        `## ${u.id}: ${u.title ?? ""}\nServes:   ${(u.serves ?? []).join(" ")}\nLevel:    ${u.level ?? ""}\nProduces: ${u.produces ?? ""}\n` +
        `Given:    ${u.given ?? ""}\nDo:       ${u.do ?? ""}\nTouches:  ${(u.touches ?? []).join(", ")}\nCheck:    ${check} — Now: unmet\n` +
        `Depends:  ${(u.depends ?? []).join(", ") || "none"}\nNot:      ${u.not ?? ""}`;
      units.push({ id: u.id, title: u.title ?? "", serves: arr<unknown>(u.serves).map(String), level: u.level, produces: u.produces ?? "", given: u.given ?? "", do: u.do ?? "", touches: arr<unknown>(u.touches).map(String), check, command: commandOf(check), depends: arr<unknown>(u.depends).map(String), not: u.not, body });
    }
  }
  const shape = section(md, "Shape") ?? "";
  const levels = [...shape.matchAll(/^\s*[-*]?\s*(L[0-9](?::[^\s—–-]+)?)[^\n]*?(?:—|–|--|-)\s*check:\s*(.*)$/gim)].map((m) => ({ id: m[1]!, check: m[2]!.trim() }));
  const outerText = (section(md, "Outer test") ?? "").trim();
  const outer = bullets(outerText).map((text, i) => ({ step: i + 1, d: idList(text, "D")[0], text }));
  const trace: Record<string, string[]> = {};
  for (const m of (section(md, "(?:Order and )?Trace") ?? "").matchAll(/^\s*(?:[-*]|\|)?\s*\*{0,2}(D\d+)\*{0,2}\s*(?:→|->|:|\|)\s*([^\n]*)$/gim)) trace[m[1]!] = idList(m[2], "U");
  const traceBlock: Record<string, string[]> = {};
  if (block?.trace && typeof block.trace === "object") {
    for (const [k, v] of Object.entries(block.trace as Record<string, unknown>)) {
      const units = Array.isArray(v) ? v : v && typeof v === "object" ? (v as { units?: unknown }).units : typeof v === "string" ? [v] : [];
      traceBlock[k] = arr<unknown>(units).map(String);
    }
  }
  return {
    units,
    levels: levels.length ? levels : arr<{ id?: string; check?: string }>(block?.levels).filter((l) => l?.id).map((l) => ({ id: String(l.id), check: String(l.check ?? "") })),
    outer: outer.length ? outer : arr<{ step?: number; d?: string; text?: string }>(block?.outer).map((o, i) => ({ step: o.step ?? i + 1, d: o.d, text: o.text ?? "" })),
    trace: Object.keys(trace).length ? trace : traceBlock,
    outerText,
  };
}

export interface UnitProblem {
  id: string;
  problem: string;
}

/**
 * The mechanical half of the stranger test (PATTERN.md section 3.1) plus the
 * plan-level rules of 2.2. The judgment half (Start, Same) is the Solver's;
 * Carry out audits it when a Hand stops to ask.
 */
export function validateUnits(
  units: Unit[],
  problem: Problem | undefined,
  opts: { maxTouches?: number; maxBodyLines?: number; maxDoSteps?: number; requireCommand?: boolean; exists?: (path: string) => boolean; doneIds?: string[] } = {},
): UnitProblem[] {
  const out: UnitProblem[] = [];
  const maxTouches = opts.maxTouches ?? 6;
  // A unit that carries the exact content of the files it produces is long and still one sitting; ~400 lines is about a 12 KB packet.
  const maxBody = opts.maxBodyLines ?? 400;
  const maxDo = opts.maxDoSteps ?? 9;
  const doneIds = new Set(opts.doneIds ?? problem?.done.map((d) => d.id) ?? []);
  const ids = new Set(units.map((u) => u.id));
  for (const u of units) {
    const push = (problem: string) => out.push({ id: u.id, problem });
    if (!u.produces) push("no Produces:");
    if (!u.given) push("no Given: (the Hand may read nothing else; name every input by its owning location)");
    if (!u.do) push("no Do:");
    if (!u.touches.length) push("no Touches:");
    if (!u.check) push("no Check:");
    if (!u.serves.length) push("Serves: names no D");
    const unknownD = u.serves.filter((d) => !doneIds.has(d));
    if (unknownD.length && doneIds.size) push(`Serves: names D(s) that do not exist: ${unknownD.join(", ")}`);
    const unknownU = u.depends.filter((d) => !ids.has(d));
    if (unknownU.length) push(`Depends: names unit(s) that do not exist: ${unknownU.join(", ")}`);
    const tests = u.touches.filter((f) => TEST_FILE.test(f));
    if (tests.length) push(`Touches: names test file(s) (${tests.join(", ")}); a Check lives outside Touches`);
    const docs = u.touches.filter((f) => ARTIFACT_FILE.test(f));
    if (docs.length) push(`Touches: names plan artifact(s) (${docs.join(", ")})`);
    if (u.touches.length > maxTouches) push(`Touches: ${u.touches.length} entries; more than ${maxTouches} is more than one sitting (split the unit)`);
    if (u.check && opts.requireCommand && !u.command) push(`Check: is prose, not a command (${JSON.stringify(u.check.slice(0, 80))}); for software the Check is a command that exits 0 when met`);
    if (u.command) {
      if (opts.exists) {
        const paths = u.command.match(/[\w./-]+\.(?:test|spec)\.[jt]sx?|(?:^|\s)(?:test|tests|spec)\/[\w./-]+/g) ?? [];
        const missing = paths.map((p) => p.trim()).filter((p) => !opts.exists!(p));
        if (missing.length) push(`Check: names test file(s) not on disk: ${missing.join(", ")}; the red test is written at Devise`);
      }
    }
    const forbidden = u.do.match(FORBIDDEN_IN_DO);
    if (forbidden) push(`Do: contains "${forbidden[0]}"; every choice is made in the plan, not by the Hand`);
    const steps = countSteps(u.do);
    if (steps > maxDo) push(`Do: ${steps} steps; more than ${maxDo} is more than one sitting (split the unit)`);
    const lines = u.body.split("\n").length;
    if (lines > maxBody) push(`unit block is ${lines} lines; more than ${maxBody} will not fit a Hand's packet (split the unit)`);
  }
  // Plan level: every D served; side-by-side units keep disjoint Touches.
  for (const d of doneIds) if (!units.some((u) => u.serves.includes(d))) out.push({ id: "plan", problem: `${d} is served by no unit` });
  const dependsOn = (a: Unit, b: Unit): boolean => {
    const seen = new Set<string>();
    const walk = (u: Unit): boolean => {
      for (const dep of u.depends) {
        if (dep === b.id) return true;
        if (seen.has(dep)) continue;
        seen.add(dep);
        const next = units.find((x) => x.id === dep);
        if (next && walk(next)) return true;
      }
      return false;
    };
    return walk(a);
  };
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i]!;
      const b = units[j]!;
      const shared = a.touches.filter((t) => b.touches.includes(t));
      if (shared.length && !dependsOn(a, b) && !dependsOn(b, a)) out.push({ id: `${a.id}/${b.id}`, problem: `share Touches (${shared.join(", ")}) but neither depends on the other; order them or split the file` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The gate contract, and materialising from bare JSON
// ---------------------------------------------------------------------------

/** What the borrowed gate needs from PROBLEM.md: the bar. Without it the gate runs the whole suite per unit. */
export function contractOf(p: Problem | undefined): QualityContract | undefined {
  if (!p || !Object.keys(p.bar).length) return undefined;
  const bar = { ...p.bar };
  const start = bar.start ? { command: bar.start } : undefined;
  delete bar.start;
  return { bar, start, hygieneNeverTracked: DEFAULT_HYGIENE, rubricTargets: {} };
}

const FENCE = "```";

/** Rebuild PROBLEM.md from the Solver's report when it described the problem but did not write the file. */
export function renderProblem(report: {
  title?: string;
  kind?: string;
  size?: string;
  given?: string[];
  unknown?: string;
  condition?: string;
  restated?: string;
  done?: { id: string; text?: string; check?: string; outer?: boolean; now?: string }[];
  not_this?: string[];
  lessons?: { id: string; applied?: boolean; how?: string }[];
  split?: { name: string; bound?: string; done?: string[] }[];
  bar?: Record<string, string>;
}): string | undefined {
  if (!report.done?.length) return undefined;
  const done = report.done.map((d) => `- ${d.id}: ${d.text ?? ""} — Check: ${d.check ?? ""} — Now: ${d.now === "met" ? "met" : "unmet"}`).join("\n");
  const rows = Object.entries(report.bar ?? {}).map(([k, v]) => `| ${k} | \`${v}\` |`).join("\n");
  const split = (report.split ?? []).map((s) => `| ${s.name} | ${s.bound ?? ""} | ${(s.done ?? []).join(" ")} |`).join("\n");
  return (
    `# Problem: ${report.title ?? "(untitled)"}\nKind: ${report.kind ?? "build"}\nSize: ${report.size ?? "M"}\n\n` +
    `## Given\n${(report.given ?? []).map((g) => `- ${g}`).join("\n") || "- (none stated)"}\n\n` +
    `## Unknown\n${report.unknown ?? ""}\n\n## Condition\n${report.condition ?? ""}\n\n## Restated\n${report.restated ?? ""}\n\n` +
    `## Done-check\n${done}\n\n## Not this\n${(report.not_this ?? []).map((n) => `- ${n}`).join("\n") || "- (none stated)"}\n\n` +
    `## Lessons consulted\n${(report.lessons ?? []).map((l) => `- ${l.id}: ${l.applied ? `applied as ${l.how ?? ""}` : `not applicable because ${l.how ?? ""}`}`).join("\n") || "- (none offered)"}\n\n` +
    (split ? `## Split\n| Sub-problem | Bounding check | D ids carried |\n| --- | --- | --- |\n${split}\n\n` : "") +
    (rows ? `## Quality bar\n| Purpose | Command |\n| --- | --- |\n${rows}\n\n` : "") +
    `${FENCE}json problem\n${JSON.stringify({ kind: report.kind, size: report.size, done: report.done, lessons: report.lessons ?? [], split: report.split ?? [], bar: report.bar ?? {} }, null, 2)}\n${FENCE}\n`
  );
}

/** Rebuild PLAN.md from the Solver's report when it did not write the file. */
export function renderPlan(report: {
  title?: string;
  approach?: string;
  levels?: { id: string; check?: string }[];
  outer?: { step?: number; d?: string; text?: string }[];
  units?: { id: string; title?: string; serves?: string[]; level?: string; produces?: string; given?: string; do?: string; touches?: string[]; check?: string; depends?: string[]; not?: string }[];
}): string | undefined {
  if (!report.units?.length) return undefined;
  const units = report.units
    .map(
      (u) =>
        `## ${u.id}: ${u.title ?? ""}\nServes:   ${(u.serves ?? []).join(" ")}\nLevel:    ${u.level ?? ""}\nProduces: ${u.produces ?? ""}\nGiven:    ${u.given ?? ""}\n` +
        `Do:       ${u.do ?? ""}\nTouches:  ${(u.touches ?? []).join(", ")}\nCheck:    ${u.check ?? ""} — Now: unmet\nDepends:  ${(u.depends ?? []).join(", ") || "none"}\nNot:      ${u.not ?? ""}`,
    )
    .join("\n\n");
  const trace: Record<string, string[]> = {};
  for (const u of report.units) for (const d of u.serves ?? []) (trace[d] ??= []).push(u.id);
  return (
    `# Plan for: ${report.title ?? ""}\n\n## Approach\n${report.approach ?? ""}\n\n` +
    `## Shape\n${(report.levels ?? []).map((l) => `- ${l.id} — check: ${l.check ?? ""}`).join("\n")}\n\n` +
    `## Outer test\n${(report.outer ?? []).map((o, i) => `${o.step ?? i + 1}. ${o.text ?? ""}${o.d ? ` (${o.d})` : ""}`).join("\n")}\n\n` +
    `## Units\n\n${units}\n\n## Order\n${report.units.map((u) => u.id).join(" → ")}\n\n` +
    `## Trace\n${Object.entries(trace).map(([d, us]) => `- ${d} → ${us.join(", ")}`).join("\n")}\n\n` +
    `${FENCE}json plan\n${JSON.stringify({ levels: report.levels ?? [], units: report.units, outer: report.outer ?? [], trace }, null, 2)}\n${FENCE}\n`
  );
}
