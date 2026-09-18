import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SendFn } from "../../src/lib/build-loop.js";
import { cloneWorkspace, makeClaudeSend, publicGithubUrl } from "../../src/lib/engine-claude.js";
import { buildPrompt, loadTemplate } from "../../src/lib/prompts.js";
import { lenientJson } from "./blueprint-loop.js";

/**
 * Blind rubric scoring (PATTERN.md section 8). Candidates are copied,
 * stripped of everything that could name the engine that built them, shuffled,
 * and scored by a fresh read-only frontier session with the same prompt. The
 * engine is joined back after every score is in.
 */

export const CRITERIA = ["correctness", "security", "validation", "tests", "structure", "ux", "readme"] as const;
export type Criterion = (typeof CRITERIA)[number];

export interface RubricScore {
  score: number;
  evidence: string[];
}

export interface Rubric {
  scores: Record<Criterion, RubricScore>;
  total: number;
  blocking_issues: string[];
  verdict: "merge" | "merge-with-followup" | "do-not-merge";
}

export class RubricParseError extends Error {}

export function parseRubric(text: string | undefined): Rubric {
  const raw = lenientJson<Partial<Rubric>>(text);
  if (!raw || typeof raw !== "object" || !raw.scores) throw new RubricParseError("no json block with scores");
  const scores = {} as Record<Criterion, RubricScore>;
  for (const c of CRITERIA) {
    const s = (raw.scores as Record<string, Partial<RubricScore> | undefined>)[c];
    if (!s || !Number.isInteger(s.score) || (s.score as number) < 1 || (s.score as number) > 5) throw new RubricParseError(`criterion ${c}: score must be an integer 1-5`);
    const evidence = Array.isArray(s.evidence) ? s.evidence.filter((e): e is string => typeof e === "string" && e.trim() !== "") : [];
    if ((s.score as number) > 2 && !evidence.length) throw new RubricParseError(`criterion ${c}: a score above 2 needs evidence`);
    scores[c] = { score: s.score as number, evidence };
  }
  const total = CRITERIA.reduce((n, c) => n + scores[c].score, 0);
  const verdict = raw.verdict;
  if (verdict !== "merge" && verdict !== "merge-with-followup" && verdict !== "do-not-merge") throw new RubricParseError(`verdict must be merge | merge-with-followup | do-not-merge, got ${String(verdict)}`);
  return { scores, total, blocking_issues: Array.isArray(raw.blocking_issues) ? raw.blocking_issues.map(String) : [], verdict };
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function medianScores(runs: Rubric[]): { scores: Record<Criterion, number>; total: number } {
  const scores = {} as Record<Criterion, number>;
  for (const c of CRITERIA) scores[c] = median(runs.map((r) => r.scores[c].score));
  return { scores, total: median(runs.map((r) => r.total)) };
}

// ---------------------------------------------------------------------------
// Anonymisation
// ---------------------------------------------------------------------------

export const ENGINE_WORDS = /\b(claude|cursor|hybrid|qwen|ollama|composer|anthropic|sonnet|opus|gpt-oss|copilot|codex)[\w.:-]*/gi;
const STRIP_DIRS = [".git", ".runs", ".qwen", ".cursor", ".claude", ".aider.tags.cache.v4", "node_modules"];
const STRIP_FILES = /^\.aider/;

export interface Hygiene {
  removedDirs: string[];
  removedFiles: string[];
  hadLockfile: boolean;
  hadGitignore: boolean;
  trackedArtifacts: string[];
}

export function scrubText(text: string, words: string[] = []): string {
  let out = text;
  for (const w of words) if (w.trim()) out = out.split(w).join("[redacted]");
  return out.replace(ENGINE_WORDS, "[redacted]").replace(/^.*Co-Authored-By:.*$/gim, "");
}

/** Copy `src` to a throwaway dir with no history and no engine fingerprints; record what was removed. */
export function anonymise(src: string, opts: { words?: string[]; root?: string } = {}): { dir: string; hygiene: Hygiene } {
  const root = opts.root ?? join(tmpdir(), "quality-review");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "candidate-"));
  const trackedArtifacts: string[] = [];
  try {
    trackedArtifacts.push(
      ...execFileSync("git", ["ls-files"], { cwd: src, encoding: "utf8" })
        .split("\n")
        .filter((f) => /^(dist|build|coverage)\/|\.(db|sqlite3?)$|^\.env$|^\.qwen\/|^\.aider/.test(f)),
    );
  } catch {
    /* not a git checkout; nothing tracked to report */
  }
  cpSync(src, dir, { recursive: true, filter: (p) => !p.includes(`${join(src, "node_modules")}`) });
  const removedDirs: string[] = [];
  const removedFiles: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (STRIP_DIRS.includes(entry) && statSync(full).isDirectory()) {
      rmSync(full, { recursive: true, force: true });
      removedDirs.push(entry);
    } else if (STRIP_FILES.test(entry)) {
      rmSync(full, { force: true });
      removedFiles.push(entry);
    }
  }
  const words = [...(opts.words ?? [])];
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; description?: string; author?: unknown; repository?: unknown };
      if (pkg.name) words.push(pkg.name);
      pkg.name = "candidate";
      delete pkg.author;
      delete pkg.repository;
      if (pkg.description) pkg.description = scrubText(pkg.description, words);
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    } catch {
      /* leave it */
    }
  }
  for (const entry of readdirSync(dir)) {
    if (/\.md$/i.test(entry)) {
      const p = join(dir, entry);
      writeFileSync(p, scrubText(readFileSync(p, "utf8"), words));
    }
  }
  const hygiene: Hygiene = {
    removedDirs,
    removedFiles,
    hadLockfile: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "uv.lock", "poetry.lock", "go.sum"].some((f) => existsSync(join(dir, f))),
    hadGitignore: existsSync(join(dir, ".gitignore")),
    trackedArtifacts,
  };
  return { dir, hygiene };
}

