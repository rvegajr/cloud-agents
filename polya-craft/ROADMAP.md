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
- `src/lessons.ts`: the ledger store over one `LESSONS.md`: select at most twelve by tag overlap, confirmations and recency (the whole ledger while it is that small), append with day-numbered ids, confirm, and the prior-lessons note capped at 6000 characters.
- `src/io.ts`: `makePolyaIO`, architect-crew-gate's repo I/O with the gate reading the quality bar from `PROBLEM.md`.
- `src/polya-loop.ts`: the four stages over `send` and `io`. Stop reasons: `complete`, `understanding-incomplete`, `plan-not-workable`, `unit-not-workable`, `unit-gate-failed`, `finish-check-failed`, `verify-failed`, `review-unresolved`, `unparseable-report`, `run-failed`. `LOOKBACK.md` is written by the loop from evidence on every exit from look back, and the ledger is appended and confirmed.
- Browser for the Hand and the Verifier: a unit or a done-check whose text names a page is sent with `browser: true`, and the engine attaches Playwright MCP to that turn only (`QA_BROWSER`, `PLAYWRIGHT_MCP_ARGS`, as ACG's QA). The prompt tells the model whether a browser is attached, absent, or unneeded. Imported from `../architect-crew-gate/src/browser.ts`, unchanged.
- Kit wiring: `src/lib/routing.ts` (five H1 regexes; Solver turns to the plan tier, the Hand to implement, the Verifier to verify, Look back to review), `src/lib/engine-local.ts` (Understand and Devise are architect kinds; Look back runs read-only in a fresh session; Devise carries the executor note), `src/lib/build-app.ts` (`--loop polya`, `--max-units`, resume at the stage that stopped), `package.json` test glob, `tsconfig.json`.
- Tests: 307 across `plan`, `lessons`, `prompts`, the loop with a faked Hand and Solver (every stop reason, retry, fallback, resume, and materialisation path), and end to end on a real bare origin with the real gate, a real fresh clone, and a real ledger file.

One live run on 2026-09-18 (the measurement table below). The pattern has
also been used by hand in the worked examples, which are written walks and
not recorded runs.

## Not built

In build order. Each line says what the module is and what it borrows.
Items 2, 3 and 4 of the earlier list are done: the record now stays out of
the product branch entirely, a unit that cannot pass is re-planned in
place, and the oracle is the stranger test for done-checks.

1. **Page checks as tests the Solver writes.** Both R1 reviews said the same thing independently: a done-check that only a browser can attest is attested by a narrated walk, and that is weaker evidence than the check asks for. The Verifier also costs the most of anything in the loop (26 to 37 minutes a batch on the local model, with frontier fallbacks). A Solver that writes the page check as an automated test at Devise — a Playwright spec where the repo has `@playwright/test`, a Node test against a fake window where it does not — turns the check into a command the loop runs itself. The prompt rule is written, and so is the scaffold (2026-09-20 evening): when only a real browser can attest a D and the repo has no `@playwright/test`, Devise adds one unit that installs it, writes `playwright.config.js` with `webServer` on the bar's `start`, and fetches Chromium; each page unit's Check is then `npx playwright test <spec>`, and plan-lint refuses a Playwright check with nothing to run it. Not measured: rerun `examples/corpus/05-packing-list.md` on this code and count Verifier batches against the corpus run.
2. The ACG row of the measurement table: the same repair under `--loop blueprint`, same day, same models, scored blind together. Then `examples/site-inspection.md` live, which is the browser's first real test.
3. Level checks at run time. `PLAN.md`'s Shape is parsed but the loop does not yet run a group's check when its units complete; the finish check and the done-checks cover the whole. Add when a plan with more than one L1 group has been run live.
4. Parallel Hands: units with disjoint `Touches` and no `Depends` between them, one worktree each. After the first measurement, not before.
5. Slack stays on the milestone loop. `--loop polya` is CLI only.

## Known limitations

First, polya-craft's own, measured on the first live run (2026-09-18,
polya-live-404, hybrid). Both were in the orchestrator, not the models, and
both are fixed with the live artifacts as test fixtures.

