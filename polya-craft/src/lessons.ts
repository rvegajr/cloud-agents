import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * The ledger (PATTERN.md section 5): one append-only LESSONS.md. Read at
 * Understand, written at Look back. Entries are selected by tag intersection;
 * a small ledger is handed over whole. Nothing here runs a model.
 */

export interface Lesson {
  id: string;
  tags: string[];
  when: string;
  lesson: string;
  evidence: string;
  status: "candidate" | "confirmed" | "retired";
  /** confirmed(n) */
  confirmations: number;
}

export interface NewLesson {
  tags: string[];
  when: string;
  lesson: string;
  evidence: string;
}

export interface LessonsStore {
  path: string;
  list(): Lesson[];
  /** Active entries whose tags intersect; the whole ledger when it is small. */
  select(tags: string[], opts?: { wholeBelow?: number }): Lesson[];
  /**
   * One result per entry, in order. An entry whose lesson says what an active entry already says (word overlap
   * at or above `MERGE_OVERLAP`) confirms that entry instead and comes back as it, with `merged: true`.
   */
  append(entries: NewLesson[], date?: Date): (Lesson & { merged?: boolean })[];
  /** A consulted lesson that helped: candidate -> confirmed(1), confirmed(n) -> confirmed(n+1). */
  confirm(ids: string[]): void;
}

const ENTRY = /^##\s+(L-[\w-]+)\s*$/m;

/** Two lessons whose content words overlap this much (against the shorter one) say the same thing. */
export const MERGE_OVERLAP = 0.6;

const STOP = new Set("the a an and or of to in on for with that this is are be by it its as at from not no when then than one each any every into".split(" "));

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,}/g) ?? []).filter((w) => !STOP.has(w)));
}

/** |A ∩ B| / min(|A|, |B|) over content words; 0 when either is empty. */
export function lessonOverlap(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size);
}

