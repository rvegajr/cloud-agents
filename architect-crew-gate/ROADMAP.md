# Roadmap

What is built, what is designed, and the order to build the rest. The full
design of each item is in `PATTERN.md`; this file only tracks state.

## Built

- **Gate** (`src/quality-gate.ts`): ownership (create allowed, modify not; task
  scope from `allowedFiles`; diff from `baseSha`), quality bar **from
  `QUALITY.md`'s machine block** (any shell command, any stack; `package.json`
  scripts as the fallback), hygiene from the contract's list, tamper (scripts
  baseline, eslint `varsIgnorePattern`, non-tests, `.only`/`.skip`),
  clean-start probe (contract `start` + HTTP or `--help` probe), vacuous-suite
  probe. Feedback note and retry loop. Subprocess env scrubbed of
  `NODE_TEST_CONTEXT` / `NODE_TEST_WORKER_ID`.
- **Parsers** (`src/blueprint.ts`): `REQUIREMENTS.md`, `QUALITY.md`,
  `TASKS.md`, `QA.md` (machine block first, markdown fallback), job kind,
  traceability, the design excerpt a task needs.
- **The loop** (`src/blueprint-loop.ts`): `requirements → blueprint → tasks
  (gated, retried with feedback) → finish gate (+ one fix turn) → QA on a fresh
  clone (+ one fix turn, one re-run) → review (fresh read-only session, findings
  with checks, + one fix turn, checks decide) → done`. Stop reasons
  `unparseable-report`, `blueprint-incomplete`, `gate-failed`, `qa-failed`,
  `review-unresolved`, `run-failed`. Engine-free; driven by `send` + `io`.
- **Real IO** (`src/io.ts`): files, shas, commits, the gate, `sh -c` commands,
  fresh clones, diff stat over a git checkout.
- **Wiring** (`src/lib/build-app.ts`): `npm run build-app -- --loop blueprint`
  (or `BUILD_LOOP=blueprint`) on the hybrid, local, or claude engine; resume
  restarts at the stage that stopped; the record carries the blueprint state;
  `printBuildResult` shows tasks, gates, QA, review, checks.
- **Engines**: turns can run in another checkout (`cwd`) and in a fresh session
  (`fresh`); blueprint-loop turns carry their context in the prompt, not the
  transcript; routing classifies `requirements | blueprint | task | qa | review`
  with `HYBRID_QA` / `HYBRID_REVIEW` tiers.
- **Scoring** (`src/quality-review.ts`, `npm run quality-review`,
  `prompts/quality-review.md`): clone or copy, anonymise (no history, no tool
  dirs, engine words and repo name scrubbed, hygiene facts recorded), shuffle,
  one fresh read-only Claude turn per candidate per repeat, strict rubric
  parse, medians, table, `.runs/quality-*.json`, cost line; `--dry-run`.
- **The UX layer** (`src/browser.ts`, `blueprint.ts`, the prompts): stage 0
  numbers the job's must-have bullets `M1..Mn`, the architect writes
  **workflows** (`W1..Wn`, end-to-end journeys with steps and requirement
  ids) and a **coverage** map, and the orchestrator refuses to draw a
  blueprint until every must-have maps to real requirements and one of them
  is in a workflow (`requirements-incomplete`, one retry). Stage 1 demands a
  browser test per browser-flow requirement and a QA scenario per workflow
  (traceability covers `W` ids). Stage 4 gives the QA analyst a **headless
  browser**: Playwright MCP (`@playwright/mcp`) on qwen-code's `--mcp-config`
  for that turn only, or as `mcpServers` on the Claude SDK when QA falls back
  to Max; the prompt names the tools and the snapshot-as-evidence rule.
  Attached only to a QA batch whose scenarios name a page, a click, or typing
  (`scenarioNeedsBrowser`); an ETL, database, CLI, or library job never
  starts it. `QA_BROWSER=0` turns it off everywhere. Verified live: qwen3-coder-next through
  qwen-code opened a page, clicked a button, and reported the heading and the
  new label.
- **Prompts** (7 + the rubric), **templates** (5), **spec**, **theory**, **article**.

## Known limitations (measured 2026-09-18)

- **gpt-oss:120b through qwen-code does not use tools.** As the local architect
  it answered both requirements turns in chat (valid JSON, no files written).
  The loop now retries once with a reminder and then materialises
  `REQUIREMENTS.md`/`QUALITY.md`/`TASKS.md` from the report, but a blueprint
  needs real tests and stubs on disk, so a non-tool-using model cannot be the
  architect. Use `LOCAL_PLANNER_MODEL=qwen3-coder-next` for a local-only run,
  or the hybrid engine (Max architect) as intended.