- **The parser crashed on the Solver's json block.** Claude Max wrote `split: false`, `done_checks` for `done`, `statement` for `text`, `status` for `now`, `quality_bar` for `bar`, bold `**D1** —` ids over three lines, and a three-column bar table. The markdown was excellent; the parser read none of it and threw on the `false`. Answer: one bullet per D however it is laid out, aliases accepted, no field can throw, and the understand prompt states the exact shape. Cost: one Understand turn ($0.36 API-eq) that had to be resumed past by hand.
- **A backticked path became a shell command.** The Devise turn wrote prose in the Check field with `test/*.test.js` in backticks; `commandOf` joined it into `npm test && test/*.test.js`. The Hand's correct two-line fix failed the gate three times on a phantom command, and the gate feedback told it to fix something that did not exist. Answer: a backticked path or glob is a name, and `test` is a command only with an argument. Cost: three local turns (free) and one resume.
- **A done-check that curls the app needs the app up.** Not a defect the run hit, because it was fixed before look back ran, but the first PROBLEM.md exposed it: four of five checks curl `localhost:4571`. Answer: look back (b) starts the bar's `start` in the fresh clone for the checks and stops its process group after.
- **"No lesson" went into the ledger.** The reviewer wrote "No lesson: the plan held" as a lesson entry and the loop appended it. Answer: it stays in LOOKBACK.md, never the ledger.

Then the snippet-vault build (2026-09-18/19), eight more, all in the orchestrator, all fixed with the live artifacts as fixtures where a fixture applies:

- **The plan parser crashed on the Solver's block and read no `Do`.** Units were `### U1:`, `Do:` had its steps on the next lines carrying whole files in fences, the trace was `{units, outer_step}` objects. Answer: units are h2 or h3; a field runs to the next field line; traces may be lists or objects; nothing throws. The sitting caps now fit a unit that carries the files it produces (400 lines, 6 touches, 9 steps counted outside fences). Cost: one $2.84 Devise turn that had to be reused, which led to the next item.
- **A resume paid for artifacts already on disk.** Answer: Understand and Devise skip the Solver turn when the artifact is on disk and workable, and send one targeted retry when it has gaps. A plan written by hand now runs as is.
- **The unit gate ran the whole bar.** The borrowed gate ran lint, typecheck and build on every unit turn; the scaffold unit cannot pass `tsc` on an empty `src`. The Hand then created `src/main.ts` to satisfy it and failed ownership twice, unable to undo a file the note told it not to touch. Answer: a unit turn's contract carries only `install`, so the gate runs the unit's Check plus the passed units' Checks; look back (a) runs the full bar. And on an ownership failure the orchestrator reverts what was written outside Touches, commits, and tells the Hand. Cost: three local turns and one resume.
- **Prose that mentions commands became a command.** Three done-checks were sentences ("run `npm ci`, then `npm run dev` …"); `commandOf` stitched them into a command that never exits, and a bare `jq` counted as one. Answer: several backticked commands are one check only when nothing but connectors sits between them; a segment needs an argument; placeholders never count. Cost: two Verifier passes and one fix turn on phantom failures.
- **The Verifier was rescued on Claude.** Reusing the milestone `verify` turn kind made the hybrid engine treat a Verifier report without `done: true` as a failed verdict and re-run it on Max, twice ($0.70 each). Answer: the Verifier is its own `walk` kind, routed to the verify tier, never a verdict.
- **A stale LOOKBACK.md was the current record.** The finish check failed ownership on the file the loop itself wrote at the end of the previous pass; on the next pass the reviewer read that file's "finish-check-failed" as current, blamed a package.json edit, and wrote a check against LOOKBACK.md. Answer: the finish check allows the loop's own artifacts; a look-back pass replaces a stale LOOKBACK.md with an in-progress stub before it starts; a high finding whose subject is PROBLEM.md, PLAN.md or LOOKBACK.md is recorded and never handed to the Hand. Cost: one Max review turn.
- **The Hand rewrote git history.** Sent to fix the reviewer's bad finding ("revert package.json's scripts"), the Hand checked out an earlier commit, cherry-picked, and rebased the branch to drop a commit. The gate diffs base..HEAD and saw nothing. Answer: after every Hand turn, if the pre-turn HEAD is no longer an ancestor, the orchestrator resets to it, counts an ownership failure, and tells the Hand. This one the loop only caught because the push to the fixture repo was refused as a non-fast-forward.
- **The Verifier read the source instead of walking the page.** On the final pass, with Playwright attached, the local model reported D1 and D6 as "code review confirms …". The checks were true, and it did not walk them. Answer: the verify prompt says a page step's evidence is what the page showed, and an attached browser unused for a page step means the step was not walked. Not yet measured.

Still open from this run: the reviewer's lesson about pinning `engines.node` is a good one and is in the ledger; the structure penalty for artifacts at the repo root is a design question (`.polya/`), not a defect; and the Hand's ability to run any git command inside the clone is the deeper version of the history item.

Then resuming that same run after a reboot (2026-09-20, `polya-live-sv-r2`, "R2" in the sense of a second look at the page-check rule, not the split-tier experiment below), four more, three in the orchestrator and one in how a done-check was worded:

