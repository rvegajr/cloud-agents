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
Status:   confirmed(5)

## L-2026-09-19-01
Tags:     kind:repair domain:software stage:understand routing http
When:     the problem is about which paths an HTTP app answers, and the done-checks curl the paths the requester named
Lesson:   add a done-check for malformed paths (`//`, `%2f`, a 2 KB path, a wrong method): the app must answer, never exit; a request that kills the process is the defect the requester did not name
Evidence: polya-live-404, both loops' fixes passed every check and review; a blind reviewer sent GET // and the process died on `new URL(req.url, …)`, a line neither loop touched
Status:   confirmed(15)

## L-2026-09-19-02
Tags:     kind:build stage:devise runtime:node
When:     a build declares a minimum Node engine version and then uses a `node:` core module that stabilized (dropped its experimental CLI flag) partway through that major version's release line
Lesson:   Pin `engines.node` to the exact version where the used core module works unflagged, not the version where the module first appeared behind a flag, and verify by actually installing that minimum version rather than trusting whatever Node happens to be on the build/CI machine.
Evidence: package.json engines >=22.5.0 and README both cite 22.5 as sufficient for `node:sqlite`, but the flag requirement wasn't dropped until later in the 22.x/23.x line; every check in this build (including the orchestrator's own gate) ran on Node 26.7 and so never exercised the stated minimum.
Status:   confirmed(9)

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
Status:   confirmed(4)

## L-2026-09-19-05
Tags:     kind:build stage:devise
When:     A Condition names page failure states (a stale response, a failed save) and the page wires them in one start() function.
Lesson:   Test start() in Node against a fake window whose fetch the test controls, and prove the test by mutating the guard, because tests of exported helpers stay green when the wiring breaks.
Evidence: Deleting `if (!latest.isLatest(ticket)) return;` from public/app.js, or replacing the save-error display with resetForm(), left npm test at 60 of 60 passing. Only the Verifier's walk and a CDP run at look back exercised those paths.
Status:   confirmed(4)

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
Status:   confirmed(9)

## L-2026-09-19-09
Tags:     kind:build stage:devise storage
When:     a plan rejects an option because its side files would not be ignored by git
Lesson:   check the option it keeps the same way: SQLite's default journal writes `<db>-journal` beside the file, which a `*.db` ignore rule does not match
Evidence: snippet-vault (Fable): PLAN.md rejected WAL for its -wal and -shm files; the default journal mode left snippets.db-journal unignored.
Status:   confirmed(5)

## L-2026-09-19-09
Tags:     kind:build stage:carry-out
When:     a repair unit's Check needs a new test file to reproduce a bug that has no existing test
Lesson:   Widen a repair unit's Touches to allow one new test file when no existing test reproduces the defect; do not let an ownership/scope gate's 'out of scope' flag on that new file trigger deleting the regression test in favor of an inline, unpersisted script.
Evidence: commit 9cb4510 dropped a devised U8 that would have deleted test/app-save-network-failure.test.js (added by U7) solely because the finish check's ownership gate did not have that path pre-listed; the file survived only because an operator intervened.
Status:   confirmed(5)

## L-2026-09-19-10
Tags:     kind:build stage:devise
When:     a Done-check names a browser-only capability (clipboard, drag-drop, etc.) that a headless verifier cannot fully exercise
Lesson:   When a D targets a browser API the automated verifier can't observe directly (e.g. clipboard read-back under headless permissions policy), require a unit test that stubs the API on the same fake-window harness already used elsewhere, not just a manual/browser walk plus a source-code read.
Evidence: D6 was reported 'met (verifier)' by reading public/app.js lines 71-78 and observing the rendered DOM, not by confirming navigator.clipboard.writeText was actually invoked with the right argument in an automated test — despite that exact harness pattern existing in test/app-save-network-failure.test.js.
Status:   candidate

## L-2026-09-20-01
Tags:     kind:build stage:carry-out
When:     a Hand writes files outside its unit's declared Touches and gets reverted
Lesson:   If the same file set gets reverted for Touches violations twice in a row, stop retrying the same turn and instead fix the plan's file ownership (widen Touches or reassign the owning unit) before the next attempt.
Evidence: commits 935691f and 68e1c5c both revert the identical file set (public/app.js, public/index.html, public/style.css) before U3/U5 settled; .polya/PLAN.md was similarly reverted twice (a308ddb, 9b7a1ca) before de8237b explicitly assigned package-lock.json ownership to U1.
Status:   candidate

