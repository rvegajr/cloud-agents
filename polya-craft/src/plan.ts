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
  /** `## Oracle`: oracle line id -> the Solver's disposition (adopted as a D, or dismissed with a reason). */
  oracle: Record<string, string>;
  /** `## Request`: J/W/M item id from the requester's REQUEST.md -> the Solver's disposition. */
  request: Record<string, string>;
}

/**
 * What the requester wrote that the Solver cannot derive from features: what they will judge by (J), what
 * failure they would notice first (W), and what may not move (M). From `templates/REQUEST.md` or the same
 * sections in `ideas/TEMPLATE.md`. Every miss in the measured runs was a line nobody wrote here.
 */
export interface RequestItem {
  id: string;
  kind: "judge" | "wrong" | "immovable";
  text: string;
}

const REQUEST_SECTIONS: { kind: RequestItem["kind"]; prefix: string; heading: RegExp }[] = [
  { kind: "judge", prefix: "J", heading: /I will judge it by/i },
  { kind: "wrong", prefix: "W", heading: /Wrong looks like/i },
  { kind: "immovable", prefix: "M", heading: /Must not change/i },
];

/** The request's J/W/M items, in order; a `<placeholder>` bullet left from the template is not an item. */
export function parseRequest(md: string): RequestItem[] {
  const out: RequestItem[] = [];
  for (const s of REQUEST_SECTIONS) {
    const m = md.match(new RegExp(`^#{2,3}\\s*${s.heading.source}[^\\n]*\\n([\\s\\S]*?)(?=^#{1,3}\\s|(?![\\s\\S]))`, "im"));
    if (!m) continue;
    let n = 0;
    for (const line of m[1]!.split("\n")) {
      const b = line.match(/^\s*[-*]\s+(.+?)\s*$/);
      if (!b) continue;
      const text = b[1]!.replace(/^\*{2}(.+?)\*{2}$/, "$1").trim();
      if (!text || /^<.*>$/.test(text)) continue;
      out.push({ id: `${s.prefix}${++n}`, kind: s.kind, text });
    }
  }
  return out;
}

export function requestNote(items: RequestItem[]): string {
  if (!items.length) return "";
  const label = { judge: "will judge it by", wrong: "says wrong looks like", immovable: "says must not change" } as const;
  return (
    `## The requester's own criteria\n\n` +
    `These lines are the requester's, not a checklist. Each J and W line is a done-check (say which D under \`## Request\` in PROBLEM.md: \`- J1: adopted as D3\`), ` +
    `or is dismissed with the reason (\`- W2: dismissed — …\`). Each M line goes in Given marked *(immovable)* and is disposed as \`- M1: immovable — <where it lives>\`; ` +
    `no done-check may need it moved, and a unit that touches it is not workable. If a J or W line cannot be met without moving an M line, dispose it \`- J2: dismissed — conflicts with M1: <why>\`; the loop stops there, since that is a defect in the request, cheapest found now.\n\n` +
    items.map((i) => `- **${i.id}** (${label[i.kind]}) ${i.text}`).join("\n")
  );
}

/** The paths or names the request says must not change, for the plan lint. */
export function immovableOf(items: RequestItem[]): string[] {
  return items.filter((i) => i.kind === "immovable").map((i) => i.text);
}

/**
 * The cases a done-check list forgets when nobody asks for them. The strong Solvers wrote these unprompted
 * (snippet-vault, 2026-09-19); Sonnet did not. Behind POLYA_ORACLE so the ledger alone can be measured first.
 */
