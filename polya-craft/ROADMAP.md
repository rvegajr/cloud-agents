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

No code exists. There is no `src/` under this folder. Nothing has been run
through a model by this kit, and nothing has been measured. The pattern has
been used by hand only, in the three worked examples, which are written
walks and not recorded runs.

## Not built

In build order. Each line says what the module is and what it borrows.

1. `src/plan.ts`: parsers for `PROBLEM.md`, `PLAN.md`, and `LOOKBACK.md` (fenced `json` block first, markdown fallback, bare JSON accepted); `validateUnits`, the mechanical half of the stranger test from `PATTERN.md` section 3.1; `contractOf`, which derives a `QualityContract` from the `bar` table in `PROBLEM.md`. Borrows the parser shape from `../architect-crew-gate/src/blueprint.ts`.
2. `src/lessons.ts`: the ledger store. Select entries by tag intersection, append, promote and retire, lint (format, unique ids, active count at most 50). Renders the prior-lessons note for the Understand prompt, capped at 6000 characters. New.
3. `src/io.ts`: `makePolyaIO`, which wraps `../architect-crew-gate/src/io.ts` `makeRepoIO` and overrides `gate` to pass the contract from `contractOf`. This override is required: without a contract ACG's `runQualityBar` ignores per-unit commands and runs the whole suite, which is the defect ACG measured on its six-task build.
4. `src/polya-loop.ts`: the four stages over `send` and `io`, engine-free, as `../architect-crew-gate/src/blueprint-loop.ts` is. Stop reasons: `complete`, `understanding-incomplete`, `plan-not-workable`, `unit-not-workable`, `unit-gate-failed`, `finish-check-failed`, `verify-failed`, `review-unresolved`, `unparseable-report`, `run-failed`. Resume restarts at the stage that stopped; `unit-not-workable` restarts Devise for that unit only.
5. Kit wiring. `src/lib/routing.ts` learns the five prompts' H1 lines as regexes and their tiers (Solver turns to the frontier tier, Hand and Verifier to the local tier). `src/lib/engine-local.ts` treats Understand, Devise, and Look back (c) as architect kinds, runs Look back (c) read-only, and attaches the executor note to Devise. `src/lib/build-app.ts` adds `--loop polya` and `--max-units` (default 8). `package.json` extends the test glob; `tsconfig.json` adds the include.
6. Tests: parsers; the validator against units that pass and fail each row of the stranger test; the ledger (select, append, promote, retire, cap); prompt render, classify, and route for all five; the loop with faked `io` and `send` for every stop reason; end to end with a real bare origin, a real clone, a faked model, and the real gate, as `../architect-crew-gate/src/gate-hook.test.ts` does.
7. Browser for UI done-checks. A D whose Check names a page or a click needs the Verifier to hold a browser. Import `../architect-crew-gate/src/browser.ts` later; not in the first slice.
8. Parallel Hands: units with disjoint `Touches` and no `Depends` between them, one worktree each. After the first measurement, not before.
9. Slack stays on the milestone loop. `--loop polya` is CLI only.

## Known limitations

These are the orchestrator defects `../architect-crew-gate/ROADMAP.md`
measured on 2026-09-18. polya-craft has not run yet, so it has none of its
own. Each line is a defect the loop must not repeat and the design answer.

- A local architect that does not use tools writes nothing to disk. Answer: Solver turns run on the frontier tier by routing; a local Solver is opt-in and the loop materialises the three artifacts from the report before it validates them.
- Local models reply with bare JSON and no fence. Answer: every parser in `src/plan.ts` accepts a bare object.
- A task named the test file as its own file to change. Answer: `validateUnits` rejects any `Touches` entry that is a Check, a test, or a plan artifact; that is the Decide row of the stranger test, run mechanically.
- The task gate ran the whole suite, so the first task could never pass. Answer: `makePolyaIO` always passes a contract, and the unit profile runs the unit's Check plus the Checks of every unit already passed; only Look back (a) runs the full bar.
- A reviewer in plan mode wrote a plan and scored nothing. Answer: Look back (c) runs in agent mode with edit tools removed, as ACG's review now does.
- Prose where a shell command was expected. Answer: `plan-lint` rejects a `Check` that is prose when the kind is software, and every runnable Check is run at Devise and required to fail.
- A local QA analyst could not hold eleven scenarios in one turn. Answer: the Verifier walks the outer test in batches of the same size as ACG's `QA_BATCH`, in the same fresh clone, with the same frontier fallback.
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

**Phase 1, this PR: the pattern.** The documents, templates, prompts, ledger,
and examples listed under Built. No code. The exit criterion is that a person
can run `WALKTHROUGH.md` by hand and an AI can act on `THEORY.md` alone.

**Phase 2: the loop.** `src/plan.ts`, `src/lessons.ts`, `src/io.ts`,
`src/polya-loop.ts`, the kit wiring, and the tests, in that order. Exit: the
end-to-end test passes against a real bare origin and the real gate, and
`npm run build-app -- --loop polya` completes a repair on the hybrid engine.

**Phase 3: measure and decide.** Run the table above. Port the browser for UI
done-checks. Then decide which loop retires. If polya-craft scores within the
same band as ACG on the same problem and costs no more in Solver turns, ACG's
blueprint loop retires and its gate, repo I/O, browser, and scorer stay. If
not, polya-craft stays as documents and the ledger moves into ACG.