## L-2026-09-20-02
Tags:     kind:build stage:verify
When:     a done-check is marked outer:false (requires browser/UI observation, not just an HTTP check)
Lesson:   Record verifier evidence that is specific to what that check actually requires observing in a browser; never let one check's evidence text double as another's, even when both happen to pass.
Evidence: D1's walk text ('POST ... GET ... PUT ... DELETE ... 404') is D2's CRUD-API check verbatim, not a description of live-narrowing search or a Copy-button click, even though D8/D9 in the same walk do cite distinct browser-observed detail.
Status:   confirmed(5)

## L-2026-09-20-03
Tags:     kind:build stage:verify
When:     a done-check's Check names an exact version/config to pin and test (e.g. engines.node minimum via nvm)
Lesson:   Actually execute under the pinned version and record that run's output as evidence; do not substitute a check that the build machine's version merely satisfies the declared range.
Evidence: D5 was marked met using only Node 26.7.0 (the build machine); pinning to the declared minimum (24.0.0) via Docker had never been run until this review, though it did pass once actually tried.
Status:   confirmed(6)

## L-2026-09-20-04
Tags:     kind:build stage:verify
When:     a done-check's shell command changes directory (cd) away from the project root before invoking the built command
Lesson:   Execute the check's cd verbatim from a genuinely clean state (no leftover npx/package caches) before recording it met — do not approximate by running the underlying command from the project root instead.
Evidence: D3 was reported 'met' with the correct single-line stderr message; run with its own `cd "$d"` honored and npx cache cleared, it produces an 8-line npm E404 block instead.
Status:   confirmed(3)

## L-2026-09-20-05
Tags:     kind:build stage:devise
When:     a CLI's bin/script name must be invocable via `npx <name>` from any working directory, not just from inside its own repo
Lesson:   Treat 'installable with npm ci' and 'resolvable by npx from an arbitrary cwd' as two different requirements — the latter needs an explicit global link/install step, since npm only self-recognizes a package's own bin when cwd is inside that package.
Evidence: npx jsoncount succeeds from the project root (npm's cwd-scoped self-recognition) but 404s against the registry from any other directory, exactly the case D3's check and the problem's external-Makefile Given both depend on.
Status:   confirmed(4)

## L-2026-09-20-06
Tags:     kind:build stage:verify domain:cli-packaging
When:     a done-check invokes `npx <local-unpublished-bin>` from outside the package's own directory (testing a file argument located elsewhere)
Lesson:   Before trusting a PASS on such a check, assert the global npm state is clean (`npm ls -g` has no entry for the package) — an unpublished local CLI's `npx <bin>` only resolves inside its own directory tree or after an explicit `npm link`/global install, and a leftover link from earlier manual testing will silently mask this gap.
Evidence: D3 flipped from PASS to FAIL (npm E404 + network call + 8-line npm error instead of one jsoncount stderr line) purely by removing a pre-existing global `npm link` for this package; nothing in `npm ci` or the check text itself established that link.
Status:   confirmed(2)

## L-2026-09-20-07
Tags:     kind:build stage:devise
When:     a package's own README documents a required extra setup step (here, `npm link`) for a Done-check scenario to work
Lesson:   Fold that step into the Done-check's fixture/harness (or into the package's own install story) rather than leaving it as documentation the check never runs — otherwise the check's outcome depends on whichever agent happened to run that step manually during a prior turn.
Evidence: README.md correctly documents `npm link` as required for `npx jsoncount` to work outside the repo, but D3's check text and the build's `package.json` (no postinstall) never perform it, so its 'met' status only held because of out-of-band manual state.
Status:   confirmed(2)

## L-2026-09-20-08
Tags:     kind:build stage:verify
When:     a verify/look-back turn runs ad-hoc shell check commands (redirecting to o1.txt/e1.txt-style files) directly in the repo working directory
Lesson:   Redirect check-command stdout/stderr scratch files to a dedicated scratch/tmp directory outside the repo, never to the repo root, so a forgotten `rm` cannot leave stray files for git to pick up.
Evidence: commit d895288 added e1.txt, e2.txt, err.log, err.txt, o1.txt, o2.txt to the repo root during a look-back turn; commit 53e8dba (orchestrator) had to revert them as a Touches violation.
Status:   confirmed(5)