- Local models sometimes reply with bare JSON, no fence; every report parser
  accepts that.
- A local architect (qwen3-coder-next) wrote a task whose `Files:` was the
  test file itself ("add tests for unknown routes"). The gate then correctly
  refused the crew's `src/app.js` edit as out of scope, three times. The
  blueprint stage now validates tasks (no test files or architect documents
  under `Files:`, a `Tests:` list) and folds violations into the one targeted
  retry alongside traceability gaps, so an unlawful task never reaches a crew.
- **The task gate must not run the whole suite.** On a six-task build the
  first task could never pass: the bar's `test` ran every red test the other
  five tasks would turn green later, and by attempt three the crew was editing
  another task's file to chase them. The task profile now runs the task's own
  `Commands:` plus those of every task already passed; only the finish gate
  runs the full bar.
- **A reviewer in plan mode does not review.** Claude Code's plan mode writes a
  plan and asks to proceed, so every blind review ended with no scores (raw
  replies kept in `.runs/quality-review-raw-*.md`). Review turns now run in
  agent mode with Edit/Write disallowed; read-only is the tool list.
- **A task's `Commands:` must be shell, not instructions.** Max wrote
  "npm start (background) then curl … expect 200, then stop it" for the last
  task of the snippet-vault build; `sh -c` rejected it three times while the
  whole suite was green (34/34). Blueprint validation now rejects prose in
  `Commands:` and the prompt says anything needing a running server belongs
  in `QA.md`; the finish gate's start probe covers it anyway.
- **A local QA analyst cannot hold eleven scenarios in one turn.** Given all of
  snippet-vault's `QA.md` at once, qwen3-coder-next returned "Q3 passed. Q4:"
  and stopped. QA now runs in batches (`QA_BATCH`, default 4) in the same fresh
  clone, retries a silent batch once with a reminder, and can fall back to the
  frontier tier for that batch (`HYBRID_QA_FALLBACK=claude`, the default on the
  hybrid engine). The finish gate itself — install, start probe, vacuous-suite
  probe over eight stubbed files — passed on the first try.
- **A project-scope MCP server in `.qwen/settings.json` is gated.** qwen-code
  parks it at "Pending approval" in its approvals store until a person accepts
  it, so a headless QA turn would never see the browser. Servers passed with
  `--mcp-config` are session-scoped and not gated; that is how the analyst
  gets Playwright, and nothing is written into the clone.
- A long feedback note prepended to a prompt hid its header from the router
  (`classifyPrompt` read 400 characters); it now reads 8000. Before the fix a
  retried blueprint turn on the hybrid engine would have been routed to the
  crew tier.

## Not built

1. **Parallel crews** — `LOCAL_PARALLEL=N`, one worktree per `parallel_ok`
   task. After the first measurement, not before.
2. **Doctor phase** for the pattern (prompts present, gate config sane, a
   `QUALITY.md` in the target repo parses).
3. **Slack** — `--loop blueprint` is CLI only; the Slack job runtime still runs
   the milestone loop.

## Measurement status

**First real run, 2026-09-18, hybrid engine, a repair.** Scratch repo with an
injected defect (unknown routes answered 200). Max wrote requirements (2, kind
repair) and the blueprint (1 task, 2 QA scenarios, a red test); qwen3-coder-next
did the one crew turn; the gate passed on the first attempt including the
clean-clone start probe and the vacuous-suite probe; QA ran both scenarios in
a fresh clone, 2/2; the fresh-session review said `ship` with 0 findings and
self-scored the rubric 32/35. Wall 15 min. Max API-equivalent **$1.25** for
three turns (requirements $0.40, blueprint $0.58, review $0.27). Exit 0.

The same job on the local-only engine (qwen3-coder-next as architect) stopped
at `blueprint-incomplete` twice: it could not write a lawful `TASKS.md` for a
one-file repair (four of five tasks named no files). That is the planner-quality
result from PEAR reproduced on a $0 budget, and the reason the architect turns
belong on the frontier tier.

**Scorer calibration, 2026-09-18** (`npm run quality-review`, Sonnet, repeat 2,
prompt `baefefce9cfc`, $3.06): blind medians cursor **33**, claude **30.5**,
hybrid **26.5** against the human review's 28 / 29 / 19. The instrument
preserves the result that matters — the unguarded hybrid build is clearly last,
4 to 6.5 points behind — and it caught the same defects (structure 1 for the
eslint carve-out and tracked tool state). It is more lenient than the human
reviewer in absolute terms, especially on the hybrid build, and it flips the
top two by a hair. Treat it as a relative instrument: compare candidates scored
in the same invocation with the same prompt hash, and quote deltas, not totals.