- **A resumed job silently lost its own branch.** `cloneWorkspace` clones `--branch <ref> --depth 50`, which restricts the origin remote to that one branch's refspec. Reopening a saved job then did a bare `git fetch origin <branch>`, which only ever lands in `FETCH_HEAD`, never a ref `checkout` can find; the checkout failed, fell back to `checkout -b`, and started a fresh branch off `<ref>` with none of the job's prior commits, silently, no error surfaced. Nothing was lost on the remote, only from the loop's view of it. Answer: fetch straight into a same-named local ref (`fetch origin <branch>:<branch>`), which does not depend on the clone's restricted refspec. Cost: one Solver repair turn ($9.09) investigating a branch that, from where it sat, had never had any work done on it.
- **`.polya/` was never restored on a resumed job.** It is gitignored on purpose, so a workspace lost to a reboot or a cleared temp dir came back without it, and nothing copied the `.runs/polya-<id>/` backup `build-app` already writes after every run back into the new workspace. Answer: restore it before the loop starts if the workspace doesn't have it and a backup does, the mirror of the existing backup step.
- **Look back (a) never installed before checking the bar.** Step (b) already runs the problem's install command in its fresh clone; step (a), checking the workspace itself, did not. Any job that reaches look back without a carry-out turn in that exact workspace (every unit already passed, which a resume after losing (a) or (b) makes routine) has no `node_modules`, and the bar's test/lint/build commands fail on a bare "module not found" that reads as a product defect. Answer: run the install command before the bar in step (a) too. Cost: one more Solver repair turn ($0.72) that correctly refused to fabricate a fix but described the wrong cause (a stale dependency pin, not a missing install).
- **A done-check that shells out to `nvm` needs `nvm.sh` sourced first.** `nvm` is a shell function, not a binary on `PATH`; a non-interactive `sh -c` spawn (every check in this loop) never sources it, so a bare `nvm install …` exits 127 regardless of what the product does. This is a property of how the check text invokes the tool, not something a repair unit could ever fix, since neither the repo nor `PROBLEM.md` (where the check's text lives) is a repair unit's to touch. Fixed directly in `PROBLEM.md`'s D5 by prefixing the command with sourcing `nvm.sh`; not yet turned into a general rule (no check in these two runs has needed a second one, but a rule like "prose done-checks may not assume an interactive shell" belongs in the understand prompt).

With that fixed, D5 stopped failing on `command not found` and started failing on something real: this fixture's `test/bootstrap.test.js` pins `engines.node` to `>=18.0.0`, a pre-existing assertion no repair unit may edit, and `better-sqlite3@^12.8.0` has no prebuilt binary for Node 18.0.0 and cannot be built from source on this machine, because the Python here has no `distutils`, which the Node-18-era `node-gyp` needs. That tension was already visible in this same plan's U5–U7 repair history before the reboot. It is a genuine conflict in the fixture's own contract, not an orchestrator defect, and not one any of the three fixes above could touch. Accepted as the run's final state: finish check PASS, 9/10 done-checks met, D5 open for that reason.

Then the first build from a `REQUEST.md` (2026-09-20, `polya-live-json-count`, R3 below), six more, five in the orchestrator and one in the machine:

- **The quality bar table read one column order.** The Solver wrote `| Command | Purpose |` with sentence purposes, and the json block's `bar` as `[{command, purpose}]` rows; the parser wanted a bare purpose word first and an object, found no `test`, and stopped a run whose eight request lines it had just disposed correctly. Answer: either order, a purpose read from its label or implied by a well-known command, rows or an object. The artifact is the fixture. Cost: one resume.
- **A bare word in a Must-not-change line was a directory.** New code, new defect: "as the package `bin`" made `bin/jsoncount.js` unworkable, and the Solver's rename to `bin/cli.js` too. Answer: a bare backticked word matches a path exactly, never as a prefix; only something written as a path covers what sits under it. Cost: one Devise retry ($1.03) and one resume.
- **A check opening with `d=$(mktemp -d) && …` was prose.** The head list allowed upper-case assignments and had no `cd`. The review repair was rejected twice for it; then, once fixed, two done-checks the Verifier had walked and reported met (D3, D7) ran as commands and failed. Answer: lower-case assignments, `cd`, and the coreutils are heads. Cost: two Solver repair turns ($1.37) and one resume. The reading matters more than the cost: **a check a machine runs is evidence, a walk is a report**, and this run measured the difference on two checks.
- **A rejected repair's id blocked its rewrite.** The rejected U4 stayed in `PLAN.md`; the next pass's Solver rewrote U4 for the same evidence and the loop said "no new unit". Answer: new means never accepted by the loop, not absent from the file. Cost: one Solver retry ($0.62).
- **A review turn's scratch files were committed.** The reviewer's shell redirections left six files in the repo root, the engine committed them as the look-back turn, and the next finish check failed ownership on files nobody owned; the Solver then wrote a seven-file unit to delete them. Answer: the repo goes back to where it was before a review turn, and before a repair turn whose verdict is that the check is wrong. Cost: one Solver turn ($1.19), stopped by hand, and one orchestrator commit.
- **Docker here is Colima, which shares only the home directory, twice.** First D7 of the json-count run: the fresh clone under the system temp root mounted as an empty folder. Then D10 of `ledger-report` (corpus 06): the check mounted a file it had made with `mktemp`, which lands under `/var/folders`, and the container saw an empty directory; the Solver reproduced it with busybox and called the check wrong, correctly. `WORK_ROOT=$HOME/.cache/cloud-agents-work`, and a check makes its files under `$PWD`: BSD `mktemp` ignores `TMPDIR`, as the second resume of `ledger-report` proved, so the understand prompt now says where a check's files go. Not a code defect, and written down because it bit twice in one day.

- **A Verifier with a shell killed the orchestrator** (corpus, `packing-list`, 2026-09-21). Walking D3 and D4 it ran `ps aux | grep node | grep -v grep | awk '{print $2}' | xargs kill -9` to restart the page's server, which is every Node process on the machine: the loop died with 137 mid-batch, the driver moved on, the run resumes. Answer, in two parts and a confession: the verify and carry-out prompts now say processes are not the model's to stop unless it started them; the local runner is started with `--exclude-tools` for `pkill`, `killall`, `kill -9`, `sudo`, which a prefix list cannot make watertight (this pipeline begins with `ps`); and the real answer is the sandbox, `qwen --sandbox` on Colima with the clone mounted from `WORK_ROOT` and Ollama reached over the host, which is the same fix for the Hand rewriting history. Not built yet.

What the request did, for the record: every one of its seven J and W lines became a done-check on the Solver's first turn, no retry; its one M line went into Given as immovable; the two checks a stranger later found wanting (D3's working directory, the recursion depth) were the two things the requester had not written, and the reviewer found both. D3's resolution was the requester's, made in `ACCEPT.md` against the walk-through they had written: the check runs from the clone after install, not from an unrelated directory through a global `npm link`.

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

