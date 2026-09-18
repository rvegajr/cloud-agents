# The Architect Writes the Blueprint, the Crew Frames the House: Naming and Building the Pattern Behind the Hybrid Engine

## Why a $0.40 build scored 19/35 against a $6.65 one, what pattern fixes that, and the first slice of it that is built and tested

The hybrid engine (`ARTICLE-CLAUDE-MAX.md`, `src/lib/engine-local.ts`) sends Claude
Max the plan and a local Ollama model the grunt work. On snippet-vault it worked:
$0.40 of Max API-equivalent instead of $6.65, complete in six iterations. A blind
side-by-side code review then scored the two builds 19/35 and 29/35. The gap was
not features. It was a stub test that asserted nothing, a "restart" test that could
not fail, an eslint rule bent around one variable, `.qwen/` committed, `npm start`
broken from a clean clone, an import-time database singleton. The same model wrote
the code, verified the code, and certified the code. Nobody with standards looked
at it after the plan.

This article does two things: names the pattern that fixes that, and documents the
first slice of it — the deterministic gate — which is built, tested, and wired into
the hybrid engine as of this writing. The rest (a written standard of quality up
front, tests before code, a scripted QA pass, one independent review) is designed
and recorded in `.claude/plans/staged-launching-squirrel.md` but not yet built.

---

## 1. Is there a name for this?

Not one name. It is a composition of patterns that already have names, in three
different literatures, plus one metaphor from construction that turns out to be
almost literal.