## L-2026-09-20-09
Tags:     kind:build stage:devise domain:recursion
When:     a Done-check that says 'recursive' or 'counted through nesting' also has a volume/performance check (like D5) on a large *flat* structure
Lesson:   Add a nesting-depth stress check alongside a width stress check — a plain recursive tree-walker (no explicit stack) can pass a wide/flat volume test cleanly while still stack-overflowing on a deep-but-valid document, and no width-only check will ever catch it.
Evidence: lib/count.js's countNode passed D5 (1.2M flat scalars, 55MB, <1s) but threw RangeError: Maximum call stack size exceeded on a valid JSON document nested ~5000 levels deep, dumping a raw stack trace to stderr in violation of the one-stderr-line contract.
Status:   confirmed(2)

## L-2026-09-20-10
Tags:     kind:build stage:devise
When:     a Condition states an output invariant unconditionally (e.g. 'output is ASCII-only, never a leading/trailing/doubled hyphen') and the CLI has more than one argument that can shape the final output
Lesson:   Write at least one done-check that exercises every argument capable of contributing to output (here, --suffix with an empty, non-ASCII, or hyphen-laden value), not only the title path, before trusting that the invariant holds everywhere.
Evidence: D1-D8 only ever pass --suffix the clean value '2026-09'; `npx slugify --suffix '' 'Hello'` yields 'hello-' and `--suffix 'Café!' 'Hello'` yields 'hello-Café!', both exit 0, both violating the stated Condition, and both invisible to every existing done-check.
Status:   confirmed(1)

## L-2026-09-21-01
Tags:     kind:build stage:devise source:hand-question
When:     cron-next
Lesson:   Unit U2 was not workable; the Hand asked: U1's Check (`npm ci && npm run build && ! npm test`) was written to prove a transient red state at U1's own turn, not a lasting invariant — but the orchestrator's quality gate re-runs it against the final repo state, after U2 correctly makes the suite green. A working implementation and a passing `! npm test` are mutually exclusive by construction; nothing in index.ts (U2's only Touches) can satisfy both. Should U1's Check be retired/rescoped in PLAN.md now that U2 has landed, since its job (proving redness before implementation) is already done and recorded?. Decide it in the unit next time.
Evidence: cron-next, U2
Status:   candidate

## L-2026-09-21-02
Tags:     kind:build stage:devise
When:     a unit is handed literal replacement source text plus a single-file Touches instead of a prose instruction
Lesson:   Prefer giving each Do unit exact replacement file content and a one-file Touches line when the target module is small enough, since it eliminates scope-creep findings entirely and every unit here passed check on the first attempt.
Evidence: git show --stat on each of the 5 unit commits (eb8bba6, addb200, 97c1449, 2fc1851, 1a833d6) shows exactly one file changed per commit, matching each unit's Touches exactly.
Status:   candidate

## L-2026-09-21-03
Tags:     kind:build stage:test-quality
When:     a done-check claims a performance/invariant property (e.g. 'never hashed') and only a wall-clock timing test exists
Lesson:   Pair a timing-based performance test with a deterministic spy/mock test of the same invariant, since a timing threshold alone can pass even when the optimization it's meant to verify has silently regressed.
Evidence: test_ten_thousand_files_scan_quickly (timing, 0.75s) would likely still pass under a 10s bound even if hashing weren't skipped for unique-size files, but test_unique_size_never_hashed (monkeypatch spy asserting hashed_paths == []) independently and deterministically proves the skip.
Status:   candidate

## L-2026-09-21-04
Tags:     kind:repair stage:understand
When:     2026-09-20
Lesson:   When a done-check counts test results (e.g. `pass N`), never hardcode the exact current total if the same problem's Given/lessons call for adding a new test under an unlocked file — use `fail 0` plus a presence check for the new assertion instead, or the check itself forecloses the coverage it was meant to invite.
Evidence: D3's check text `grep -q "pass 11"` combined with the Given note's invitation to add a deep-nesting test to test/count.test.js (via L-2026-09-19-09) are mutually exclusive; the carry-out satisfied D3 literally and left the depth-recursion fix with no CI-enforced regression test.
Status:   candidate

## L-2026-09-21-05
Tags:     kind:build stage:devise topic:keyboard-ui
When:     2026-09-21
Lesson:   For an app with more than one focusable keyboard target (a text input plus a custom-focus-model list), any global document-level keydown handler must scope its list-navigation branches to when the list, not the text input, actually has focus — and at least one Done-check must interleave list-navigation and text-input typing in that order (navigate first, then type), not only test them in isolation or input-first.
Evidence: app.js's document-level keydown handler branches purely on a stored activeIndex with no event.target/focus check; live Playwright run against npm start showed that after one ArrowUp press, typing 'car keys' into the input yields input value 'car' and silently flips the summary from '0 of 2 packed' to '1 of 2 packed'. No D1-D9 check ever pressed an arrow key before typing new item text, so this passed every gate.
Status:   candidate

