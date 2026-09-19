# polya-craft: roadmap

2026-09-18. What exists, what does not, what is known to go wrong in the
sibling loop, and how the two will be compared. The design of each item is
in `PATTERN.md`; this file only tracks state.

## Built

- `WALKTHROUGH.md`: the pattern by hand, two chat windows and a terminal, on a grant proposal and a one-line bug.
- `THEORY.md`: the two-page version an AI can act on.
- `PATTERN.md`: the specification, sections 0 to 10.
- `examples/house.md`: a house, every stage, a human crew as the Hand.
- `templates/PROBLEM.md`, `templates/PLAN.md`, `templates/LOOKBACK.md`, `templates/ONE-PAGE.md`.
- `prompts/understand.md`, `prompts/devise.md`, `prompts/carry-out.md`, `prompts/verify.md`, `prompts/look-back.md`.
- `LESSONS.md`: the ledger, seeded with three process lessons from the house.
- `README.md`: the file table and the reading order.
- `ARTICLE.md`: where the pattern comes from.
- `src/plan.ts`: parsers for `PROBLEM.md` and `PLAN.md` (markdown first, the fenced `json` block fills gaps, bare JSON accepted); `validateUnits`, the mechanical half of the stranger test; `contractOf`; `renderProblem` and `renderPlan` for a Solver that reported but did not write.
- `src/lessons.ts`: the ledger store over one `LESSONS.md`: select by tag intersection (the whole ledger below forty active entries), append with day-numbered ids, confirm, and the prior-lessons note capped at 6000 characters.
- `src/io.ts`: `makePolyaIO`, architect-crew-gate's repo I/O with the gate reading the quality bar from `PROBLEM.md`.
- `src/polya-loop.ts`: the four stages over `send` and `io`. Stop reasons: `complete`, `understanding-incomplete`, `plan-not-workable`, `unit-not-workable`, `unit-gate-failed`, `finish-check-failed`, `verify-failed`, `review-unresolved`, `unparseable-report`, `run-failed`. `LOOKBACK.md` is written by the loop from evidence on every exit from look back, and the ledger is appended and confirmed.
- Kit wiring: `src/lib/routing.ts` (five H1 regexes; Solver turns to the plan tier, the Hand to implement, the Verifier to verify, Look back to review), `src/lib/engine-local.ts` (Understand and Devise are architect kinds; Look back runs read-only in a fresh session; Devise carries the executor note), `src/lib/build-app.ts` (`--loop polya`, `--max-units`, resume at the stage that stopped), `package.json` test glob, `tsconfig.json`.
- Tests: 48 across `plan`, `lessons`, `prompts`, the loop with a faked Hand and Solver (every stop reason, retry, fallback, resume, and materialisation path), and end to end on a real bare origin with the real gate, a real fresh clone, and a real ledger file.

Nothing has been run through a model by this kit, and nothing has been
measured. The pattern has been used by hand in the three worked examples,
which are written walks and not recorded runs, and by the end-to-end test
with a faked model.

## Not built

In build order. Each line says what the module is and what it borrows.

1. A live run. `npm run build-app -- --loop polya --engine hybrid` on a repair, then the measurement table below.
2. Browser for UI done-checks. A D whose Check names a page or a click needs the Verifier to hold a browser. Import `../architect-crew-gate/src/browser.ts`; not in the first slice.
3. Re-plan of one unit only. Today `unit-not-workable` re-runs Devise with the question prepended and keeps the units that passed; the Solver rewrites the plan, not one unit. A targeted single-unit re-plan is cheaper and should replace it once a live run shows how often a Hand asks.
4. Level checks at run time. `PLAN.md`'s Shape is parsed but the loop does not yet run a group's check when its units complete; the finish check and the done-checks cover the whole. Add when a plan with more than one L1 group has been run live.
5. Parallel Hands: units with disjoint `Touches` and no `Depends` between them, one worktree each. After the first measurement, not before.
6. Slack stays on the milestone loop. `--loop polya` is CLI only.

## Known limitations

These are the orchestrator defects `../architect-crew-gate/ROADMAP.md`
measured on 2026-09-18. polya-craft has not run live yet, so it has none of
its own. Each line is a defect the loop must not repeat and how the code
answers it.