Two problems. The repair, both loops, scored blind together. The build,
polya against the three snippet-vault builds already in ACG's table, scored
blind together in one invocation.

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

**Snippet-vault build, polya, hybrid, 2026-09-18/19** (`rvegajr/polya-live-snippet-vault#1`). Solver turns on Max: understand ($0.43), devise ($2.84, one plan-lint retry answered inside it), three reviews across three look-back passes. Hand: five units, **every one gate-green on its first attempt** once the unit gate ran only the unit's Check; zero questions. Verifier: five prose done-checks walked in a browser on the local model, no frontier fallback. Finish check PASS; 8/8 done-checks met, D7 being the malformed-path probe that entered the ledger from the repair the day before and was read, adopted, and passed. Review: done, one medium finding (engines.node pinned to a version where `node:sqlite` still needed a flag), one lesson, two confirmations. Claude Max API-eq $6.39 for the build; Ollama $0. Five resumes, every one for an orchestrator defect listed under Known limitations, none for a model. **Resumed again 2026-09-20** (`polya-live-sv-r2`, same problem and plan, after a reboot mid-run) to look at the page-check rule: three more resumes for three more orchestrator defects (see Known limitations), then finish check PASS and 9/10 done-checks met, D5 (Node-18 compat) left open for a real, pre-existing conflict in the fixture, not a defect. Claude Max API-eq $10.21 for this resumed run.

Blind score, one invocation, sonnet, repeat 2, prompt `baefefce9cfc`, record `.runs/quality-2026-09-19T09-11-38-955Z.json`, $4.25:

| engine | correctness | security | validation | tests | structure | ux | readme | median /35 | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude | 5 | 4.5 | 3.5 | 4.5 | 4.5 | 4 | 5 | **31** | merge-with-followup/merge |
| cursor | 5 | 4 | 3.5 | 4 | 4 | 4.5 | 5 | **30** | merge-with-followup |
| **polya** (hybrid) | 5 | 5 | 4.5 | 3.5 | 3 | 3 | 5 | **29** | merge-with-followup |
| acg (blueprint, hybrid) | 3.5 | 4.5 | 4 | 4 | 5 | 3 | 4.5 | **28.5** | merge-with-followup |