/** Hygiene facts for the reviewer, with tool names scrubbed so the facts do not un-blind the review. */
export function formatHygiene(h: Hygiene): string {
  const removed = h.removedDirs.filter((d) => d !== ".git" && d !== "node_modules");
  const lines = [
    `- lockfile present: ${h.hadLockfile ? "yes" : "no"}`,
    `- .gitignore present: ${h.hadGitignore ? "yes" : "no"}`,
    `- agent tool or state directories that were tracked (removed for this review): ${removed.length ? `${removed.length} director${removed.length === 1 ? "y" : "ies"}` : "none"}`,
    `- build output, databases, env files, or tool state that were tracked: ${h.trackedArtifacts.length ? `${h.trackedArtifacts.length} file(s), e.g. ${scrubText(h.trackedArtifacts[0]!).replace(/^\.\[redacted\]/, ".<tool>")}` : "none"}`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export interface Candidate {
  spec: string;
  label: string;
  repo?: string;
  ref?: string;
  path?: string;
  engine?: string;
}

export function resolveHeadRef(repo: string, override?: string, gh: (args: string[]) => string = (args) => execFileSync("gh", args, { encoding: "utf8" })): string {
  if (override) return override;
  const pub = publicGithubUrl(repo);
  try {
    const prs = JSON.parse(gh(["pr", "list", "--repo", pub, "--state", "open", "--json", "headRefName", "--limit", "1"])) as { headRefName: string }[];
    if (prs[0]?.headRefName) return prs[0].headRefName;
  } catch {
    /* fall through */
  }
  try {
    const v = JSON.parse(gh(["repo", "view", pub, "--json", "defaultBranchRef"])) as { defaultBranchRef?: { name?: string } };
    if (v.defaultBranchRef?.name) return v.defaultBranchRef.name;
  } catch {
    /* fall through */
  }
  return "main";
}

/** A local checkout of the candidate to anonymise; URLs are cloned, paths copied. */
export function fetchCandidate(c: Candidate): string {
  if (c.path) return resolve(c.path);
  if (!c.repo) throw new Error(`candidate ${c.spec} has neither a repo nor a path`);
  const ref = c.ref ?? resolveHeadRef(c.repo);
  c.ref = ref;
  return cloneWorkspace(c.repo, ref);
}

export function parseCandidateSpec(spec: string, engines: Record<string, string> = {}): Candidate {
  const [target, ref] = spec.split("@");
  const isUrl = /^(https?:\/\/|git@)/.test(target!);
  const label = `candidate-${randomBytes(2).toString("hex")}`;
  const base: Candidate = { spec, label, ref: ref || undefined, engine: engines[target!] ?? engines[spec] };
  return isUrl ? { ...base, repo: target } : { ...base, path: target };
}

export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Running the review
// ---------------------------------------------------------------------------

export interface ReviewRun {
  rubric: Rubric;
  usd: number;
}

export interface CandidateResult {
  candidate: Candidate;
  hygiene: Hygiene;
  runs: ReviewRun[];
  median: ReturnType<typeof medianScores>;
  verdicts: Rubric["verdict"][];
  failures?: string[];
}

export interface QualityReviewRecord {
  at: string;
  promptHash: string;
  model: string;
  job: string;
  repeat: number;
  candidates: CandidateResult[];
  totalUsd: number;
}

export function promptHash(): string {
  return createHash("sha256").update(loadTemplate("architect-crew-gate/prompts/quality-review")).digest("hex").slice(0, 12);
}

export type ReviewSendFactory = (cwd: string, onCost: (usd: number) => void) => SendFn;

export const defaultReviewSend =
  (model: string): ReviewSendFactory =>
  (cwd, onCost) =>
    makeClaudeSend({
      cwd,
      model,
      onCost,
      tools: { allowed: ["Read", "Grep", "Glob", "Bash"], disallowed: ["Edit", "Write", "NotebookEdit", "MultiEdit"] },
      maxBudgetUsd: 8,
    });

export async function scoreCandidate(
  c: Candidate,
  opts: { job: string; repeat: number; sendFor: ReviewSendFactory; keep?: boolean; log?: (l: string) => void; words?: string[]; rawDir?: string },
): Promise<CandidateResult> {
  const src = fetchCandidate(c);
  const { dir, hygiene } = anonymise(src, { words: opts.words });
  const prompt = buildPrompt("architect-crew-gate/prompts/quality-review", "", { job: opts.job, hygiene: formatHygiene(hygiene) });
  const runs: ReviewRun[] = [];
  const failures: string[] = [];
  try {
    for (let i = 0; i < opts.repeat; i++) {
      // A review that ends without a parseable rubric is retried once with a pointed reminder; the raw reply is kept for the record.
      for (let attempt = 1; attempt <= 2; attempt++) {
        let usd = 0;
        const send = opts.sendFor(dir, (u) => {
          usd = u;
        });
        opts.log?.(`${c.label}: review ${i + 1}/${opts.repeat}${attempt > 1 ? " (retry)" : ""}`);
        const p = attempt === 1 ? prompt : `## Your previous reply had no scores block\n\nEnd this reply with the single fenced json block the Output section specifies. Nothing after it.\n\n---\n\n${prompt}`;
        // Not plan mode: in plan mode Claude Code writes a plan and asks to proceed. Read-only is the tool list.
        const turn = await send(p, { mode: "agent", fresh: true });
        if (turn.status !== "finished") {
          failures.push(`review ${i + 1} attempt ${attempt}: turn ${turn.status}`);
          continue;
        }
        try {
          runs.push({ rubric: parseRubric(turn.result), usd });
          break;
        } catch (err) {
          const file = opts.rawDir ? saveRawReply(opts.rawDir, `${c.label}-${i + 1}-${attempt}`, turn.result ?? "") : undefined;
          failures.push(`review ${i + 1} attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}${file ? ` (raw reply: ${file})` : ""}`);
          opts.log?.(`${c.label}: ${failures.at(-1)}`);
        }
      }
    }
  } finally {
    if (!opts.keep) rmSync(dir, { recursive: true, force: true });
  }
  if (!runs.length) throw new Error(`${c.label}: no review produced a rubric: ${failures.join("; ")}`);
  return { candidate: c, hygiene, runs, median: medianScores(runs.map((r) => r.rubric)), verdicts: runs.map((r) => r.rubric.verdict), failures };
}

function saveRawReply(dir: string, name: string, text: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `quality-review-raw-${name}.md`);
  writeFileSync(file, text);
  return file;
}

export function formatComparisonTable(results: CandidateResult[]): string {
  const head = ["engine", "repo", ...CRITERIA.map((c) => c.slice(0, 5)), "total", "verdict", "usd"];
  const rows = [...results]
    .sort((a, b) => b.median.total - a.median.total)
    .map((r) => [
      r.candidate.engine ?? "?",
      (r.candidate.repo ? publicGithubUrl(r.candidate.repo).split("/").slice(-1)[0] : r.candidate.path?.split("/").slice(-1)[0]) ?? r.candidate.spec,
      ...CRITERIA.map((c) => String(r.median.scores[c])),
      String(r.median.total),
      r.verdicts.every((v) => v === r.verdicts[0]) ? r.verdicts[0]! : r.verdicts.join("/"),
      `$${r.runs.reduce((n, x) => n + x.usd, 0).toFixed(2)}`,
    ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  const best = Math.max(...results.map((r) => r.median.total));
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(r)), "", `best median total ${best}; every other candidate's delta is best minus its total`].join("\n");
}

export function writeQualityRecord(stateDir: string, record: QualityReviewRecord): string {
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, `quality-${record.at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}
