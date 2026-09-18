/**
 * Blind rubric review of one or more candidate repos (architect-crew-gate/PATTERN.md §8).
 *
 *   npm run quality-review -- --job-file ideas/example-snippet-vault.md \
 *     https://github.com/you/sv-claude https://github.com/you/sv-hybrid ./local/checkout \
 *     [--repeat 2] [--model sonnet] [--engine https://github.com/you/sv-claude=claude ...] [--dry-run] [--keep]
 *
 * Each candidate is cloned (open PR head, else default branch; `url@ref` pins one),
 * anonymised (no history, no tool dirs, engine words and the repo name scrubbed),
 * shuffled, and scored by a fresh read-only Claude session with the same prompt.
 * Engines are joined back only after every score is in. Spends Max: about one
 * review turn per candidate per repeat.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStateDir } from "./lib/build-app.js";
import { closeJobCost } from "./lib/cost-ledger.js";
import { assertClaudeCredential } from "./lib/engine-claude.js";
import { loadEnv, flags } from "./lib/env.js";
import { reportStartupFailure } from "./lib/report.js";
import {
  anonymise,
  defaultReviewSend,
  fetchCandidate,
  formatComparisonTable,
  formatHygiene,
  parseCandidateSpec,
  promptHash,
  scoreCandidate,
  shuffle,
  writeQualityRecord,
  type CandidateResult,
} from "../architect-crew-gate/src/quality-review.js";

loadEnv();
const args = flags();

/** Everything on argv that is not a flag or a flag's value. */
function positionals(argv = process.argv.slice(2)): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      if (!a.includes("=") && argv[i + 1] && !argv[i + 1]!.startsWith("--")) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

try {
  const specs = positionals();
  const job = args.job ?? (args["job-file"] ? readFileSync(resolve(process.cwd(), args["job-file"]), "utf8") : args["idea-file"] ? readFileSync(resolve(process.cwd(), args["idea-file"]), "utf8") : undefined);
  if (!specs.length || !job?.trim()) {
    console.error("usage: npm run quality-review -- (--job \"...\" | --job-file path) <repo-url[@ref] | path>... [--repeat N] [--model m] [--engine target=engine] [--dry-run] [--keep]");
    process.exit(1);
  }
  const engines: Record<string, string> = {};
  for (const e of process.argv.slice(2).flatMap((a, i, all) => (a === "--engine" ? [all[i + 1] ?? ""] : a.startsWith("--engine=") ? [a.slice(9)] : []))) {
    const [target, engine] = e.split("=");
    if (target && engine) engines[target] = engine;
  }
  const repeat = Math.max(1, Number(args.repeat ?? 1) || 1);
  const model = args.model ?? process.env.CLAUDE_MODEL?.trim() ?? "sonnet";
  const dryRun = args["dry-run"] === "true";
  const candidates = shuffle(specs.map((s) => parseCandidateSpec(s, engines)));
  const hash = promptHash();
  console.log(`quality-review: ${candidates.length} candidate(s), repeat ${repeat}, model ${model}, prompt ${hash}${dryRun ? ", DRY RUN" : ""}`);

  if (dryRun) {
    for (const c of candidates) {
      const src = fetchCandidate(c);
      const { dir, hygiene } = anonymise(src);
      console.log(`\n${c.label}  <- ${c.spec}${c.ref ? ` @${c.ref}` : ""}\n  anonymised at ${dir}\n${formatHygiene(hygiene).replace(/^/gm, "  ")}`);
    }
    console.log("\nno Max spent. Remove --dry-run to score.");
    process.exit(0);
  }

  assertClaudeCredential();
  const results: CandidateResult[] = [];
  for (const c of candidates) {
    try {
      results.push(await scoreCandidate(c, { job: job.trim(), repeat, sendFor: defaultReviewSend(model), keep: args.keep === "true", log: (l) => console.log(l), rawDir: buildStateDir() }));
    } catch (err) {
      console.error(`${c.label} (${c.spec}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!results.length) {
    console.error("no candidate produced a rubric");
    process.exit(2);
  }
  const totalUsd = results.reduce((n, r) => n + r.runs.reduce((m, x) => m + x.usd, 0), 0);
  console.log(`\n${formatComparisonTable(results)}`);
  for (const r of results) for (const f of r.failures ?? []) console.log(`note: ${r.candidate.engine ?? r.candidate.label}: ${f}`);
  const file = writeQualityRecord(buildStateDir(), { at: new Date().toISOString(), promptHash: hash, model, job: job.trim(), repeat, candidates: results, totalUsd });
  console.log(`\nrecord: ${file}`);
  try {
    const close = closeJobCost({ stateDir: buildStateDir(), project: "quality-review", cents: Math.round(totalUsd * 100), meter: "claude:api-eq", source: "quality-review" });
    console.log(`\n${close.close}`);
  } catch {
    /* ledger optional */
  }
  process.exit(0);
} catch (err) {
  process.exit(reportStartupFailure(err));
}