Read it honestly. polya's correctness, security and validation are the best of the four, and validation is where the ledger's `//` lesson landed. It lost on three things the reviewers named the same way both times: **tests** (no negative-case tests for the 400 paths; the Solver wrote red tests for what done means, not for what must be refused), **UX** (no empty state on zero matches; `saveSnippet` never checks `response.ok`, so a failed save looks like a success), and **structure**, where one reviewer gave 2 and the other 4 for the same reason: PROBLEM.md, PLAN.md, LOOKBACK.md, QWEN.md and AGENTS.md are tracked in the shipped repo. ACG ships five artifacts too and scored 5 on structure, so that is partly which reviewer you draw, and partly a real question: should the loop's artifacts live under `.polya/` in the target rather than at its root. Against ACG on the same idea: within 0.5, with the same failure mode (UX gaps the requirements never named) and the opposite strength (correctness 5 against 3.5). Against all-Claude: within 2, at roughly the same Max spend, most of it the one Devise turn.

What the second problem says about the pattern that the first could not: the plan-lint gap on the first Devise draft ("U1 has no Given") was answered inside the same turn; a 974-line plan carrying whole files was one sitting each for a local model; five units, zero retries, zero questions is the crew doing typing, as the theory says; and the ledger closed its loop for the first time, a lesson written on Thursday's repair passing as a done-check on Friday's build.


The first problem should be a repair, as ACG's first run was: it exercises
every stage for the least cost. The second should be the snippet-vault build
already scored under four engines in `../architect-crew-gate/ROADMAP.md`, so
polya-craft's number lands in an existing table.

## Solver comparison: does a stronger Solver close the gap?

Same idea (`ideas/example-snippet-vault.md`), same Hand (qwen3-coder-next),
same day, three Solvers, `CLAUDE_EFFORT=max CLAUDE_THINKING_TOKENS=31999`
on the two non-default runs. Each build ran the full loop independently on
its own fixture repo; blind-scored together, one invocation, sonnet,
repeat 3, record `.runs/quality-2026-09-19T16-08-23-265Z.json`, $4.71.

| Solver | Units | First-attempt gate-green | Build cost (Max API-eq) | Blind score /35 | Verdict (3 repeats) |
| --- | --- | --- | --- | --- | --- |
| Sonnet, default | 5 | 5/5 | $6.39 | **29** | merge-with-followup |
| Opus, max effort + thinking | 7 | 7/7 | $35.78 | **34** | merge (×3) |
| Fable 5.1, max effort + thinking | 8 | 8/8 | $31.51 | **34** | merge (×3) |

Every unit passed the gate on the first attempt on all three runs; the Hand
never varied. Both stronger Solvers closed the tests and UX gap that
`polya-live-snippet-vault` (the Sonnet run above) lost on: the reviewers'
own evidence names negative-case tests (malformed input, oversized paths,
injection-shaped strings) and an empty-state/failed-save message the
Sonnet build did not write. Neither stronger Solver improved structure,
which stayed capped at 4 (one reviewer gave Opus a 3) for the same reason
as the Sonnet run: `PROBLEM.md`, `PLAN.md`, `LOOKBACK.md`, `AGENTS.md`,
`QWEN.md` at the repo root. That is unchanged by the Solver's model and
argues directly for item 2 above (`.polya/`), not for more Max spend.

Fable and Opus are indistinguishable on this one run: same score, same
verdict on every repeat, similar build cost. Fable's plan pinned the exact
Node version by fetching and running it (`npx node@<version>`); Opus's did
not. One run is not enough to call a difference between them.

**Reading for the pattern, not just the score.** The oracle checklist
proposed under "not built" item 4 — refuse bad input, show an empty state,
show a failed action — is not a new mechanism the loop needs. A strong
enough Solver writes it unprompted, because that is what "understand the
problem" means when done properly. The item stays on the queue for when
the Solver is Sonnet or a local model; it stops being load-bearing when the
Solver is Opus or Fable at high effort. What does not shrink with a
stronger Solver is the structure penalty, because it is not a judgment gap,
it is a decision about where the loop's own files live.

**Cost read.** Max spend is per-project and per-repo in `.runs/*.json`;
`npm run cost-board` rolls it up. A stronger Solver at max effort costs
roughly 5-6x Sonnet's default on the Solver turns alone (`$24-36` vs
`$3.27` for understand+devise), before the review turn. Worth it when the
`.polya/`-scale structure fix is also in place and the remaining gap is
genuinely judgment, not paperwork location.

## R0: does the curated ledger alone lift the cheap Solver?

2026-09-19. Sonnet at default effort, the ledger curated after five runs,
the oracle off, `.polya/` artifacts, Verifier batches of two.
`rvegajr/polya-live-sv-r0#1`. Seven units, every one gate-green first
attempt (six built, one repair); 8/8 done-checks; review done with one
medium finding; 2 lessons appended, 5 confirmed. Claude Max API-eq $11.78.
Blind score with the three Solver anchors, one invocation, repeat 3,
record `.runs/quality-2026-09-19T23-36-54-196Z.json`, $6.32:

| engine | corre | secur | valid | tests | struc | ux | readm | median /35 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fable, max effort | 5 | 5 | 5 | 5 | 4 | 5 | 5 | **34** |
| opus, max effort | 5 | 5 | 5 | 5 | 3 | 4 | 5 | **32** |
| sonnet, baseline | 5 | 4 | 4 | 3 | 3 | 4 | 5 | **28** |
| **sonnet + ledger (R0)** | 4 | 4 | 3 | 4 | 2 | 3 | 1 | **22** |

**The answer is no, and two of the three reasons are not the ledger's.**

- **No documentation unit.** R0's plan has six units — tooling, data,
  client, server, page, styles — and none for docs, so the repo ships the
  one-line stub README that `gh repo create` made. All three reviewers
  scored readme 1; that is four of the six points R0 sits below the
  baseline, which did have a docs unit. Nothing in Understand, the ledger,
  or plan-lint requires that a stranger can install and run the thing from
  the repo's own documentation. The oracle needs that line.
- **`.polya/` did not remove the structure penalty.** That was the point of
  C1. Reviewers still docked it (structure 1, 2, 4 across repeats): "an
  agent-tool planning-state directory present in the tree". Moving the
  record does not help; either it stays out of the product branch (an
  orphan ref, or only in `.runs/`), or the cost is accepted. Decide before
  the next scored build.
- **What remains is what the oracle covers.** Validation 3 in every repeat:
  `POST {}` returns 201, a non-array `tags` is coerced instead of refused.
  UX: no empty state. Those are oracle lines O1 and O2, off by design in
  R0. R1 is the run that tests them.

**What the ledger did do.** Sonnet wrote the malformed-input check (passed)
and the failed-save check, which caught a real defect: a save that fails
told the user nothing. The repair for it is U7, and one reviewer cited it
as a strength.

**The caveat that matters most.** Two Sonnet runs on the same idea scored
28 and 22. That spread is wider than the effect being measured, so one run
per configuration cannot answer this question. Either run each
configuration twice, or treat these numbers as evidence about *what
reviewers punish* (missing docs, process artifacts, unrefused input)
rather than about the Solver's model or the ledger.

## R1: the oracle, twice

2026-09-20. Same Solver as R0 (Sonnet, default effort), same curated
ledger, plus `POLYA_ORACLE=1` and the record kept out of the product
branch. Two runs, `polya-live-sv-r1a#1` and `polya-live-sv-r1b#1`. Scored
with every earlier build in one invocation, repeat 3, record
`.runs/quality-2026-09-20T07-50-36-452Z.json`, $8.91.

| engine | corre | secur | valid | tests | struc | ux | readm | median /35 | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fable, max effort | 5 | 5 | 5 | 5 | 4 | 5 | 5 | **34** | merge |
| **sonnet + oracle (R1a)** | 5 | 4 | 4 | 5 | 5 | 4 | 5 | **32** | merge |
| **sonnet + oracle (R1b)** | 5 | 5 | 5 | 5 | 4 | 4 | 5 | **32** | merge |
| opus, max effort | 5 | 5 | 5 | 5 | 2 | 4 | 5 | **31** | merge-with-followup |
| sonnet, baseline | 5 | 5 | 4 | 4 | 3 | 3 | 5 | **29** | merge-with-followup |
| sonnet + ledger (R0) | 4 | 4 | 2 | 4 | 2 | 3 | 1 | **20** | merge-with-followup |

**The oracle earns its place twice over.** Both runs scored 32 with the
verdict `merge`, the top verdict, and the per-repeat totals were 32, 34,
31 and 34, 32, 33: a spread of 3 within a run and 0 between the two runs.
The two Sonnet runs without it scored 29 and 20. So the oracle did not
only lift the cheap Solver by 3 to 12 points, it removed the run-to-run
variance that made R0 unreadable. That variance was the thing the
measurement could not see past.

**Against the expensive Solvers.** Sonnet with the oracle beat Opus at
maximum effort (31) and sits 2 below Fable (34), at $9 to $12 a run
against $31.51 and $35.78. On the earlier reading that 2-point gap is
inside the noise. The decision rule in `NEXT-SESSION.md` asked for ≥ 33 to
make Sonnet the default; 32 with `merge` on both runs, beating a
five-times-dearer Solver, is close enough to adopt with the caveat written
down: **Sonnet plus the oracle is the default Solver; a stronger Solver is
for size L and for a problem whose Understand is genuinely hard.**