**Orchestrator–workers and evaluator–optimizer.** Anthropic's own taxonomy of
agent workflows names the two halves of this directly. In the
[orchestrator–workers](https://www.anthropic.com/engineering/building-effective-agents)
pattern, "a central LLM dynamically breaks down tasks, delegates them to worker
LLMs, and synthesizes their results" — that is the architect turn producing
`TASKS.md`. In the evaluator–optimizer pattern, "one LLM call generates a
response while another provides evaluation and feedback in a loop" — that is the
gate-and-review stage, except here the first "evaluator" is not an LLM at all. It
is `npm test` exit codes.

**Architect/editor.** [Aider's architect mode](https://aider.chat/2024/09/26/architect.html)
splits "describe the solution" from "turn the description into edits" across two
models, and hit state of the art (85% on its benchmark) doing it: o1-preview as
architect, a cheaper model as editor. That is this repo's `executorNote` — the
instruction that Max's plan must contain exact code and exact commands because a
smaller model will execute it verbatim.

**Planner–executor.** The academic name for the same split, and the source of the
one finding that most shaped this design: the
[PEAR benchmark](https://arxiv.org/pdf/2510.07505) found planner quality
dominates outcome, and that the fix for a weak executor is not a stronger
executor — it is "structured, hierarchical plans with explicit dependencies" and
"checkpoints where executors validate plan adherence before proceeding."
[ADaPT](https://arxiv.org/pdf/2311.05772) measured the effect directly: a plan
from a stronger model lifts a smaller executor's success rate by up to 20 points
on the same task.

**Repository Interface Blueprint.** [Co-Coder](https://arxiv.org/html/2606.00953)
names the specific artifact this pattern needs when the workers are writing code
that must fit together: a document, written before any implementation, that
enumerates every file's exported signatures. Partition work along that blueprint's
natural seams — cohesive files together, minimal coupling across the cut — and it
beat sequential building by 11–14 points; partition naively and cost rose 60% for
no quality gain, because "concurrently generated files frequently violate
cross-file type contracts."

**Spec-driven development.** [Kiro](https://medium.com/@visrow/comprehensive-guide-to-spec-driven-development-kiro-github-spec-kit-and-bmad-method-5d28ff61b9b1)
and [GitHub Spec Kit](https://www.marktechpost.com/2026/05/08/9-best-ai-tools-for-spec-driven-development-in-2026-kiro-bmad-gsd-and-more-compare/)
are this same idea productized: requirements, then design, then small tasks with
acceptance criteria "specific enough to become tests." Both tools write the tests
before the implementation and confirm they fail, for the reason test-driven
development has always given: a test written to match code confirms what the code
does; a test written first confirms what the code is supposed to do.

**The construction metaphor.** The user's framing — an architect and a blueprint
mean you do not pay skilled money to nail up walls — is not just a metaphor
reaching for a familiar shape. It is showing up as the literal frame practitioners
use in 2026 for this exact division of labor: "the engineer's role transforms from
that of a craftsman building components to that of an architect defining the
blueprint and a general contractor orchestrating the build," with "the ability to
decompose a complex business problem into a coherent, implementable architecture"
named as the paramount skill. An architect does not inspect a house by asking the
framing crew whether the walls are straight. A building inspector measures them.

Put together, the fitting name for this repo's version is **architect–crew–gate**:
an architect turn (orchestrator, planner, spec-driven design) that produces a
blueprint a crew (local worker, executor, editor) can follow without judgment
calls, checked by a gate that does not ask the crew's opinion (evaluator, building
inspector) before a much smaller number of Max turns exercise actual judgment
(optimizer, reviewer, architect's final walk-through).

```
        ARCHITECT                    CREW                    GATE / QA / REVIEW
   (Claude Max, few turns)     (local model, many turns)    (deterministic + local + one Max turn)
   ──────────────────────      ──────────────────────       ────────────────────────────────────
   orchestrator-workers   ──►  worker                  ──►  evaluator-optimizer
   architect (aider)      ──►  editor (aider)          ──►  (the "editor" never grades itself)
   planner (PEAR/ADaPT)   ──►  executor                ──►  adherence checkpoint (PEAR)
   Repository Interface   ──►  file-scoped task        ──►  cross-file contract check (Co-Coder)
     Blueprint (Co-Coder)
   requirements + design  ──►  task, acceptance         ──►  tests written before code,
     (Kiro/Spec Kit)            criteria = tests              confirmed red, then green
   architect               ──►  framing crew             ──►  building inspector, then
     (construction)                                            the architect's final walk-through
```

---

## 2. What is actually built: the gate

The gate is the "evaluator" and "building inspector" row: the part of the pattern
that needs no model at all, costs nothing, and would have caught every defect the
blind review found on snippet-vault except the ones that need judgment (the
half-written attribute escaper, the import-time singleton as an architectural
choice rather than a lint violation). It lives in `architect-crew-gate/src/quality-gate.ts` and
runs after every local turn inside `createHybridHandle` (`src/lib/engine-local.ts`),
before the turn's result is trusted.

Five checks, each producing a `GateFinding` the model never gets to argue with:

- **Ownership.** A crew may *create* a new test, a new eslint config, a new
  `package.json` script — that is what a walking-skeleton milestone legitimately
  does. Going back later to *modify* one of those is flagged: `git diff
  --name-status` distinguishes `A` from `M`, and only `M` against
  `test/**`, `eslint.config.*`, `tsconfig*.json`, and similar is a violation. A
  fixed set of documents — `SPEC.md`, and once the blueprint stage lands,
  `REQUIREMENTS.md`/`QUALITY.md`/`DESIGN.md`/`TASKS.md`/`QA.md` — are owned by the
  architect from the first character; touching them at all fails the turn.
  `ROADMAP.md` is deliberately excluded: the existing loop requires the crew to
  tick its own status lines.
- **Quality bar.** Whatever `lint`, `typecheck`, `test`, `build` scripts the repo
  actually defines must exit 0. `SPEC.md`'s own "Quality bar" section is checked
  against `package.json` and any script it promises but does not define is a
  separate finding.
- **Hygiene.** `git ls-files` must never contain `.qwen/`, `.aider*`,
  `.cursor/worktrees/`, build output, a database file, or `.env` — the exact class
  of thing the blind review found committed.
- **Tamper.** Beyond the ownership diff: `package.json` scripts compared against
  a baseline captured the first time they exist, an eslint config's
  `varsIgnorePattern` checked against the standard `^_` (the review's exact
  finding — a pattern of `^_|updatedSnippet` fails), test files that import none
  of the app's own source, and skipped or `.only` tests.
- **Clean-start and vacuous-suite.** A real `git clone` into a scratch directory,
  `npm ci`, then either `npm start` answering HTTP within 30 seconds or a CLI's
  `--help` exiting 0 — every Nth iterate turn and always at finish. At finish, every
  file in `src/` is overwritten with a throw, the suite re-run, and required to
  fail; if it still passes, the tests assert nothing about the application, which
  is precisely what the blind review found in the unguarded build.

A failed gate is not reported to the loop as the model's own failure. It is
rewritten as feedback — the failing rule, the command, the last forty lines of
output — and handed back for up to `LOCAL_GATE_RETRIES` (default 2) attempts,
using the same continuation mechanism already built for qwen-code's hardcoded
100-tool-call cap. Only after retries are exhausted does the turn count as failed,
at which point the existing Claude rescue path can take over if the policy allows
it. Nothing about this required Max; the entire gate runs on the box already
running Ollama.

New repos also get seeded once, before any turn: `target-repo-kit/AGENTS.md`
(trimmed of the Cursor-specific lines), a `QWEN.md` pointer — verified against the
installed `@qwen-code/qwen-code` package that this is the file it actually
auto-loads, not `AGENTS.md` — and a merged `.gitignore` covering the hygiene
patterns above, committed as `chore: seed agent kit`.

### A production bug the tests found, not a test artifact

Writing the end-to-end test (a real bare git origin, a real clone, a faked model
harness, a real gate) surfaced a real bug: gate subprocesses were inheriting
`NODE_TEST_CONTEXT` and `NODE_TEST_WORKER_ID` from whatever process launched the
orchestrator. Node's own `--test` runner treats those as "I am already inside a
test run" and silently skips execution, reporting success regardless of what the
code does. Any target repo using `node --test` would have had its gate always
pass, in any context where the orchestrator itself happened to be invoked under a
test runner. Fixed by stripping both variables from every gate subprocess's
environment (`subprocessEnv` in `quality-gate.ts`) — the same instinct behind
`scrubbedEnv()` for the model harness, applied to the gate.

### Coverage

`architect-crew-gate/src/quality-gate.test.ts` (unit, fake exec),
`quality-gate.integration.test.ts` (real `npm`/`git` against a throwaway fixture
repo), and `gate-hook.test.ts` (`createHybridHandle` end to end against a real bare
git origin, a faked local-model harness, a real gate) — 15 tests, all passing
alongside the existing 112. `npx tsc --noEmit` clean.

---

## 3. What is designed but not built

The architect and review rows of the diagram above — `REQUIREMENTS.md` and
`QUALITY.md` written before design, `DESIGN.md` as a Repository Interface
Blueprint with ports segregated per consumer (ISP), tests written and committed
red before any implementation, `TASKS.md` as file-exclusive units of work sized to
one crew turn, a scripted `QA.md` a local model executes black-box against a fresh
clone, and one read-only Max review turn with a fresh session that trusts nothing
the crew or QA reported — are specified in full, including prompt text, routing
rules, record shapes, and the experiment that will measure whether they close the
19/35-versus-29/35 gap, in `PATTERN.md` and `ROADMAP.md` beside this file. None of
that is implemented yet. The gate above is the piece that does not depend on any
of it and was worth shipping first.

---

## Sources

- [Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents) — Anthropic; orchestrator–workers, evaluator–optimizer.
- [Separating code reasoning and editing](https://aider.chat/2024/09/26/architect.html) — aider; architect/editor benchmark.
- [PEAR: Planner-Executor Agent Robustness Benchmark](https://arxiv.org/pdf/2510.07505)
- [ADaPT: As-Needed Decomposition and Planning with Language Models](https://arxiv.org/pdf/2311.05772)
- [Co-Coder: Cohesion-Aware Task Partitioning for Multi-Agent Coding](https://arxiv.org/html/2606.00953)
- [Comprehensive Guide to Spec-Driven Development: Kiro, GitHub Spec Kit, BMAD-METHOD](https://medium.com/@visrow/comprehensive-guide-to-spec-driven-development-kiro-github-spec-kit-and-bmad-method-5d28ff61b9b1)
- [9 Best AI Tools for Spec-Driven Development in 2026](https://www.marktechpost.com/2026/05/08/9-best-ai-tools-for-spec-driven-development-in-2026-kiro-bmad-gsd-and-more-compare/)
- Spec-driven development task sizing: [Nimbalyst](https://nimbalyst.com/blog/spec-driven-development-with-coding-agents/)
- The architect/general-contractor framing for AI-assisted engineering, 2026: [Tech Champion](https://tech-champion.com/software-engineering/the-architects-renaissance-how-agentic-coding-is-redefining-the-engineers-role/)