- A local architect that does not use tools writes nothing to disk. Answer: Solver turns run on the frontier tier by routing; a local Solver is opt-in and the loop materialises the three artifacts from the report before it validates them.
- Local models reply with bare JSON and no fence. Answer: every parser in `src/plan.ts` accepts a bare object.
- A task named the test file as its own file to change. Answer: `validateUnits` rejects any `Touches` entry that is a Check, a test, or a plan artifact; that is the Decide row of the stranger test, run mechanically.
- The task gate ran the whole suite, so the first task could never pass. Answer: `makePolyaIO` passes the contract from `PROBLEM.md`, and the unit profile runs the unit's Check plus the Checks of every unit already passed; only Look back (a) runs the full bar. The end-to-end test asserts the unit gate ran `node --test test/greet.test.js` and the finish check ran `npm test`.
- A reviewer in plan mode wrote a plan and scored nothing. Answer: Look back (c) runs in agent mode with edit tools removed, as ACG's review now does.
- Prose where a shell command was expected. Answer: `plan-lint` rejects a `Check` that is prose when the kind is software, and every runnable Check is run at Devise and required to fail.
- A local QA analyst could not hold eleven scenarios in one turn. Answer: at most eight done-checks; those that are commands run mechanically and never reach the Verifier; the Verifier sees only the prose ones, with one reminder retry and the frontier fallback on hybrid.
- A project-scope MCP server is gated by qwen-code until a person approves it. Answer: the browser, when it is added, is passed with `--mcp-config` for that turn only and nothing is written into the clone.
- A long feedback note hid the prompt header from the router. Answer: the five H1 regexes are matched against the first 8000 characters, and the feedback note is appended after the header, never before it.

polya-craft also carries assumptions no run has tested.

- That the mechanical half of the stranger test catches enough of what makes a unit unworkable, and the Solver's judgment half covers the rest. The measure is the count of Hand questions per run.
- That eight units is the right cap before a problem must split. The house forced that split naturally; software may not.
- That a single append-only `LESSONS.md` scales. Fifty active entries with tag selection is the design; it has never held more than three.
- That the Verifier may be the same cheap model as the Hand. The claim is that being a stranger matters more than being smart. ACG's QA needed a frontier fallback for long batches, which is evidence against.

## Measurement status

Nothing measured.

The intended measurement is one problem run twice on the same day with the
same models: once under ACG's blueprint loop (`--loop blueprint`) and once
under polya-craft's (`--loop polya`), both on the hybrid engine. Both results
are scored blind in one invocation of `npm run quality-review` with ACG's
rubric unchanged, so deltas are comparable and totals are not quoted. Cost is
reported per meter, one line each, as the close of both runs.

| problem | engine | Solver turns | Hand turns | retries | questions from the Hand | blind score /35 | cost per meter |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | blueprint (ACG) | | | | | | |
| | polya | | | | | | |

The first problem should be a repair, as ACG's first run was: it exercises
every stage for the least cost. The second should be the snippet-vault build
already scored under four engines in `../architect-crew-gate/ROADMAP.md`, so
polya-craft's number lands in an existing table.

## Order of work

**Phase 1: the pattern.** The documents, templates, prompts, ledger,
and examples listed under Built. No code. The exit criterion is that a person
can run `WALKTHROUGH.md` by hand and an AI can act on `THEORY.md` alone.

**Phase 2: the loop.** Done. `src/plan.ts`, `src/lessons.ts`, `src/io.ts`,
`src/polya-loop.ts`, the kit wiring, and the tests. The end-to-end test
passes against a real bare origin and the real gate. Still to do from this
phase: `npm run build-app -- --loop polya` completing a repair on the hybrid
engine, which is the first row of the measurement table.

**Phase 3: measure and decide.** Run the table above. Port the browser for UI
done-checks. Then decide which loop retires. If polya-craft scores within the
same band as ACG on the same problem and costs no more in Solver turns, ACG's
blueprint loop retires and its gate, repo I/O, browser, and scorer stay. If
not, polya-craft stays as documents and the ledger moves into ACG.