**Where the two fixes show up, exactly as predicted.** Documentation went
from 1 (R0, no docs unit) to 5 in both runs, because the oracle's O8 makes
"a stranger installs and runs it from the repo's own documentation" a
done-check, and both plans wrote the README in a unit. Structure went from
2 to 5 and 4, because `.polya/` is ignored in the target and the product
branch carries only the app; Opus, whose run still committed its record at
the repo root, scored 2 on the same criterion. Validation went from 2 to 4
and 5, and UX from 3 to 4, which are oracle lines O1, O2 and O3.

**What it cost to get there.** Both runs needed operator corrections and
exposed defects in the loop, not in the models: R1a needed the lock-file
rule, the untracking fix, and a unit re-plan; R1b hit the prose-hash
drift, the `dev`-in-the-bar timeout, and two checks the parser misread.
Every one is now a rule with a test (303 → 307 tests). The models
themselves: 12 units across both runs, 10 passing first attempt, and two
Solver re-plans that fixed real plan defects.

## R3: the requester's own lines

2026-09-20. `templates/REQUEST.md` filled in for a CLI with no web page
(`examples/request-json-count.md`), Sonnet default with the oracle, hybrid,
`rvegajr/polya-live-json-count#1`. The request says four things the
feature-only idea file (`ideas/ready/farm-json-lines.md`) never said: empty
stdin is an error, stderr is exactly one line, nested values count, 50 MB
finishes in seconds. The question was whether they reach the done-checks and
whether a stranger can then run them.

| what | result |
| --- | --- |
| request lines disposed on the first Understand turn | 8/8 (J1–J4 → D2, D3, D4, D1; W1–W3 → D3, D1, D5; M1 immovable in Given), no retry |
| units | 3 planned + 1 repair, every one gate-green on the first attempt, zero Hand questions |
| finish check | PASS (install first, then the bar) |
| done-checks from a fresh clone | 8/8, six by command including the Docker floor check, two walked |
| review | done, one medium finding (recursion depth, a case nobody wrote) |
| Solver cost | Claude Max API-eq $11.29; Ollama $0 |
| resumes | 6, every one for an orchestrator defect listed above, none for a model |

Two readings. First, the request template works as designed: the Solver
derives checks from features on its own, and what it cannot derive, the
requester wrote in ten minutes and it became the spec. Second, the same run
falsified two "met" verdicts: once D3 and D7 parsed as commands instead of
prose, the machine ran what the local Verifier had narrated and both failed.
A prose done-check attested by a walk is a report; the roadmap's item one,
page checks as tests, is the same lesson from the other side.

**The self-conflict guard, measured** (`examples/request-node-floor-conflict.md`,
the D5 finding of R2 written as a requester would write it, on the R2 fixture's
branch): the Solver disposed J1 as `dismissed — conflicts with M1` on its first
turn, with a second reason no one had seen (Node 18.0.0's CLI has no `--test`,
so the pinned test script cannot pass there whatever the database does), and
the loop stopped at Understand: `the request conflicts with itself`. Claude
Max API-eq $1.42. The same conflict cost $10.21 and a full run to surface in
the morning, before the request had a place to say what may not move.

Not scored blind: the blind rubric is for web apps, and the point of this
run was the request, not the product. The product's own numbers are the
table. Follow-up: the medium finding (a depth limit) is a one-unit repair
the requester deferred in `ACCEPT.md`.

## R4: the corpus, ten requests of different shapes

2026-09-20 to 21, overnight. `examples/corpus/`: ten `REQUEST.md` files, one driver (`run-corpus.sh`) that ran them one at a time under the 75 % budget rule, one resume driver for what stopped. Sonnet with the oracle, hybrid, the local Hand throughout. Per-run logs and the summary are in `.runs/corpus/`; the summary as it stood is `examples/corpus/summary-2026-09-21.tsv`.

| request | shape | final | passes | cost (Max API-eq) | units green first try | done-checks | review |
| --- | --- | --- | --- | --- | --- | --- | --- |
| jsoncount-depth | repair on an existing repo | complete | 2 | $2.86 | 1/1 | 4/4 | done, 1 finding |
| slugify | CLI | complete | 1 | $3.99 | 4/4 | 8/8 | 1 high, repaired |
| iso-week | CLI, dates and time zones | complete | 1 | $3.14 | 4/4 | 9/9 | clean |
| kv-api | HTTP API, no UI, persistence | complete | 3 | $12.74 | 6/6 | 10/10 | done |
| packing-list | a page, keyboard only | 9/9 met; review repair unresolved | 2 | $10.13 | 7/8 | 9/9 | 1 high, real |
| ledger-report | streaming CSV, 300 MB, Docker floor check | complete | 3 | $6.69 | 6/6 | 10/10 | done |
| snippet-vault-export | change on an existing app | 10/10 met; review repair unresolved | 3 | $18.01 | 5/5 | 10/10 | 1 high, real |
| cron-next | typed library, no CLI | complete | 3 | $11.09 | 2/2 | 9/9 | clean |
| dedupe-py | Python CLI, pytest | complete | 1 | $7.37 | 5/5 | 10/10 | clean |
| job-queue | long-running process, SIGTERM | complete | 2 | $17.53 | 6/6 | 8/8 | done |
| **total** | | **8 complete, 2 done-as-product** | 21 | **$93.55** | 46/47 | 87/88 | |