export function parseLessons(md: string): Lesson[] {
  const out: Lesson[] = [];
  const parts = md.split(/^(?=##\s+L-)/m).filter((p) => ENTRY.test(p.split("\n")[0] ?? ""));
  for (const part of parts) {
    const id = part.match(ENTRY)?.[1];
    if (!id) continue;
    const field = (name: string) => part.match(new RegExp("^" + name + ":[ \\t]*(.*)$", "im"))?.[1]?.trim() ?? "";
    const statusRaw = field("Status").toLowerCase();
    const n = Number(statusRaw.match(/confirmed\((\d+)\)/)?.[1] ?? 0);
    out.push({
      id,
      tags: field("Tags").split(/\s+/).filter(Boolean),
      when: field("When"),
      lesson: field("Lesson"),
      evidence: field("Evidence"),
      status: statusRaw.startsWith("retired") ? "retired" : statusRaw.startsWith("confirmed") ? "confirmed" : "candidate",
      confirmations: n,
    });
  }
  return out;
}

export function formatLesson(l: Lesson): string {
  const status = l.status === "confirmed" ? `confirmed(${l.confirmations})` : l.status;
  return `## ${l.id}\nTags:     ${l.tags.join(" ")}\nWhen:     ${l.when}\nLesson:   ${l.lesson}\nEvidence: ${l.evidence}\nStatus:   ${status}\n`;
}

const HEADER = "# Lessons\n\n<!-- The ledger. Append-only. One entry per lesson; PATTERN.md section 5 has the rules. -->\n";

export function defaultLessonsPath(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): string {
  return resolve(root, env.POLYA_LESSONS_FILE?.trim() || "polya-craft/LESSONS.md");
}

export function fileLessonsStore(path = defaultLessonsPath()): LessonsStore {
  const read = (): string => (existsSync(path) ? readFileSync(path, "utf8") : "");
  const write = (lessons: Lesson[], original: string) => {
    // Keep the preamble a person wrote; rewrite only the entries.
    const firstEntry = original.search(/^##\s+L-/m);
    const preamble = firstEntry === -1 ? original.trim() || HEADER.trim() : original.slice(0, firstEntry).trim();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${preamble}\n\n${lessons.map(formatLesson).join("\n")}`);
  };
  const store: LessonsStore = {
    path,
    list: () => parseLessons(read()),
    select: (tags, opts) => selectLessons(store.list(), tags, opts),
    append: (entries, date = new Date()) => {
      const original = read();
      const lessons = parseLessons(original);
      const day = date.toISOString().slice(0, 10);
      let n = lessons.filter((l) => l.id.startsWith(`L-${day}-`)).length;
      const out: (Lesson & { merged?: boolean })[] = [];
      let changed = false;
      for (const e of entries) {
        if (!e.lesson?.trim() || !e.when?.trim()) continue;
        const same = lessons.find((l) => l.status !== "retired" && lessonOverlap(l.lesson, e.lesson) >= MERGE_OVERLAP);
        if (same) {
          same.status = "confirmed";
          same.confirmations += 1;
          out.push({ ...same, merged: true });
          changed = true;
          continue;
        }
        n++;
        const l: Lesson = { id: `L-${day}-${String(n).padStart(2, "0")}`, tags: e.tags.filter(Boolean), when: e.when.trim(), lesson: e.lesson.trim(), evidence: e.evidence.trim(), status: "candidate", confirmations: 0 };
        lessons.push(l);
        out.push(l);
        changed = true;
      }
      if (changed) write(lessons, original);
      return out;
    },
    confirm: (ids) => {
      const original = read();
      const lessons = parseLessons(original);
      let changed = false;
      for (const l of lessons) {
        if (!ids.includes(l.id) || l.status === "retired") continue;
        l.status = "confirmed";
        l.confirmations += 1;
        changed = true;
      }
      if (changed) write(lessons, original);
    },
  };
  return store;
}

/**
 * The lessons an Understand turn is offered, and must dispose of one by one. Every corpus run (2026-09-21) paid an
 * Understand retry because the whole ledger, thirty-odd entries, was offered and the Solver missed a few dispositions.
 * At most `max` (default 12): the whole ledger while it is that small, else the best by tag overlap, then how often
 * confirmed, then recency.
 */
export function selectLessons(all: Lesson[], tags: string[], opts: { wholeBelow?: number; max?: number } = {}): Lesson[] {
  const active = all.filter((l) => l.status !== "retired");
  const max = opts.max ?? opts.wholeBelow ?? 12;
  if (active.length <= max) return active;
  const want = new Set(tags.map((t) => t.toLowerCase()));
  const score = (l: Lesson) => l.tags.filter((t) => want.has(t.toLowerCase())).length;
  return [...active]
    .map((l, i) => ({ l, i }))
    .sort((a, b) => score(b.l) - score(a.l) || (b.l.confirmations ?? 0) - (a.l.confirmations ?? 0) || b.i - a.i)
    .slice(0, max)
    .map(({ l }) => l);
}

/** Tags a problem statement carries before the Solver has read it: its kind if stated, the repo's name, and the file extensions it mentions. */
export function tagsForProblem(problem: string, repo?: string): string[] {
  const tags = new Set<string>();
  const kind = problem.match(/\b(repair|change|build|answer)\b/i)?.[1]?.toLowerCase();
  if (kind) tags.add(`kind:${kind}`);
  if (/\b(bug|defect|broken|regression|fix)\b/i.test(problem)) tags.add("kind:repair");
  if (/\b(proposal|document|report|migration|decide|decision)\b/i.test(problem)) tags.add("kind:answer");
  const name = repo?.replace(/\.git$/, "").split("/").filter(Boolean).at(-1);
  if (name) tags.add(`repo:${name.toLowerCase()}`);
  for (const m of problem.matchAll(/\.(ts|tsx|js|jsx|py|go|rs|cs|rb|java|sql|md)\b/g)) tags.add(`ext:${m[1]}`);
  tags.add("domain:software");
  return [...tags];
}

/** The `{{prior_lessons}}` slot: the target's own LOOKBACK.md first, then the selected ledger entries, capped. */
export function priorLessonsNote(entries: Lesson[], repoLookback?: string, cap = 6000): string {
  const parts: string[] = [];
  if (repoLookback?.trim()) parts.push(`### The last look back in this repo (LOOKBACK.md)\n\n${repoLookback.trim()}`);
  if (entries.length) parts.push(`### Ledger entries (list each under Lessons consulted with a disposition)\n\n${entries.map(formatLesson).join("\n")}`);
  if (!parts.length) return "(no prior lessons)";
  const text = parts.join("\n\n");
  return text.length > cap ? `${text.slice(0, cap)}\n\n(truncated at ${cap} characters)` : text;
}