## L-2026-09-21-06
Tags:     kind:build stage:devise
When:     2026-09-21
Lesson:   When the Restated or Condition text states an explicit state-machine invariant (e.g. a status field that only moves forward through a fixed list), write at least one Check that polls the field at high frequency across a multi-step transition (not just its eventual terminal value) and asserts the invariant never regresses.
Evidence: worker.js sets a retried job's status back to 'queued' between attempts, observably regressing running→queued against the Restated 'queued → running → done/failed' shape and the Condition's 'moving only forward' clause; D2 and test/worker.test.js only assert the eventual terminal status/stderr, so this passed every existing check.
Status:   candidate

## L-2026-09-21-07
Tags:     kind:build stage:look-back
When:     2026-09-21
Lesson:   Before flagging a shutdown/keep-alive hang from memory of older Node http.Server semantics, reproduce it on the pinned engine version with lsof/timing evidence rather than trusting stale documentation.
Evidence: Tested server.close() with an ESTABLISHED idle keep-alive socket open at SIGTERM time on Node v26.7.0 (satisfies engines >=22.0.0); the close callback fired in ~1ms and the process exited in ~1s, so the suspected hang does not occur on the target engine and was correctly not reported as a finding.
Status:   candidate

## L-2026-09-21-08
Tags:     kind:build stage:verify
When:     a done-check times a fixed-count loop of subprocess CLI calls (e.g. 1000 sequential curl invocations) against a wall-clock budget
Lesson:   When re-verifying a timing check by hand, also note how much of the elapsed time is subprocess-spawn overhead versus server-side cost, so a thin pass margin isn't mistaken for headroom in the implementation.
Evidence: D8 passed at 8s of a 10s budget on this machine; profiling showed the cost is dominated by 1000 curl process forks in the check script itself, not the debounced store write path, so the margin is a property of the check's harness, not the code under test.
Status:   candidate

## L-2026-09-21-09
Tags:     kind:build stage:devise surface:cli-args
When:     a Condition names an argument-shape error (e.g. 'an unrecognized flag') without specifying position
Lesson:   Write the done-check's Check to place the offending argument in more than one position (before and after any positional argument), not just the position the implementer will find easiest to reject.
Evidence: D9's Check only ever passes --bogus as the sole/first argument; bin/ledger-report.js only validates args[0], so a flag placed after the file path is silently accepted — a real, if low-severity, Condition gap that no Check catches.
Status:   candidate

## L-2026-09-21-10
Tags:     kind:build stage:devise
When:     a Devise turn writes new test files to serve as a cycle's done-checks
Lesson:   Wire every newly-written test file into the project's actual Test command (the one named in the Quality bar) in the same cycle, and verify by grepping npm test's own output for the new tests' names — not just its exit code — since a stale test script exits 0 whether or not the new files ran.
Evidence: test/db-import.test.ts, test/export-import.test.ts, test/export-import-ui.test.ts (12 tests, including the D7 stub test Lesson L-2026-09-19-10 required) exist, pass when run directly, and are absent from package.json's `test` script; `npm test` reports 5/5 pass having never touched export/import code.
Status:   candidate

## L-2026-09-21-11
Tags:     kind:build stage:carry-out
When:     a done-check requires evidence from two sources (stranger observation + an automated stub test, per L-2026-09-20-02)
Lesson:   When a check names two required evidence forms, the verifier's walk must record both explicitly, not substitute the easier one.
Evidence: D7's verifier entry describes only a manual Playwright-style click-through; the required automated stub test (export-import-ui.test.ts) was not run or cited until this review executed it directly.
Status:   candidate

## L-2026-09-21-12
Tags:     kind:build stage:verify
When:     a plan names an unbounded-search risk (L-2026-09-20-09-style) but declines to fold it into a done-check because no J/W/Oracle line named it
Lesson:   when a search-based function ships a hard iteration cap as its only defense against an impossible/unsatisfiable input, add one done-check that exercises that exact cap (e.g. an unreachable date) and asserts it throws within a bounded time, even if no Oracle line demanded it — the cap is part of the contract once it exists in the code.
Evidence: index.ts:139-172's MAX_ITERATIONS=6_000_000 guard against inputs like '0 0 31 2 *' was never exercised by D1-D9; I had to construct and run that case myself (0.33s, correct throw) to confirm the guard actually works rather than merely existing.
Status:   candidate