**Blueprint-loop build of snippet-vault, 2026-09-18** (`sv-acg`, hybrid, PR #1):
Max wrote 11 requirements and a blueprint of 6 tasks, 11 QA scenarios, 34 red
tests and stubs ($2.85 of the $3.98 total); qwen3-coder-next passed all six
task gates on the first attempt; the finish gate (clean-clone install, start
probe, vacuous-suite probe over 8 stubbed files) passed; **QA caught a real
defect** — the frontend task had left `public/app.js` as a stub because no
architect test exercised the UI — and the crew's QA-fix turn implemented it;
QA then passed 16/16; the fresh-session review said `ship` with one low
finding and self-scored 33/35. Wall time about 2.5 h of local turns across
resumes. Four orchestrator-side defects surfaced and were fixed along the way
(listed under Known limitations). Blind scoring, same prompt hash `baefefce9cfc`, Sonnet, repeat 2, $4.80, one
invocation, engines joined after scoring:

| engine | correctness | security | validation | tests | structure | ux | readme | median /35 | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cursor | 5 | 4.5 | 4 | 4.5 | 4.5 | 5 | 5 | **32.5** | merge |
| claude | 5 | 4.5 | 3 | 4 | 4 | 4 | 5 | **29.5** | merge-with-followup |
| **acg** (blueprint loop) | 3 | 5 | 4 | 4 | 4.5 | 3 | 5 | **28.5** | merge-with-followup |
| hybrid (unguarded) | 4.5 | 4 | 4 | 4 | 1 | 3.5 | 5 | **26** | merge-with-followup |

Against the success criteria in `PATTERN.md` section 8: within 3 of all-Claude
(28.5 vs 29.5) **met**; verdict not do-not-merge **met**; security and
correctness ≥ 3 **met**; no criterion down more than 1 versus the unguarded
hybrid **missed** (correctness 4.5 → 3); Max spend ≤ $3 **missed** ($3.98, of
which $2.85 was the blueprint turn). Three of five.

What moved: structure 1 → 4.5 and security 4 → 5 — every self-certification
defect the unguarded build had (tool state tracked, lint rule bent, vacuous
tests, non-string inputs crashing to 500) is gone, and the blueprint loop's
security is the best of the four. What did not: correctness and UX dropped
because the browser has no edit UI — the reviewers found "edit" reachable only
by a raw PUT. That is a **stage-0 defect**: the architect's eleven requirements
never named an edit flow in the browser, so no test, task, or QA scenario
demanded one, and every downstream stage faithfully built what it was told.
The theory predicts exactly this: the crew's output is bounded by the
blueprint, and the cheapest place to have caught it was the requirements
review a human (or a second architect pass against the idea's must-have list)
would have given before any crew time was spent.

**QA with a browser, 2026-09-18** (sv-acg resumed from the QA stage after the
UX layer landed; local analyst qwen3-coder-next with Playwright MCP on every
QA turn; $0.94 of Max for the review, $4.92 for the project in total). Three
batches ran in the browser where the scenario said so. First pass 9/11: **Q7
failed in the browser** — after clicking "Copy" the analyst saw no "Copied"
label and a blocked clipboard, which no curl scenario could have observed —
and Q5 failed on test-data pollution (three "ids" snippets left by the earlier
batches; a `QA.md` isolation defect, not an app defect). The crew's fix turn
added a `.catch` around the clipboard write; the second pass reported 11/11
with the Q7 evidence "catch block logged warning, button clicked", and the
fresh-session review flagged exactly that as its one (low) finding: the label
still does not change when the write fails. Two lessons, both recorded above
as prompt rules going forward: a browser scenario must state the visible
state a failed action leaves (so silencing an error cannot pass), and
scenarios must reset their data or use unique titles. One new limitation: a
browser QA batch of four scenarios hit qwen-code's 100-tool-call cap once
(snapshot after every typed character); the continuation note carried it
through, at a cost of about 25 minutes for the batch.

## First real run

A **repair**, not a build: it exercises every stage for a fraction of the cost
and the blast radius of a self-certified fix is highest there.

```bash
npm run build-app -- --loop blueprint --engine hybrid \
  --idea "GET /nope answers 200 with the not-found body; unknown routes must answer 404" \
  --repo https://github.com/you/tiny-api --ref main
```
