# Next session: experiments to raise quality and lower cost

*Written 2026-09-19 after five live runs. Read this first; `ROADMAP.md` has
the evidence. Each experiment changes one thing and is scored blind against
fixed anchors, so a result means something.*

## Where we are

| Build (snippet-vault) | Solver | Blind /35 | Max API-eq |
| --- | --- | --- | --- |
| `rvegajr/polya-live-snippet-vault` | Sonnet, default | 29 | $6.39 |
| `rvegajr/polya-live-sv-opus` | Opus, max effort | 34 | $35.78 |
| `rvegajr/polya-live-sv-fable` | Fable 5.1, max effort | 34 | $31.51 |

Scored together, `quality-review`, sonnet, repeat 3, prompt `baefefce9cfc`.
The Hand passed 20 of 20 units first try across all builds. The 5-point gap
was done-checks: the strong Solvers wrote negative-case tests, an empty
state, and a visible failed save; Sonnet did not. Structure capped every
build at 4 because the loop's files sit at the repo root.

**The two questions this session answers.**

1. Can the cheap Solver reach 34 at $6? Either through the ledger alone
   (the pattern improving itself) or with an oracle checklist in the prompt.
2. Does moving the loop's files to `.polya/` take structure from 4 to 5?

## Before any experiment

1. Merge PR #8 (`fix/polya-live-run-1`, mergeable). Then branch
   `feat/polya-next` from main.
2. Curate the ledger by hand, ten minutes. It holds 12 entries, 7 added by the
   Opus and Fable runs. Rules: every entry's `Lesson` reads on its own (the
   current `L-2026-09-19-08` says "that exact command" and means nothing
   without its `When`); merge `-03` and `-07` (both are "the unit's Check
   must prove only Touches changed"); keep confirmations. Commit as
   "ledger: curated after five runs". This curated ledger is the input to R0.

## Code changes (no Max spend), in this order

**C1. The loop's files move to `.polya/`.** `ARTIFACTS` in `src/plan.ts` is
the single rename point: `.polya/PROBLEM.md`, `.polya/PLAN.md`,
`.polya/LOOKBACK.md`. Update the five prompts, `ARTIFACT_FILE` in
`plan.ts`, `finishAllowed` in the loop, and the prior-lessons read of the
target's LOOKBACK.md. Stop shipping the kit's template AGENTS.md on a polya
run: Understand writes a filled AGENTS.md into `Unknown` (ledger
`L-2026-09-19-06`) or the seed skips it for `--loop polya`; pick the second
unless the first is one line. Tests: every existing loop test passes with
the new paths; one test that a Hand touching `.polya/` fails ownership.

**C2. The Verifier walks two checks per turn.** Three of three builds the
local Verifier hit qwen-code's tool-call cap on five or six page checks,
spent 26 to 37 minutes, and fell back to the frontier at $5 to $6. Batch the
prose done-checks two per `walk` turn in the same fresh clone; fallback per
batch, as ACG's QA does. Test: six prose checks make three walk turns;
a silent batch falls back alone.

**C3. The ledger stays readable.** At most two appends per run; a lesson
whose words overlap an existing entry's by 60 % or more confirms that entry
instead of appending; an empty `When` is rejected. Tests in
`lessons.test.ts`.

**C4. The oracle checklist, built but off by default.** An `## Oracle`
block in `prompts/understand.md`, gated by `{{oracle}}` so R0 can run
without it. Per problem kind, lines the Solver must adopt as a done-check
or dismiss with a reason: *refuses bad input with a clear error; the empty
state says so; a failed action is visible to the user; malformed requests
get an answer and the process lives; state survives a restart; runs on the
stated minimum version.* A CLI kind gets its own lines (bad arguments,
empty stdin, non-zero exit on error). `problemGaps` reports an oracle line
with no disposition. Env: `POLYA_ORACLE=1`.

`npm test` with the real exit code, `npx tsc --noEmit`, commit per change.

## Runs (Max spend), one variable each

Every run: `--loop polya --engine hybrid --idea-file ideas/example-snippet-vault.md --create-repo <name>`.
Solver is Sonnet at default effort unless stated. C1 to C3 are in every run;
they do not touch the Solver's judgment.

| Run | Variable | Repo | Hypothesis | Est. Max |
| --- | --- | --- | --- | --- |
| **R0** | the curated ledger only | `polya-live-sv-r0` | the ledger alone lifts Sonnet to ≥ 32 | $7 |
| **R1** | R0 + `POLYA_ORACLE=1` | `polya-live-sv-r1` | the oracle lifts Sonnet to ≥ 33 | $7 |
| **R2** | only if R1 < 33: Understand on Opus max, Devise and review on Sonnet | `polya-live-sv-r2` | the checks come from Understand, so one strong turn is enough | $15 |

R2 needs a per-kind model: `CLAUDE_MODEL_UNDERSTAND`, `CLAUDE_EFFORT_UNDERSTAND`
read in `runTier` (`src/lib/engine-local.ts`) and passed through `SendOpts`
to `makeClaudeSend`, which today takes one model for the handle. Build it
only if R2 is needed.

**Scoring, once, after the runs.** One `quality-review` invocation with the
three anchors above plus every new build, `--repeat 3`, same prompt hash.
About $0.50 per review, so five candidates is about $8.

**Generality check, if budget allows.** The winning configuration on
`ideas/ready/farm-json-lines.md`, a CLI with no web page, so the result is
not tuned to one idea. Judged on absolute terms: verdict merge, correctness
5, no Verifier fallback. About $7.

## Decision rules

| Result | Decision |
| --- | --- |
| R0 ≥ 32 | The ledger works as designed: the pattern improves itself. Record it as the headline in ROADMAP. |
| R1 ≥ 33 | Sonnet plus oracle is the default Solver. Opus or Fable only for size L. `POLYA_ORACLE=1` becomes the default. |
| R1 < 33, R2 ≥ 33 | Split tier is the default: strong Understand, Sonnet elsewhere. |
| Both < 33 | Strong Solver for builds; Sonnet for repairs. Stop tuning prompts. |
| Structure still ≤ 4 with `.polya/` | Read the reviewers' evidence. If they cite the folder, the rubric penalises any process record; stop spending on it. |
| Any Verifier fallback after C2 | Two checks per turn is still too many for the local model: go to one. |

## Budget and stop rules

- Max weekly window was 44 % at the end of this session. Stop starting runs
  at 75 %; the engine diverts at 85 %.
- Session budget: about $45 Max API-eq (R0, R1, scoring, generality; R2
  only if needed). No second meter: Cursor, API key, and extra usage stay off.
- An orchestrator defect found mid-run is fixed, tested, and the run resumed
  with `--resume cc-…`, as this session did. It never counts against the
  model being tested.
- Close every run with its COST lines; close the session with
  `npm run cost-board`.

## Deliverables

- PR from `feat/polya-next`: C1 to C4 (and the per-kind model if R2 ran),
  tests, ROADMAP table with the new rows and the decision taken, CHANGELOG.
- The ledger as it stands after the runs, curated.
- This file replaced by the next one, or deleted if nothing is pending.