export const ORACLE: { id: string; text: string }[] = [
  { id: "O1", text: "Bad input is refused with a clear error and changes nothing (a missing field, a wrong type, an over-long value)." },
  { id: "O2", text: "The empty state says so: nothing stored yet, and no matches, each shows a message rather than nothing." },
  { id: "O3", text: "A failed action is visible: a failed save, copy, or request tells the user it failed; it never looks like success." },
  { id: "O4", text: "Malformed requests or arguments get an answer and the process keeps running (//, %2f, a 2 KB path, a wrong method, an unknown flag, empty stdin)." },
  { id: "O5", text: "What is stored survives a restart of the process." },
  { id: "O6", text: "It installs and runs on the exact minimum runtime version it declares." },
  { id: "O7", text: "The exact command the requester says they will type works as they said." },
  { id: "O8", text: "A stranger installs and runs it from the repo's own documentation, without being told the commands." },
];

export function oracleNote(): string {
  return (
    `## Oracle: cases a done-check list forgets\n\n` +
    `For each line, either adopt it as a done-check (and say which D) or dismiss it with the reason it does not apply to this problem. ` +
    `With the oracle the done-check limit is ten, not eight. Write the dispositions under \`## Oracle\` in PROBLEM.md, one bullet per line: \`- O1: adopted as D4\` or \`- O2: dismissed — the tool stores nothing\`.\n\n` +
    ORACLE.map((o) => `- **${o.id}** ${o.text}`).join("\n")
  );
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
const COMMAND_HEAD =
  /^(?:!\s*)?(npm|npx|pnpm|yarn|node|deno|bun|curl|wget|sh|bash|zsh|git|python3?|pytest|pip|go|cargo|make|mvn|gradle|dotnet|ruby|bundle|\[|ls|cat|grep|diff|cmp|wc|jq|docker|kubectl|railway|gh|rm|mkdir|cp|mv|touch|kill|sleep|printf|echo|env|shasum|sha256sum|for|while|if|cd|set|export|trap|true|false|exit|xargs|find|sort|head|tail|tee|tr|cut|awk|sed|seq)\b|^test\s+\S|^[A-Za-z_][A-Za-z0-9_]*=\S/;
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
  // Why it is red today is not the check.
  check = check.replace(/\s*(?:—|–|--|-)?\s*\b[Nn]ow:[\s\S]*$/, "");
  // A placeholder is `<name>` in the command itself; inside a quoted string it is text the command looks for
  // (live kv-api, 2026-09-20: `grep -q "/kv/<key>" README.md`).
  const unquoted = (c: string) => c.replace(/(["'])(?:\\.|(?!\1).)*\1/g, "");
  const isCommand = (c: string) => COMMAND_HEAD.test(c) && !LOOKS_LIKE_PATH.test(c) && /\s/.test(c) && !/<[a-z][\w-]*>/i.test(unquoted(c));
  // A fenced block is a script: its body runs as one command under `sh -c`, the language tag is not a line of it
  // (live jsoncount-depth, 2026-09-20: "```bash\nset -e\n…" ran `bash` first, which waits on stdin).
  const fence = check.match(/```[ \t]*(?:bash|sh|shell|zsh|console)?[ \t]*\n([\s\S]*?)```/);
  if (fence) {
    const body = fence[1]!.replace(/^\$ /gm, "").trim();
    const first = body.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? "";
    if (body && (isCommand(first) || /^set\s+-/.test(first))) return body;
  }
  // A command in the plan wraps across lines with the block's indentation; that is layout, not part of the command.
  const segments = [...check.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.replace(/\s*\n\s+/g, " ").trim().replace(/^\(\s*/, ""));
  const ticked = segments.filter(isCommand);
  // One command with a note ("`npm test` exits 0 with 1 pass") is that command. One command inside a sentence about
  // a person acting ("a stranger performs this after `npm ci && npm run dev`, opening …"; "create a snippet, stop the
  // server, …") is an observation: the Verifier's.
  const residue = check.replace(/`[^`]+`/g, " ");
  const someoneActs = /\b(stranger|person|someone|reader|user|opens?|opening|clicks?|clicking|types?|typing|pastes?|performs?|follows?|walks?|confirms?|creates?|stops?|restarts?|sees?|observes?)\b/i.test(residue);
  // What follows the command tells you which it is. "with a missing title …" says how to invoke it, so the quoted
  // part is a fragment of a procedure (the Verifier's). "exits 0 with 1 pass" reports its result, so it is a command.
  const firstWord = residue.trim().replace(/^[^A-Za-z]+/, "").split(/[^A-Za-z]/)[0]?.toLowerCase() ?? "";
  const modifiesInvocation = ["with", "for", "on", "against", "using", "from", "to", "into", "plus", "where", "whose"].includes(firstWord);
  // A check that opens with its command is that command; what follows is a note about its result ("— exit code 0,
  // the kill-and-restart subtest passes"), and a verb in the note is not a person acting (live kv-api, 2026-09-20).
  const leading = /^\s*`/.test(check);
  if (ticked.length === 1) return modifiesInvocation || (someoneActs && !leading) ? undefined : ticked[0];
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

const BAR_PURPOSES = ["install", "test", "lint", "typecheck", "start", "build", "dev"] as const;

/** The bar purpose a label names, or the one a well-known command implies (live jsoncount, 2026-09-20: prose labels, columns swapped). */
export function barPurposeOf(label: string, command: string): string | undefined {
  const l = label.toLowerCase();
  for (const p of BAR_PURPOSES) if (new RegExp(`(^|[^a-z])${p}([^a-z]|$)`).test(l)) return p;
  const c = command.trim().toLowerCase();
  if (/^(npm (ci|install|i)|pnpm (install|i)|yarn( install)?|pip install|poetry install|bundle install|go mod download)\b/.test(c)) return "install";
  if (/^(npm (run )?test|pnpm test|yarn test|pytest|go test|cargo test|node --test|dotnet test)\b/.test(c)) return "test";
  if (/^(npm (run )?lint|eslint|ruff|flake8)\b/.test(c)) return "lint";
  if (/^(npm run typecheck|tsc|mypy)\b/.test(c)) return "typecheck";
  if (/^(npm (run )?start|npm run dev)\b/.test(c)) return "start";
  if (/^(npm run build|cargo build|go build)\b/.test(c)) return "build";
  return undefined;
}

function cellCommand(cell: string): string | undefined {
  const tick = cell.match(/`([^`]+)`/)?.[1]?.trim();
  const raw = tick ?? cell.trim();
  return raw && !/^<.*>$/.test(raw) && !/^-+$/.test(raw) ? raw : undefined;
}

/** `| Purpose | Command |` in either column order, the purpose a word or a sentence, the command in backticks or bare. */
function parseBarTable(text: string | undefined): Record<string, string> {
  const bar: Record<string, string> = {};
  if (!text) return bar;
  let commandCol: number | undefined;
  for (const line of text.split("\n")) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    if (cells.length < 2 || cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (commandCol === undefined && cells.some((c) => /^(command|shell|purpose|step)$/i.test(c))) {
      const i = cells.findIndex((c) => /^(command|shell)$/i.test(c));
      commandCol = i === -1 ? 1 : i;
      continue;
    }
    const ci = commandCol ?? (cells[1]!.includes("`") || !cells[0]!.includes("`") ? 1 : 0);
    const command = cellCommand(cells[ci] ?? "");
    if (!command) continue;
    const label = cells.filter((_, i) => i !== ci).join(" ");
    const purpose = barPurposeOf(label, command);
    if (purpose && !(purpose in bar)) bar[purpose] = command;
  }
  return bar;
}

/** The json block's `bar`: `{install: "npm ci"}`, or a list of `{purpose|step|name, command}` rows. */
function barFromBlock(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const r of raw as Record<string, unknown>[]) {
      if (!r || typeof r !== "object" || typeof r.command !== "string") continue;
      const label = String(r.purpose ?? r.step ?? r.name ?? "");
      const purpose = barPurposeOf(label, r.command);
      if (purpose && r.command.trim() && !/^<.*>$/.test(r.command) && !(purpose in out)) out[purpose] = r.command.trim();
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string" && v.trim() && !/^<.*>$/.test(v)) out[k.toLowerCase()] = v.trim();
  }
  return out;
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
  const oracle: Record<string, string> = {};
  for (const m of (section(md, "Oracle") ?? "").matchAll(/^\s*[-*]\s*\*{0,2}(O\d+)\*{0,2}\s*[:—–-]\s*(.+)$/gm)) oracle[m[1]!] = m[2]!.trim();
  const request: Record<string, string> = {};
  for (const m of (section(md, "Request") ?? "").matchAll(/^\s*[-*]\s*\*{0,2}([JWM]\d+)\*{0,2}\s*[:—–-]\s*(.+)$/gm)) request[m[1]!] = m[2]!.trim();
  const barMd = parseBarTable(section(md, "Quality bar"));
  const barBlock = barFromBlock(block?.bar ?? block?.quality_bar);
  const bar = Object.keys(barMd).length ? barMd : barBlock;
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
    oracle,
    request,
  };
}

/** What Understand must get right before a plan is drawn (PATTERN.md section 2.1). */
export function problemGaps(p: Problem | undefined, opts: { maxDone?: number; software?: boolean; offeredLessons?: string[]; oracle?: boolean; request?: RequestItem[] } = {}): string[] {
  const gaps: string[] = [];
  if (!p) return ["- PROBLEM.md is missing or has no `# Problem:` title"];
  const max = opts.maxDone ?? 8;
  if (!p.done.length) gaps.push("- no done-checks: list D1..Dn under `## Done-check`, each `- D<n>: <statement> — Check: <what a stranger runs> — Now: unmet|met`");
  if (p.done.length > max) gaps.push(`- ${p.done.length} done-checks; at most ${max}. More means the problem is not yet understood, or is size L and needs a Split table`);
  for (const d of p.done) if (!d.check) gaps.push(`- ${d.id} has no Check`);
  for (const d of p.done) if (d.check.includes("\0")) gaps.push(`- ${d.id}'s Check contains a NUL byte; a shell cannot run it (write the escape as text)`);
  if (!p.restated) gaps.push("- no `## Restated` section in your own words");
  if (p.size === "L" && !p.split.length) gaps.push("- Size L but no `## Split` table: sub-problems, the existing check that bounds each, the D ids each carries");
  if (p.split.length) {
    const carried = new Set(p.split.flatMap((s) => s.done));
    const lost = p.done.filter((d) => !carried.has(d.id)).map((d) => d.id);
    if (lost.length) gaps.push(`- Split carries no row for ${lost.join(", ")}; every D belongs to at least one sub-problem`);
  }
  if (opts.software && !p.bar.test) gaps.push("- `## Quality bar` names no `test` command; discover it from the repo (package.json scripts, Makefile, pyproject)");
  // A check that runs a server in the foreground never returns; the loop kills it at the timeout and calls it failed.
  for (const d of p.done) {
    if (!d.command) continue;
    const serves = /\bnpm (?:run )?(?:dev|start)\b|\bnode\s+[\w./-]*server[\w./-]*\.js\b|\bvite\b|\bnext dev\b/.test(d.command);
    // `a && b` is not backgrounding; `a & sleep 2; b` is.
    const backgrounded = /(^|[^&])&(?!&)|\btimeout\s|\bnohup\b/.test(d.command);
    if (serves && !backgrounded) gaps.push(`- ${d.id}'s Check runs a server in the foreground (\`${d.command.slice(0, 60)}…\`), which never exits; background it (\`… & sleep 2; curl …\`) or make it an observation a stranger walks`);
  }
  for (const id of opts.offeredLessons ?? []) if (!p.lessons.some((l) => l.id === id)) gaps.push(`- ${id} was offered and has no disposition under \`## Lessons consulted\``);
  if (opts.oracle) {
    for (const o of ORACLE) {
      const d = p.oracle[o.id];
      if (!d) gaps.push(`- ${o.id} has no disposition under \`## Oracle\` (adopt it as a D, or dismiss it with a reason)`);
      else {
        const adoptedAs = d.match(/adopted[^D]*(D\d+)/i)?.[1];
        if (adoptedAs && !p.done.some((x) => x.id === adoptedAs)) gaps.push(`- ${o.id} is adopted as ${adoptedAs}, which is not a done-check`);
      }
    }
  }
  for (const r of opts.request ?? []) {
    const d = p.request[r.id];
    if (!d) {
      gaps.push(r.kind === "immovable" ? `- ${r.id} (must not change: ${r.text.slice(0, 60)}) has no disposition under \`## Request\` (\`- ${r.id}: immovable — <where it lives>\`)` : `- ${r.id} (the requester's: ${r.text.slice(0, 60)}) has no disposition under \`## Request\` (adopt it as a D, or dismiss it with a reason)`);
      continue;
    }
    if (r.kind === "immovable") {
      if (!/\bimmovable\b/i.test(d)) gaps.push(`- ${r.id} must be disposed \`immovable — <where it lives>\`; the requester said it may not change`);
      continue;
    }
    const adoptedAs = d.match(/adopted[^D]*(D\d+)/i)?.[1];
    if (adoptedAs && !p.done.some((x) => x.id === adoptedAs)) gaps.push(`- ${r.id} is adopted as ${adoptedAs}, which is not a done-check`);
    if (!adoptedAs && !/\bdismissed\b/i.test(d)) gaps.push(`- ${r.id}'s disposition is neither \`adopted as D<n>\` nor \`dismissed — <reason>\``);
  }
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
    // The `Now:` clause says why the Check is red today and may run over several lines quoting commands of its
    // own ("`npm ci` fails with …"); none of that is the Check. Nor is "— exits 0 when met".
    const check = (f.Check ?? "")
      .replace(/\s*(?:—|–|--|-)?\s*\b[Nn]ow:[\s\S]*$/, "")
      .replace(/\s*(?:—|–|--|-)\s*exits? 0 when met\.?\s*$/i, "")
      .trim();
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

/** A touched path is immovable when the request's line names it: the path itself, or a directory it sits under. */
function touchesImmovable(path: string, immovable: string): boolean {
  const p = path.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  const names = [...immovable.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).concat(immovable.match(/[\w.-]+(?:\/[\w.*-]+)+|[\w-]+\.[\w]{1,5}\b/g) ?? []);
  return names.some((n) => {
    const raw = n.trim();
    const m = raw.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!m || /\s/.test(m)) return false;
    if (m === p) return true;
    // Only something written as a path (a slash, or a trailing one) covers what sits under it. A bare word in
    // backticks (`bin`, `jsoncount`, a command or a field name) is not a directory (live jsoncount, 2026-09-20).
    return /\//.test(raw) && p.startsWith(`${m}/`);
  });
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
  opts: { maxTouches?: number; maxBodyLines?: number; maxDoSteps?: number; requireCommand?: boolean; exists?: (path: string) => boolean; doneIds?: string[]; knownUnitIds?: string[]; requireServes?: boolean; immovable?: string[] } = {},
): UnitProblem[] {
  const out: UnitProblem[] = [];
  const maxTouches = opts.maxTouches ?? 6;
  // A unit that carries the exact content of the files it produces is long and still one sitting; ~400 lines is about a 12 KB packet.
  // A unit that carries a whole server file runs long; ~600 lines is about an 18 KB packet, which the Hand handles.
  const maxBody = opts.maxBodyLines ?? 600;
  const maxDo = opts.maxDoSteps ?? 9;
  const doneIds = new Set(opts.doneIds ?? problem?.done.map((d) => d.id) ?? []);
  // When only some units are checked (a revised unit), the rest of the plan's ids still exist.
  const ids = new Set([...units.map((u) => u.id), ...(opts.knownUnitIds ?? [])]);
  for (const u of units) {
    const push = (problem: string) => out.push({ id: u.id, problem });
    if (!u.produces) push("no Produces:");
    if (!u.given) push("no Given: (the Hand may read nothing else; name every input by its owning location)");
    if (!u.do) push("no Do:");
    if (!u.touches.length) push("no Touches:");
    if (!u.check) push("no Check:");
    // A repair for the finish check or a review finding serves the whole job, not one done-check.
    if (!u.serves.length && opts.requireServes !== false) push("Serves: names no D");
    const unknownD = u.serves.filter((d) => !doneIds.has(d));
    if (unknownD.length && doneIds.size) push(`Serves: names D(s) that do not exist: ${unknownD.join(", ")}`);
    const unknownU = u.depends.filter((d) => !ids.has(d));
    if (unknownU.length) push(`Depends: names unit(s) that do not exist: ${unknownU.join(", ")}`);
    const tests = u.touches.filter((f) => TEST_FILE.test(f));
    if (tests.length) push(`Touches: names test file(s) (${tests.join(", ")}); a Check lives outside Touches`);
    const docs = u.touches.filter((f) => ARTIFACT_FILE.test(f));
    if (docs.length) push(`Touches: names plan artifact(s) (${docs.join(", ")})`);
    for (const f of u.touches) {
      const hit = (opts.immovable ?? []).find((m) => touchesImmovable(f, m));
      if (hit) push(`Touches: names ${f}, which the request says must not change (${hit.slice(0, 60)})`);
    }
    if (u.touches.length > maxTouches) push(`Touches: ${u.touches.length} entries; more than ${maxTouches} is more than one sitting (split the unit)`);
    if (u.check && opts.requireCommand && !u.command) push(`Check: is prose, not a command (${JSON.stringify(u.check.slice(0, 80))}); for software the Check is a command that exits 0 when met`);
    // A Playwright check needs the toolchain: the repo has the config, or a unit in this plan provides it (the scaffold).
    if (u.command && /\bplaywright\s+test\b/.test(u.command) && opts.exists) {
      const configured = ["playwright.config.js", "playwright.config.ts", "playwright.config.mjs", "playwright.config.cjs"];
      const inRepo = configured.some((f) => opts.exists!(f));
      const inPlan = units.some((s) => s.touches.some((t) => /(^|\/)playwright\.config\.[cm]?[jt]s$/.test(t)));
      if (!inRepo && !inPlan) push("Check: runs `playwright test` but neither the repo nor any unit provides playwright.config.*; add the scaffold unit (@playwright/test, the config with webServer, `npx playwright install chromium`) before the page units");
    }
    // A Check holds after every later unit too, since each unit's gate re-runs the passed units' Checks. One that asserts
    // the suite is red ("! npm test", "npm test; test $? -ne 0") is a transient state, not a Check: the unit that makes
    // the suite green fails it by construction (live cron-next, 2026-09-21: the Hand stopped to ask, correctly).
    if (u.command && /(^|[;&|]\s*)!\s*(npm|pnpm|yarn)\s+(run\s+)?test\b|\b(npm|pnpm|yarn)\s+(run\s+)?test\b[^;&|]*;\s*(test|\[)\s+"?\$\?"?\s+-ne\s+0/.test(u.command)) {
      push("Check: asserts that the test suite fails, which stops being true the moment a later unit makes it pass; a Check must hold from this unit on (assert what this unit produces: the files, the build, its own test)");
    }
    // A hash pins bytes. That is right for a file this unit writes whole, and wrong for one that already exists:
    // it demands the Hand reproduce the plan's imagined bytes instead of working behaviour (R0, U7).
    if (u.command && /\b(?:sha(?:256|1|512)(?:sum)?|shasum|md5sum|createHash)\b/.test(u.command) && opts.exists) {
      const hashed = (u.command.match(/readFileSync\(['"]([^'"]+)['"]|sha256sum\s+(\S+)|shasum[^|]*\s(\S+)/g) ?? [])
        .map((m) => m.match(/['"]([^'"]+)['"]|\s(\S+)$/)?.[1] ?? m.match(/\s(\S+)$/)?.[1])
        .filter((p): p is string => Boolean(p));
      const existing = hashed.filter((p) => opts.exists!(p));
      if (existing.length) push(`Check: hashes ${existing.join(", ")}, which already exists; a hash demands the exact bytes the plan imagined, so check the behaviour instead (a test) and keep hashes for files the unit writes whole`);
      // Prose drifts: a word wraps, a list renumbers, a trailing space goes. Check what the document says.
      const prose = hashed.filter((p) => /\.(md|markdown|txt|rst|adoc)$/i.test(p));
      if (prose.length) push(`Check: hashes ${prose.join(", ")}, which is prose; a Hand reproduces meaning, not bytes, so assert what the document must say (grep -qF for each command or section) instead of its sha256`);
    }
    if (u.command && /\bgit\s+(status|diff|log|show|ls-files)\b/.test(u.command)) {
      push("Check: inspects git; the loop commits the Hand's work before the Check runs and its ownership gate already enforces Touches, so check the files and the behaviour instead");
    }
    if (u.command) {
      if (opts.exists) {
        const paths = u.command.match(/[\w./-]+\.(?:test|spec)\.[jt]sx?|(?:^|\s)(?:test|tests|spec)\/[\w./-]+/g) ?? [];
        const missing = paths.map((p) => p.trim()).filter((p) => !opts.exists!(p));
        if (missing.length) push(`Check: names test file(s) not on disk: ${missing.join(", ")}; the red test is written at Devise`);
      }
    }
    // An installer writes a lock file. A unit that runs one and does not own that file fails the ownership gate
    // every attempt, and the orchestrator reverts what the installer wrote (R1a, U1).
    // Only a step that runs one, not a command quoted inside a file the unit writes (a README's own instructions).
    const doOutsideFences = u.do
      .split("\n")
      .filter((line, i, all) => all.slice(0, i).filter((l) => /^\s*```/.test(l)).length % 2 === 0 && !/^\s*```/.test(line))
      .join("\n");
    const installer = doOutsideFences.match(/\b(?:run|execute)\s+`?(npm (?:ci|install|i)|yarn(?: install)?|pnpm (?:install|i)|bundle install|pip install|cargo (?:build|fetch)|go mod (?:tidy|download))\b/i);
    if (installer) {
      const locks = [/package-lock\.json/, /yarn\.lock/, /pnpm-lock\.yaml/, /Gemfile\.lock/, /poetry\.lock|requirements\.txt/, /Cargo\.lock/, /go\.sum/];
      const owns = u.touches.some((t) => locks.some((re) => re.test(t)));
      if (!owns) push(`Do: runs \`${installer[1]}\`, which writes a lock file; Touches must name it (package-lock.json, yarn.lock, pnpm-lock.yaml, …) or the ownership gate reverts it every attempt`);
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
/** A command that serves, watches or previews never exits; it is the start probe, not a command that must exit 0. */
export const LONG_RUNNING_BAR = /^(start|dev|serve|server|watch|preview)$/i;

export function contractOf(p: Problem | undefined): QualityContract | undefined {
  if (!p || !Object.keys(p.bar).length) return undefined;
  const bar: Record<string, string> = {};
  let start: string | undefined;
  for (const [name, command] of Object.entries(p.bar)) {
    // R1b: `dev` in the bar made the finish check run a dev server to its timeout and grade exit 124 as a failure.
    if (LONG_RUNNING_BAR.test(name) || /\b(--watch|nodemon|vite|next dev|webpack serve)\b/.test(command)) {
      start ??= command;
      continue;
    }
    bar[name] = command;
  }
  if (!Object.keys(bar).length) return undefined;
  return { bar, start: start ? { command: start } : undefined, hygieneNeverTracked: DEFAULT_HYGIENE, rubricTargets: {} };
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
