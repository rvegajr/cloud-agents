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
- Browser for the Hand and the Verifier: a unit or a done-check whose text names a page is sent with `browser: true`, and the engine attaches Playwright MCP to that turn only (`QA_BROWSER`, `PLAYWRIGHT_MCP_ARGS`, as ACG's QA). The prompt tells the model whether a browser is attached, absent, or unneeded. Imported from `../architect-crew-gate/src/browser.ts`, unchanged.
- Kit wiring: `src/lib/routing.ts` (five H1 regexes; Solver turns to the plan tier, the Hand to implement, the Verifier to verify, Look back to review), `src/lib/engine-local.ts` (Understand and Devise are architect kinds; Look back runs read-only in a fresh session; Devise carries the executor note), `src/lib/build-app.ts` (`--loop polya`, `--max-units`, resume at the stage that stopped), `package.json` test glob, `tsconfig.json`.
- Tests: 58 across `plan`, `lessons`, `prompts`, the loop with a faked Hand and Solver (every stop reason, retry, fallback, resume, and materialisation path), and end to end on a real bare origin with the real gate, a real fresh clone, and a real ledger file.

One live run on 2026-09-18 (the measurement table below). The pattern has
also been used by hand in the worked examples, which are written walks and
not recorded runs.

## Not built

In build order. Each line says what the module is and what it borrows.

1. The ACG row of the measurement table: the same repair under `--loop blueprint`, same day, same models, scored blind together. Then `examples/site-inspection.md` live, which is the browser's first real test.
2. Re-plan of one unit only. Today `unit-not-workable` re-runs Devise with the question prepended and keeps the units that passed; the Solver rewrites the plan, not one unit. A targeted single-unit re-plan is cheaper and should replace it once a live run shows how often a Hand asks.
3. A stranger test for done-checks. The `//` crash shows Understand writes checks for what the requester named. A mechanical probe list per problem kind (for a route: `//`, `%2f`, a 2 KB path, a wrong method) that the Solver must either adopt as done-checks or dismiss with a reason. Design first; the ledger carries it until then.
4. Level checks at run time. `PLAN.md`'s Shape is parsed but the loop does not yet run a group's check when its units complete; the finish check and the done-checks cover the whole. Add when a plan with more than one L1 group has been run live.
5. Parallel Hands: units with disjoint `Touches` and no `Depends` between them, one worktree each. After the first measurement, not before.
6. Slack stays on the milestone loop. `--loop polya` is CLI only.

## Known limitations

First, polya-craft's own, measured on the first live run (2026-09-18,
polya-live-404, hybrid). Both were in the orchestrator, not the models, and
both are fixed with the live artifacts as test fixtures.

- **The parser crashed on the Solver's json block.** Claude Max wrote `split: false`, `done_checks` for `done`, `statement` for `text`, `status` for `now`, `quality_bar` for `bar`, bold `**D1** —` ids over three lines, and a three-column bar table. The markdown was excellent; the parser read none of it and threw on the `false`. Answer: one bullet per D however it is laid out, aliases accepted, no field can throw, and the understand prompt states the exact shape. Cost: one Understand turn ($0.36 API-eq) that had to be resumed past by hand.
- **A backticked path became a shell command.** The Devise turn wrote prose in the Check field with `test/*.test.js` in backticks; `commandOf` joined it into `npm test && test/*.test.js`. The Hand's correct two-line fix failed the gate three times on a phantom command, and the gate feedback told it to fix something that did not exist. Answer: a backticked path or glob is a name, and `test` is a command only with an argument. Cost: three local turns (free) and one resume.
- **A done-check that curls the app needs the app up.** Not a defect the run hit, because it was fixed before look back ran, but the first PROBLEM.md exposed it: four of five checks curl `localhost:4571`. Answer: look back (b) starts the bar's `start` in the fresh clone for the checks and stops its process group after.
- **"No lesson" went into the ledger.** The reviewer wrote "No lesson: the plan held" as a lesson entry and the loop appended it. Answer: it stays in LOOKBACK.md, never the ledger.

What the models did right, for the record: the Understand turn found the defect's exact branch, wrote the reproduction as D1, named three invariants, and discovered the quality bar from package.json without inventing a lint command. The Devise turn wrote a red regression test with a bonus trailing-slash case, a unit whose Do quotes the exact lines to replace, and answered the first plan-lint gap (no Given) in one retry. The Hand, qwen3-coder-next, made the two-line fix on its first attempt with no question. The reviewer checked the result a second way, curling a server it started itself, and found nothing.

Then the orchestrator defects `../architect-crew-gate/ROADMAP.md`
measured on 2026-09-18, each with how the code answers it.