**What held.** Every request's J/W/M lines reached the done-checks on the first Understand turn, ten for ten; no run needed the request-disposition retry. Forty-six of forty-seven Hand units passed their gate on the first attempt across four toolchains (npm, TypeScript with `tsc`, Python with `pytest`, Docker), and the one that did not was the packing-list repair below; which Hand did them is corrected below. The Verifier's mechanical share was high where the product is a command (8 to 10 of 10) and low where it is a page (2 of 9, 2 of 10), which is roadmap item one's case restated with numbers. Five of ten completed unattended after the first orchestrator fixes; the three CLIs completed first time.

**Correction, same day.** The kill guard added mid-corpus passed `--exclude-tools` to the local runner ahead of the positional prompt; that option is a yargs array and swallowed the prompt, so from `snippet-vault-export` on, and in every resume, each local Hand turn failed at once ("No input provided via stdin") and the engine's rescue re-ran it on Claude. The products and checks stand; the "local Hand" claim does not for those runs. What the local Hand actually did: on the four first passes that reached the Hand before the bug (`slugify`, `iso-week`, `packing-list`, `ledger-report`), 21 of 21 units gate-green on the first attempt. `dedupe-py`, `cron-next`, `job-queue`, `snippet-vault-export` and all resumes had a Claude Hand, which is part of why the later runs cost more. Fixed: the prompt goes through `-p`; the runner test now asserts nothing positional follows the array option. The corpus should be rerun on the fixed runner before the local-Hand number is quoted again.

**What stopped runs, and whose fault.** Eleven stops on the first pass, none a model's: nine orchestrator defects (a fenced-script Check read with its language tag; the suite-must-be-red rule applied to a repair whose checks live outside the suite; a placeholder inside a quoted string; a result note after a leading command; a rejected repair's id blocking its rewrite; a negation not read as a command; a check that could not run at all treated as unmet; a transient "suite is red" Check; a NUL byte crashing the spawn), one environment (Colima shares only `$HOME`, twice), and one Verifier killing the loop with `ps | xargs kill -9`. Each is fixed with the live artifact as the test, in this branch, and the resumes ran on the fixed code. Five stops were the Solver's own checks written for an environment they were not run in: a temp file `mktemp` puts where a container cannot see it, a probe file in `/tmp` importing a relative path, a 2 MB literal on the command line, a restart check that killed `npm` and left `node` running, a `pkill` for a server the loop had started. Each was reworded by hand as the requester's ACCEPT edit and is now a rule in the understand prompt: a check runs from the repo root, makes its files under `$PWD`, sends a body through a file, and starts its own server on another port if it needs one.

**The two that did not complete, both at the review-repair stage, both with the product done.** `packing-list`: the reviewer found a real keyboard bug (list keys firing while the input has focus), the Solver's repair Check pinned the SHA-256 of the whole `app.js`, and the local Hand could not reproduce a two-hundred-line file byte for byte in three attempts. A whole-file hash is a plan device a frontier Hand meets and a local one does not. The lint for it already existed (R0, U7: a hash on a file that already exists is rejected) and missed this one because the quotes inside `node -e "…"` are escaped; fixed with U8's Check as the test. `snippet-vault-export`: the reviewer found that `package.json`'s `test` script still names only the four original files, so the twelve new tests never run under `npm test`; the repair procedure's own rules forbade editing that line. A one-line human follow-up; the repair prompt now allows exactly that edit when the finding is that the bar does not run a test that exists, and Devise wires every new test into the bar in the same plan (L-2026-09-21-10, promoted to a rule). The ledger was curated the same day: three entries retired because the loop or a lint now answers them, one promoted.

**Cost.** $93.55 Max API-eq for ten requests, $2.86 to $18.01 each; Ollama $0. The three that cost most (`snippet-vault-export`, `job-queue`, `kv-api`) each paid for repeated look-back passes as their checks were reworded, and two of them for Verifier walks with frontier fallbacks. The Max weekly window went from 59 % to 69 %. Twenty-two lessons were appended to the ledger over the day; curation is next.

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
