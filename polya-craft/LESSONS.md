# Lessons

<!-- The ledger. Append-only. One entry per lesson; PATTERN.md section 5 has the rules.
     Read at Understand; written at Look back. Entries here are cross-project and process
     lessons. A target repo may keep its own at .polya/LESSONS.md; both are read. -->

## L-2026-09-18-01
Tags:     kind:build kind:change stage:devise domain:software
When:     a unit's Given pastes content that also lives in a file the Hand can read
Lesson:   name the file as the owner and let the packet be assembled from it when the unit runs; never paste a copy that can drift
Evidence: polya-craft design; the window that did not fit its opening in examples/house.md, U8
Status:   confirmed(2)

## L-2026-09-18-02
Tags:     kind:build stage:understand
When:     a done-check depends on work in more than one sub-problem
Lesson:   keep the D in PROBLEM.md, list it in every sub-plan's Trace that carries it, and read the next draft plan against Still-open at each look back
Evidence: polya-craft design; the hollow-core door found at P2 look back in examples/house.md
Status:   candidate

## L-2026-09-18-03
Tags:     stage:devise
When:     a check already exists for a level (an inspection, a CI job, a rubric)
Lesson:   adopt it verbatim as the level check and name the units that close it; do not write a parallel one
Evidence: polya-craft design; the county inspection schedule in examples/house.md
Status:   confirmed(3)

## L-2026-09-19-01
Tags:     kind:repair domain:software stage:understand routing http
When:     the problem is about which paths an HTTP app answers, and the done-checks curl the paths the requester named
Lesson:   add a done-check for malformed paths (`//`, `%2f`, a 2 KB path, a wrong method): the app must answer, never exit; a request that kills the process is the defect the requester did not name
Evidence: polya-live-404, both loops' fixes passed every check and review; a blind reviewer sent GET // and the process died on `new URL(req.url, …)`, a line neither loop touched
Status:   confirmed(5)

## L-2026-09-19-02
Tags:     kind:build stage:devise runtime:node
When:     a build declares a minimum Node engine version and then uses a `node:` core module that stabilized (dropped its experimental CLI flag) partway through that major version's release line
Lesson:   Pin `engines.node` to the exact version where the used core module works unflagged, not the version where the module first appeared behind a flag, and verify by actually installing that minimum version rather than trusting whatever Node happens to be on the build/CI machine.
Evidence: package.json engines >=22.5.0 and README both cite 22.5 as sufficient for `node:sqlite`, but the flag requirement wasn't dropped until later in the 22.x/23.x line; every check in this build (including the orchestrator's own gate) ran on Node 26.7 and so never exercised the stated minimum.
Status:   confirmed(2)

## L-2026-09-19-03
Tags:     kind:build stage:devise stage:carry-out check
When:     a unit's Do gives the whole content of one or more files verbatim
Lesson:   make that unit's Check compare each file it writes whole with the plan's text (a sha256 recorded in the plan), because behavioural tests pass on transcription drift; never hash a file that already exists, and never check `git status`, because the loop commits before the Check runs and its ownership gate already enforces Touches
Evidence: snippet-vault (Opus): U5 typed SFMenlo-Regular for SFMono-Regular and every test passed. R0: a Check that also required `git status` could never pass; then repair U7 hashed the post-fix public/app.js, and three Hand turns that made its red test pass all failed the hash. Merged from -03 and -07, corrected twice after R0.
Status:   confirmed(1)

## L-2026-09-19-04
Tags:     kind:build stage:devise
When:     The page edits a value by formatting it into a text field and parsing it back on save, and the API accepts values that format cannot express.
Lesson:   Give the server's validator the page's syntax rule and test that every accepted value survives the page's format-and-parse round trip, because otherwise an unchanged save rewrites the data.
Evidence: The API stored tags ["two words","c,d","Go"]. In Chrome at look back, Edit then Save changes with no field touched stored ["two","words","c","d","Go"]. No unit test or D sent an API-made value through the edit form.
Status:   confirmed(2)

## L-2026-09-19-05
Tags:     kind:build stage:devise
When:     A Condition names page failure states (a stale response, a failed save) and the page wires them in one start() function.
Lesson:   Test start() in Node against a fake window whose fetch the test controls, and prove the test by mutating the guard, because tests of exported helpers stay green when the wiring breaks.
Evidence: Deleting `if (!latest.isLatest(ticket)) return;` from public/app.js, or replacing the save-error display with resetForm(), left npm test at 60 of 60 passing. Only the Verifier's walk and a CDP run at look back exercised those paths.
Status:   confirmed(2)

## L-2026-09-19-06
Tags:     kind:build stage:understand
When:     The seeded AGENTS.md is the kit's unfilled template, so its Layout and Commands are false for the repo.
Lesson:   Put a filled-in AGENTS.md in the Unknown, because every Hand reads it each turn and the finished branch otherwise ships instructions for another project.
Evidence: Every unit's Not here carried a paragraph overriding AGENTS.md's TypeScript, src/index.ts, lint, typecheck and port-3000 lines. The finished branch still ships that file, and QWEN.md includes it with @AGENTS.md.
Status:   retired

## L-2026-09-19-08
Tags:     kind:build stage:understand done-check
When:     the request's example names the command the requester will type (`npm run dev`, a CLI invocation)
Lesson:   put that exact command in a done-check or an outer-test step; a sibling command that shares its code path (`npm start`) does not prove it
Evidence: snippet-vault (Fable): the idea says "I run `npm run dev`"; every D and outer step used `npm start`; `npm run dev` was first run at the review.
Status:   confirmed(1)

## L-2026-09-19-09
Tags:     kind:build stage:devise storage
When:     a plan rejects an option because its side files would not be ignored by git
Lesson:   check the option it keeps the same way: SQLite's default journal writes `<db>-journal` beside the file, which a `*.db` ignore rule does not match
Evidence: snippet-vault (Fable): PLAN.md rejected WAL for its -wal and -shm files; the default journal mode left snippets.db-journal unignored.
Status:   confirmed(1)

## L-2026-09-19-09
Tags:     kind:build stage:carry-out
When:     a repair unit's Check needs a new test file to reproduce a bug that has no existing test
Lesson:   Widen a repair unit's Touches to allow one new test file when no existing test reproduces the defect; do not let an ownership/scope gate's 'out of scope' flag on that new file trigger deleting the regression test in favor of an inline, unpersisted script.
Evidence: commit 9cb4510 dropped a devised U8 that would have deleted test/app-save-network-failure.test.js (added by U7) solely because the finish check's ownership gate did not have that path pre-listed; the file survived only because an operator intervened.
Status:   confirmed(1)

## L-2026-09-19-10
Tags:     kind:build stage:devise
When:     a Done-check names a browser-only capability (clipboard, drag-drop, etc.) that a headless verifier cannot fully exercise
Lesson:   When a D targets a browser API the automated verifier can't observe directly (e.g. clipboard read-back under headless permissions policy), require a unit test that stubs the API on the same fake-window harness already used elsewhere, not just a manual/browser walk plus a source-code read.
Evidence: D6 was reported 'met (verifier)' by reading public/app.js lines 71-78 and observing the rendered DOM, not by confirming navigator.clipboard.writeText was actually invoked with the right argument in an automated test — despite that exact harness pattern existing in test/app-save-network-failure.test.js.
Status:   candidate