- A local architect that does not use tools writes nothing to disk. Answer: Solver turns run on the frontier tier by routing; a local Solver is opt-in and the loop materialises the three artifacts from the report before it validates them.
- Local models reply with bare JSON and no fence. Answer: every parser in `src/plan.ts` accepts a bare object.
- A task named the test file as its own file to change. Answer: `validateUnits` rejects any `Touches` entry that is a Check, a test, or a plan artifact; that is the Decide row of the stranger test, run mechanically.
- The task gate ran the whole suite, so the first task could never pass. Answer: `makePolyaIO` passes the contract from `PROBLEM.md`, and the unit profile runs the unit's Check plus the Checks of every unit already passed; only Look back (a) runs the full bar. The end-to-end test asserts the unit gate ran `node --test test/greet.test.js` and the finish check ran `npm test`.
- A reviewer in plan mode wrote a plan and scored nothing. Answer: Look back (c) runs in agent mode with edit tools removed, as ACG's review now does.
- Prose where a shell command was expected. Answer: `plan-lint` rejects a `Check` that is prose when the kind is software, and every runnable Check is run at Devise and required to fail.
- A local QA analyst could not hold eleven scenarios in one turn. Answer: at most eight done-checks; those that are commands run mechanically and never reach the Verifier; the Verifier sees only the prose ones, with one reminder retry and the frontier fallback on hybrid.
- A project-scope MCP server is gated by qwen-code until a person approves it. Answer: the browser is passed with `--mcp-config` for that turn only, through the engine's existing path, and nothing is written into the clone.
- A long feedback note hid the prompt header from the router. Answer: the five H1 regexes are matched against the first 8000 characters, and the feedback note is appended after the header, never before it.

polya-craft also carries assumptions no run has tested.

- That the mechanical half of the stranger test catches enough of what makes a unit unworkable, and the Solver's judgment half covers the rest. The measure is the count of Hand questions per run.
- That eight units is the right cap before a problem must split. The house forced that split naturally; software may not.
- That a single append-only `LESSONS.md` scales. Fifty active entries with tag selection is the design; it has never held more than three.
- That the Verifier may be the same cheap model as the Hand. The claim is that being a stranger matters more than being smart. ACG's QA needed a frontier fallback for long batches, which is evidence against.

## Measurement status

Both rows, one problem, same day, same models, scored blind together.

The intended measurement is one problem run twice on the same day with the
same models: once under ACG's blueprint loop (`--loop blueprint`) and once
under polya-craft's (`--loop polya`), both on the hybrid engine. Both results
are scored blind in one invocation of `npm run quality-review` with ACG's
rubric unchanged, so deltas are comparable and totals are not quoted. Cost is
reported per meter, one line each, as the close of both runs.

| problem | engine | Solver turns | Hand turns | retries | questions from the Hand | blind score /35 | cost per meter |
| --- | --- | --- | --- | --- | --- | --- | --- |
| polya-live-404 repair (unknown routes answer 200) | blueprint (ACG), hybrid, 2026-09-18 | 3 (requirements; blueprint; review) | 1 task gate-green first attempt + 2 QA batches | 0 | n/a | 27 (repeats: ~22, ~32) | Claude Max API-eq $1.07; Ollama $0 |
| polya-live-404 repair (unknown routes answer 200) | polya, hybrid, 2026-09-18 | 4 (understand; devise + 1 plan-lint retry; review) | 1 gate-green (+3 wasted on the orchestrator's phantom command, +1 on resume) | 0 real | 0 | 32.5 (repeats: 32, 33) | Claude Max API-eq $1.01; Ollama $0 |

Both runs completed. Both produced the identical two-line change to `src/app.js` (200 "ok" → 404 "not found" in the catch-all) plus red tests written by the Solver or architect. polya's PR adds 428 lines across three artifacts and one test file; ACG's adds 570 across five artifacts, two test files, a README line and a `.gitignore`. PRs: `rvegajr/polya-live-404#1` (polya) and `#2` (blueprint). Blind score: `npm run quality-review`, sonnet, repeat 2, prompt `baefefce9cfc`, record `.runs/quality-2026-09-19T05-02-53-368Z.json`, $1.17.

**Read the score honestly.** The source diff is identical, so the 5.5-point gap is not a difference between the loops. One of ACG's two reviewer repeats sent `GET //`, which makes `new URL(req.url, …)` on line 16 throw and kills the process; it scored correctness 2, security 2, validation 1 and said do-not-merge. That line is in the original fixture and in both candidates; the other three repeats never probed it and scored both 5/5/5. So the number measures which repeat thought of `//`, and with repeat 2 that noise is larger than any real difference here. The useful result is the crash: a real, pre-existing, one-request denial of service that neither loop's own look back found. polya's reviewer curled four well-formed paths; ACG's QA walked six scenarios; both passed. The blind scorer with fresh eyes and a different question found it in one of four tries.

What that says about the pattern: Understand wrote done-checks for the paths the requester named and the invariants, and nothing about malformed input, because nobody asked. The stranger test is about the plan; there is no equivalent test for the done-checks themselves. A ledger entry now carries the lesson (`L-2026-09-19-01`), which is exactly the mechanism the pattern has for it; the next routing repair's Understand reads it before writing D1. Whether that is enough is the next measurement.

To make the score mean something on the next problem: repeat 3 or more, and a problem where the loops could plausibly produce different code.


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

**Phase 3: measure and decide.** Run the table above, then the site
inspection live. Then decide which loop retires. If polya-craft scores within the
same band as ACG on the same problem and costs no more in Solver turns, ACG's
blueprint loop retires and its gate, repo I/O, browser, and scorer stay. If
not, polya-craft stays as documents and the ledger moves into ACG.
