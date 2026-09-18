# Architect–Crew–Gate

## A repeatable pattern for any software job — build, change, repair, or maintain — where a frontier model plans, a cheap model types, quality is defined before the first line of code, and done is decided by things that cannot be argued with

This document is the pattern, independent of this kit. Everything in it can be
run by hand with any two models and a shell. `ARTICLE.md` beside this file is
the story of why it exists and the names it is composed from; this file is the
specification. Section 9 says how to run it with this kit; the rest does not
depend on it.

---

## 0. The pattern on one page

```
  a job: build · change · repair · maintain
        │
        ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ 0  REQUIREMENTS + STANDARD          architect (frontier)     1 turn     │
  │    REQUIREMENTS.md  QUALITY.md                                          │
  ├─────────────────────────────────────────────────────────────────────────┤
  │ 1  BLUEPRINT                        architect (frontier)     1–2 turns  │
  │    DESIGN.md  tests (red)  stubs  TASKS.md  QA.md                       │
  ├─────────────────────────────────────────────────────────────────────────┤
  │ 2  CREW, one task per turn          crew (local/cheap)       N turns    │
  │    red → green → refactor, inside the task's files only                 │
  │       └─► GATE after every turn     orchestrator (no model)  free       │
  │           fail → feedback → retry ≤ R → then escalate                   │
  ├─────────────────────────────────────────────────────────────────────────┤
  │ 3  FINISH GATE                      orchestrator (no model)  free       │
  │    clean clone · start · hygiene · vacuous-suite probe · traceability   │
  ├─────────────────────────────────────────────────────────────────────────┤
  │ 4  QA                               analyst (local/cheap)    1 turn     │
  │    executes QA.md black-box from a fresh clone → defects → crew fix     │
  ├─────────────────────────────────────────────────────────────────────────┤
  │ 5  REVIEW                           reviewer (frontier)      1 turn     │
  │    read-only, fresh session, reports are claims → findings with checks  │
  │    → crew fix → gate → checks                                           │
  └─────────────────────────────────────────────────────────────────────────┘
        │
        ▼
  branch + PR, QA traceability report, review findings, cost lines
```

Three rules make it work; everything else is detail.

0. **Every job is the same stages at a different size.** A gardening crew
   still needs to know which beds are which, what done looks like, and who
   inspects. A repair is one requirement, one red test, one task, one QA
   scenario, one review — and every stage still runs. Section 1a says how each
   job kind sizes the artifacts.
1. **The standard is written before the design.** `QUALITY.md` is the same
   rubric the work will be scored against. The crew builds to it, the gate
   enforces it, the reviewer cites it.
2. **The crew never grades its own work.** Its report is a claim. Done is decided
   by the gate (commands, exit codes), then QA (scripted scenarios), then the
   reviewer (a different model, fresh session).
3. **The blueprint removes judgment from the crew's turn.** Signatures, ports,
   schemas, and the tests are written by the architect. The crew's unit of work
   is "make these tests pass by filling these files," which is the unit a small
   model does well.

---

## 1a. Job kinds

The first decision the architect records is what kind of job this is. The
stages never change; their contents shrink or grow.

| | build | change | repair | maintain |
| --- | --- | --- | --- | --- |
| **What it is** | a new product or module | new or altered behaviour in an existing repo | a defect | upgrade, migration, refactor, cleanup |
| **`REQUIREMENTS.md`** | the whole product | only what changes; the rest is a non-goal | the expected behaviour that is violated; R1's check is the **reproduction** (fails today, must pass after) | **invariants**: "behaviour X unchanged", "dependency Y at Z", "no test weakened", each with a check |
| **`QUALITY.md`** | chosen for the stack | **discovered** from the repo's runner, never invented | discovered | discovered; plus "the existing suite is the invariant" |
| **`DESIGN.md`** | full layout, all ports | a **delta**: new/altered signatures, existing modules referenced by path | the defect's location, the fix's signature if any, the invariant the fix must not break | the migration steps and the invariant list |
| **Tests (red)** | one per `R` | one per changed `R` | the reproduction as a failing test, plus a neighbour test if the fix is near other behaviour | tests for any invariant the suite does not already prove |
| **Stubs** | every file | new files only | usually none | none |
| **`TASKS.md`** | many, ordered, some parallel | few | **one** is correct | one per migration step |
| **`QA.md`** | one scenario per `R` | one per changed `R` | the reproduction, black-box, from a fresh clone | the invariant checks, black-box |
| **Review hunts** | the seven classes | the seven classes | "the reproduction passes but a neighbour broke" | "an invariant is claimed, not proven" |
| **Typical frontier turns** | 2–3 | 2–3 | 2–3 (each small) | 2–3 |

The by-hand cost of a repair under this pattern is one architect chat (five
minutes), one crew task, and one review. The alternative — a model that reads
the bug, edits the code, and declares it fixed — is exactly the self-certifying
loop the pattern exists to replace, and on a repair the blast radius of a
"fix" that broke a neighbour is highest.

### Worked example: a repair

Job: "Copying a snippet whose body contains `&` pastes `&amp;` instead."

- **Stage 0.** Kind: repair. R1: `WHEN a user copies a snippet THE SYSTEM SHALL
  place the body verbatim on the clipboard`. Check: reproduction script that
  loads the page with a body `a & b` and reads back the clipboard text, expects
  `a & b`. Non-goal: any other escaping change. `QUALITY.md` discovered from
  the repo (its `npm test`, its lint).
- **Stage 1.** `DESIGN.md` delta: `public/app.js` copy button reads the body
  from a data attribute that is HTML-entity-encoded; fix is to read from the
  in-memory snippet object (or decode), signature unchanged. Invariant: the
  rendered `<pre>` stays escaped. Red test: `test/copy.test.js` `R1: copy is
  verbatim` (fails today) and `R1n: render stays escaped` (passes today, guards
  the neighbour). `TASKS.md`: T1, files `public/app.js`, tests those two.
  `QA.md`: Q1 the reproduction script from a fresh clone.
- **Stage 2.** One crew turn. Gate: ownership (only `public/app.js` changed),
  quality bar, hygiene.
- **Stage 3–4.** Finish gate; QA runs Q1 from a fresh clone.
- **Stage 5.** Review, fresh session: confirms `R1n` really exercises the
  escaped path; hunts "reproduction passes but a neighbour broke".

### Worked example: maintenance (the gardening job)

Job: "Upgrade Express 4 → 5 and Node 20 → 22."

- **Stage 0.** Kind: maintain. R1: `WHILE the upgrade is applied THE SYSTEM
  SHALL pass its existing test suite unchanged` (check: `git diff --stat
  <base> -- test/` is empty and `npm test` exits 0). R2: `express@^5` and
  `engines.node >=22` in `package.json`. R3: every route still returns the same
  status codes for the QA scenarios already in the repo (or, if none exist,
  three that the architect writes now). Non-goal: any feature work.
- **Stage 1.** `DESIGN.md`: the Express 5 breaking changes that touch this
  codebase, by file and line (`req.query` getter, removed `res.send(status)`,
  async error propagation), each with the replacement; invariant list. Tests:
  R3's scenarios as route tests if missing. `TASKS.md`: T1 bump and install; T2
  each breaking change by file; T3 engines and README. Ownership note: the
  crew may not "fix" a failing existing test — it reports it.
- **Stage 2–5** as above. The gate's tamper rule is what makes this safe: a
  crew that edits a test to survive the upgrade fails the turn.

---

## 1. Roles and tiers

| Role | Tier | Turns per job | May edit | Reads |
| --- | --- | --- | --- | --- |
| **Architect** | frontier | 2–3 | everything, once, at the start | the job, the repo |
| **Crew** | local or cheap | one per task, plus fix turns | only the files its task names | blueprint, its task, red test output |
| **Gate** | none (shell) | after every crew turn | nothing (commits the tree, reverts nothing) | the working tree, the blueprint |
| **QA analyst** | local or cheap | 1 (+1 re-run) | nothing | `QA.md`, a fresh clone |
| **Reviewer** | frontier | 1 | nothing | requirements, standard, design, diff, gate + QA reports |

Tiers are roles, not brands. "Frontier" is whatever model you trust with
judgment; "local" is whatever runs on hardware you already paid for. The pattern
holds with two frontier models of different price, or with one model and two
temperatures, as long as the reviewer's session is fresh and the crew cannot edit
what the gate checks.

**Ownership matrix** (the gate enforces this):

| Path | Architect | Crew | QA | Reviewer |
| --- | --- | --- | --- | --- |
| `REQUIREMENTS.md`, `QUALITY.md`, `DESIGN.md`, `TASKS.md`, `QA.md` | write | read | read | read |
| tests written in the blueprint | write | read, run | read, run | read, run |
| lint / typecheck / test-runner config, task-runner scripts | write | read | – | read |
| files a task names | stub | write | – | read |
| any other source file | stub | **no** | – | read |
| `README.md` | skeleton | the task that owns it | read | read |

---

## 2. Artifacts

Five documents, plus tests and stubs, all committed before the first crew turn.
Each has a human section and a machine section. The machine section is a fenced
block the orchestrator parses; the human section is what the crew reads. Keep
both; a document only a parser can read is a config file, and a document only a
person can read cannot gate anything.

### 2.1 `REQUIREMENTS.md`

```markdown
# Requirements

## Problem
Who has the problem, what it costs them today, what "solved" looks like in one
observable sentence.

## Users
One line per user type and what they need to do.

## Acceptance criteria
Stable ids. EARS form. Every criterion has a check a stranger could run.

- **R1** WHEN a user submits a title and body THE SYSTEM SHALL store the snippet
  and return it with an id within 200 ms.
  Check: `POST /api/snippets` → 201, body has `id`.
- **R2** WHEN the search box changes THE SYSTEM SHALL show matches across title,
  body, and tags without a page reload.
  Check: `GET /api/snippets?q=<word in body>` returns that snippet.
- **R3** WHILE the process is restarted THE SYSTEM SHALL retain every snippet.
  Check: create, restart, `GET /api/snippets` still lists it.

## Workflows
The end-to-end journeys a user walks, each crossing several requirements. QA
executes every one start to finish; a build or change has at least one.

- **W1** capture, find, copy, survive a restart (R1, R2, R3)
  1. open the page; click "New"; fill title and body; click "Save"; the card is visible (R1)
  2. type a word from the body into the search box; only that card remains (R2)
  3. click "Copy" on the card; the clipboard holds the body (R4)
  4. restart the server; open the page; the card is still there (R3)

## Coverage
One line per must-have bullet of the job, in the job's order.

- M1: R1, R5, R6
- M2: R2

## Non-goals (v1)
Explicit. This is the section that keeps every later turn from wandering.

## Decisions
The job kind, then every ambiguity in the job and the decision taken. Decisions, not questions.
```

```json requirements
{ "requirements": [ { "id": "R1", "text": "…", "check": "…" } ],
  "workflows": [ { "id": "W1", "title": "…", "requirements": ["R1", "R2", "R3"], "steps": ["…"] } ],
  "coverage": { "M1": ["R1", "R5", "R6"], "M2": ["R2"] } }
```

Rules: ids never change once written; a criterion without a check is not
finished; "works well" is not a criterion. **If the job has a user interface,
every user-facing flow is its own requirement whose check is a browser
sequence** (open, click, type, expect visible text), not an API call: a flow
reachable only by a raw request has not been delivered. The orchestrator
numbers the job's must-have bullets `M1..Mn` and refuses to draw a blueprint
until every one maps to real requirement ids and at least one of those is
walked by a workflow (`requirements-incomplete`). The snippet-vault build lost
its edit UI because nothing did this; see section 8.

### 2.2 `QUALITY.md` — the standard

Written before design so nothing downstream can be surprised by it. It is also,
verbatim, the rubric used to score the finished work (section 8).

```markdown
# Quality standard

## Quality bar
Commands that must exit 0 before any task is done. Fixed for the project.
| Purpose | Command |
| --- | --- |
| install | `npm ci` |
| lint | `npm run lint` |
| typecheck | `npm run typecheck` |
| test | `npm test` |
| build | `npm run build` |
| start | `npm start` — answers `GET /` with 200 within 30 s |

## Code rules
- Interfaces are segregated per consumer (ISP): a module depends on the
  smallest port it needs, never a fat interface.
- Dependencies are injected. No import-time side effects: no file, DB, or
  network access at module scope.
- One JSON error envelope on every API route; unknown `/api/*` is a JSON 404.
- User data is escaped at every render and copy boundary.
- Nothing needed to run from a clean clone is undocumented.

## Test rules
- Every acceptance criterion has at least one test tagged with its id.
- Tests are written before the code they test and confirmed to fail first.
- Tests import the real modules; a test that would pass with `src/` deleted is
  not a test.
- The crew never edits a test or a tooling config. It reports the need.

## Rubric (targets)
| Criterion | Target |
| --- | --- |
| Correctness against requirements | ≥ 4 |
| Security (injection, escaping, limits) | ≥ 4 |
| Validation and error handling | ≥ 4 |
| Test quality (what is asserted) | ≥ 4 |
| Structure and idiom (DI, ISP, hygiene) | ≥ 4 |
| UX faithfulness to the flows | ≥ 4 |
| README accuracy from a clean clone | ≥ 4 |
```

```json quality
{ "bar": { "install": "npm ci", "lint": "npm run lint", "typecheck": "npm run typecheck",
           "test": "npm test", "build": "npm run build" },
  "start": { "command": "npm start", "probe": { "http": "/", "expect": 200, "timeout_s": 30 } },
  "hygiene_never_tracked": ["node_modules/", "dist/", "build/", "coverage/", "*.db", ".env",
                            ".qwen/", ".aider*", ".cursor/worktrees/"],
  "rubric_targets": { "correctness": 4, "security": 4, "validation": 4, "tests": 4,
                      "structure": 4, "ux": 4, "readme": 4 } }
```

The machine block is what makes the pattern stack-agnostic: the gate runs
whatever the `bar` says, probes whatever `start` says, and forbids whatever
`hygiene_never_tracked` says. A Go service writes `go vet`, `go test ./...`, and
`go build`; a Python service writes `ruff`, `mypy`, `pytest`; the gate does not
know or care.

### 2.3 `DESIGN.md` — the blueprint

```markdown
# Design

## Layout
src/app.js          createApp(deps) → http handler. No listen here.
src/server.js       reads PORT, calls createApp with real adapters, listens.
src/ports.js        the port interfaces (JSDoc/TS types), no logic.
src/store/sqlite.js SnippetStore adapter over node:sqlite.
src/search/like.js  SearchIndex adapter over SQL LIKE.
public/…            static UI.
test/…              one file per port + one per route group.

## Ports (ISP: one per consumer)
### SnippetReader   used by: routes/list, routes/get, search
  get(id): Snippet | null
  list(): Snippet[]
### SnippetWriter   used by: routes/create, routes/update, routes/delete
  create(input): Snippet         throws ValidationError on bad input
  update(id, patch): Snippet | null
  remove(id): boolean
### SearchIndex     used by: routes/search
  query(q: string): Snippet[]    q is matched case-insensitively in title, body, tags
### Clock           used by: writer
  now(): ISO string

## Wiring
createApp({ reader, writer, search, clock }) — every adapter passed in; tests
pass fakes.

## Data model
Snippet { id: int, title: string, language: string|null, body: string,
          tags: string[], createdAt: ISO, updatedAt: ISO }

## API contract
POST   /api/snippets        201 Snippet | 400 {error}
GET    /api/snippets?q=     200 Snippet[]
GET    /api/snippets/:id    200 Snippet | 404 {error}
PUT    /api/snippets/:id    200 Snippet | 400 | 404
DELETE /api/snippets/:id    204 | 404
any other /api/*            404 {error:"not found"}   (JSON, never HTML)
Error envelope: { "error": "<one sentence>" }
```

Every exported symbol the crew will implement is named here with its signature
and error behaviour. This is the Repository Interface Blueprint. If the crew has
to decide a signature, the blueprint is incomplete.

### 2.4 Tests, red, and stubs

The architect commits, in the blueprint turn:

- Every file in the layout, exporting every signature, with bodies of
  `throw new Error("not implemented: <name>")`.
- One or more tests per requirement id, importing the real modules, asserting
  behaviour, tagged (`test("R2: search matches body", …)`). Unit tests against a
  port use a fake of that port. The suite must be **red** at this commit.
- Tooling: the quality-bar scripts, lint and typecheck config, `.gitignore`
  with the hygiene list, a README skeleton with the run commands.

### 2.5 `TASKS.md`

```markdown
# Tasks

## T1: SQLite SnippetStore adapter
Requirements: R1, R3
Files: src/store/sqlite.js
Ports: SnippetReader, SnippetWriter
Tests: test/store.sqlite.test.js
Commands: npm test -- test/store.sqlite.test.js, npm run lint
Parallel: yes
Out of scope: routes, search, UI
Goal: make the store tests green with node:sqlite, parameterised queries only.

## T2: create/list/get routes
Requirements: R1
Files: src/routes/snippets.js
Ports: SnippetReader, SnippetWriter (consume only)
Tests: test/routes.snippets.test.js
Commands: npm test -- test/routes.snippets.test.js, npm run lint
Parallel: no
Out of scope: search, UI
Goal: …
```

Rules: a task lists every file it may write and nothing else; two `Parallel: yes`
tasks never share a file or change a port; a task fits one crew turn (aim: 1–3
files, ≲150 changed lines); order is by dependency.

```json tasks
{ "tasks": [ { "id": "T1", "title": "…", "requirements": ["R1","R3"], "files": ["src/store/sqlite.js"],
               "ports": ["SnippetReader","SnippetWriter"], "tests": ["test/store.sqlite.test.js"],
               "commands": ["npm test -- test/store.sqlite.test.js","npm run lint"], "parallel_ok": true } ] }
```

### 2.6 `QA.md`

One black-box scenario per requirement, executable by someone who has never
seen the code.

```markdown
# QA scenarios

## Q1 (R1): create returns the snippet
Given: fresh clone; `npm ci`; `PORT=4571 npm start`
When:  curl -s -X POST localhost:4571/api/snippets -H 'content-type: application/json' \
         -d '{"title":"jq ids","body":"jq -r .[].id","tags":["jq"]}'
Then:  HTTP 201; body is JSON with a numeric `id` and `title` "jq ids"
Evidence: the response body

## Q3 (R3): survives restart
Given: the snippet from Q1 exists; stop the server
When:  `PORT=4571 npm start` again; curl -s localhost:4571/api/snippets
Then:  the list contains the Q1 snippet
Evidence: both responses

## Q12 (W1): capture, find, copy, survive a restart
Given: the running instance from Q1
When:
  1. open http://localhost:4571/; click the button named "New"; type "jq ids"
     into the field named "Title" and `jq -r .[].id` into "Body"; click "Save";
     expect a card with "jq ids" visible
  2. type "ids" into the field named "Search"; expect exactly one card visible
  3. click "Copy" on that card; expect the button's label to read "Copied" and
     the clipboard to hold `jq -r .[].id`
  4. restart the server; open the page again; expect the "jq ids" card visible
Then:  every step's expectation held, in order
Evidence: the accessibility-snapshot lines showing each step's expectation
```

```json qa
{ "scenarios": [ { "id": "Q1", "requirement": "R1" }, { "id": "Q3", "requirement": "R3" }, { "id": "Q12", "requirement": "W1" } ] }
```

Steps that happen on a page are written as browser actions (open URL, click
the button named X, type Y into the field named Z, expect visible text). The
analyst has a real headless browser (Playwright MCP) and uses it for exactly
those lines; an API check can be a second line of evidence, never a substitute.

### 2.7 Traceability

Before the first crew turn the orchestrator checks: every `R` has ≥1 test tagged
with it, ≥1 task covering it, and ≥1 QA scenario; every `W` has a QA scenario
that walks it. A requirement with none of the three, or a workflow with no
scenario, is a blueprint defect and the job stops there — cheaply, before any
crew time is spent.

### 2.8 The UX layer

TDD proves the code; it cannot prove the product. Three things make the user's
path a first-class deliverable, at the three places it can be lost:

1. **Stage 0, coverage.** Every must-have maps to requirement ids; every
   user-facing flow is a requirement with a browser check; every must-have is
   walked by a workflow. Checked by the orchestrator, not the architect.
2. **Stage 1, browser tests.** For every browser-flow requirement the architect
   writes a test that drives the real page (Playwright: start the app, open it,
   act by role and accessible name, assert on visible text), tagged with the
   id, run by the same `test` command, red at the baseline. A stubbed frontend
   is now red, so a crew cannot pass every unit test and ship a page that does
   nothing.
3. **Stage 4, a browser for QA.** The analyst walks every workflow in a
   headless browser through Playwright MCP, reading the accessibility snapshot
   and acting by element ref, and quotes the snapshot as evidence. A workflow
   fails at the first step whose expectation does not hold; the defect names
   the step.

**Jobs with no user interface** — an ETL pipeline, a database migration, a
CLI, a library, a service with only an API — skip the browser parts entirely,
and the orchestrator decides that from the scenarios, not from a flag: a QA
batch gets the browser only when one of its scenarios names a page, a click,
or typing into a field; otherwise no server is started and the prompt says so.
Workflows and coverage still apply to every job, because a pipeline has
journeys too ("drop the file, run the loader, query the rows, run it again,
nothing duplicated"); they are walked with the shell, HTTP, SQL, or the CLI.

---

## 3. Stages

Each stage has an entry condition, an owner, an output contract (a fenced
`json` block the orchestrator parses), and an exit rule. A stage whose output
does not parse is retried once, then the job stops with `unparseable-report`.

### Stage 0 — Requirements and standard (architect)

- **In:** the job (idea, change request, defect report, or maintenance order),
  the repo as it is.
- **Out:** `REQUIREMENTS.md`, `QUALITY.md`, committed. JSON:
  `{requirements[], workflows[], coverage{}, quality}`.
- **Exit:** the job kind is recorded; every requirement has an id and a check;
  `quality.bar` has at least `test`; every must-have `M` maps to real
  requirement ids and one of them is in a workflow; a build or change has at
  least one workflow; the commit exists. Gaps → one targeted retry → else
  `requirements-incomplete`.

### Stage 1 — Blueprint (architect)

- **In:** stage 0 artifacts.
- **Out:** `DESIGN.md`, red tests, stubs, tooling, `TASKS.md`, `QA.md`, committed
  as one commit (the *baseline* every later diff is measured from).
  JSON: `{tasks[], qa_scenarios[], baseline_commit}`.
- **Exit:** the quality bar's lint and typecheck pass on the stubs; the test
  suite runs and **fails**; traceability is complete (every `R` and every `W`);
  browser-flow requirements have browser tests.

### Stage 2 — Crew tasks (crew, gated)

For each task in order (or in parallel for `parallel_ok` tasks, one worktree
each, merged in order):

- **In:** the task block verbatim, the design sections for its ports, the
  current output of its tests (red).
- **Out:** commits inside the task's files; JSON
  `{task_id, done, tests_green[], files_changed[], notes}`.
- **Gate** (section 4) runs on the working tree. Fail → feedback → retry, up to
  R. Still failing → the task is `gate-failed`; the loop may escalate the same
  task to the frontier tier once if the budget allows, else stop.
- **Exit:** gate passed. The crew's `done` field is recorded, never consulted.

### Stage 3 — Finish gate (orchestrator)

The gate's finish profile: clean clone, install, start-probe, full quality bar,
hygiene, vacuous-suite probe, traceability re-check. Fail → one crew fix turn
with the findings → re-run once → else `gate-failed`.

### Stage 4 — QA (analyst)

- **In:** `QA.md`, `REQUIREMENTS.md`, the README's run instructions, a **fresh
  clone** (never the crew's tree), and a **headless browser** (Playwright MCP)
  for every step that happens on a page.
- **Out:** JSON `{results[{id, requirement, passed, evidence, defect?}], traceability{covered[], uncovered[]}}`;
  `requirement` is an `R` id or, for a workflow scenario, a `W` id.
- **Rule:** executes scenarios exactly; may not edit code; may not invent
  scenarios; records evidence verbatim (snapshot lines for browser steps); a
  workflow stops at its first failed step and the defect names the step.
- **Exit:** every scenario passed. Any failed → one crew fix turn
  (`qa-fix`, defects verbatim, owned files widened to the defect's file) → gate
  → QA re-run once → else `qa-failed`.

### Stage 5 — Review (reviewer)

- **In:** requirements, standard, design, `git diff <baseline>...HEAD`, gate
  results and the QA report (evidence, not verdicts), the crew's reports (claims).
- **Session:** fresh. Read-only tools. A different model from the crew, or the
  same model with no memory of the job.
- **Hunts what gates and scripts cannot:** import-time side effects, tests that
  assert nothing meaningful, half-implemented escaping or encoding, API
  contract breaks, undocumented steps, ISP violations, requirement drift.
- **Out:** JSON `{verdict: ship|fix, summary, claims_disputed[], findings[{id, severity, class, file, line, problem, fix, check{command, expect_exit}}]}`.
- **Exit:** no high findings → **done**. High findings → one crew fix turn
  (`review-fix`) → gate → every `check` exits as expected → **done**; else
  `review-unresolved`.

### Stop reasons

`complete` · `unparseable-report` · `blueprint-incomplete` (traceability) ·
`gate-failed` · `qa-failed` · `review-unresolved` · `blocked` · `ceiling`
(frontier budget) · `run-failed`. Every stop leaves the branch resumable from
the last passed gate.

---

## 4. The gate contract

The gate is a program, not a prompt. It runs in the working tree after a crew
turn is committed, reads `QUALITY.md`'s machine block, and returns a list of
findings. It has two profiles: `task` (after each crew turn) and `finish`.

| Rule | Profile | What it checks | Source of truth |
| --- | --- | --- | --- |
| ownership | task, finish | `git diff --name-status <turn-base>..HEAD`: nothing outside the task's `files`; no `M` on any test or tooling config; no touch at all on the five documents | `TASKS.md`, ownership matrix |
| quality-bar | task, finish | every `bar` command exits 0; the task's named tests pass; previously green tests stay green | `QUALITY.md` |
| hygiene | task, finish | `git ls-files` matches none of `hygiene_never_tracked`; ignore file covers them | `QUALITY.md` |
| tamper | task, finish | task-runner scripts unchanged since baseline; lint config has no per-name exemptions; no `.only`/`.skip`; every test imports app code | baseline commit |
| clean-start | finish (+ every Nth task) | `git clone . scratch` → `install` → `start` → `probe` succeeds within `timeout_s` | `QUALITY.md.start` |
| vacuous-suite | finish | with every source file replaced by a throw, the suite must fail | layout in `DESIGN.md` |
| traceability | before stage 2, finish | every `R` has a test, a task, a QA scenario | the five documents |

**Feedback format** (what the crew sees on retry):

```
## Quality gate failed (attempt 2)

The orchestrator, not you, decides this turn is done. It ran the quality
contract in your clone and found:

- [quality-bar] npm test exited 1 (`npm test`)
  last output:
  … 40 lines …
- [ownership] modified an existing test: test/store.sqlite.test.js. Creating one
  is fine; changing one to get green is not — fix the code it tests.

Fix the cause of each, not the check. Do not edit tests, config, or files outside
this task's scope to make these pass.
```

**Retries:** R (default 2). Each retry is a fresh crew process with the feedback
prepended; the working tree carries the progress.

**Environment:** gate subprocesses get a scrubbed environment — no provider
keys, and no test-runner context variables inherited from the orchestrator
(`NODE_TEST_CONTEXT`, `PYTEST_CURRENT_TEST`, …), which otherwise make a target
repo's own runner think it is nested and skip.

---

## 5. Routing and budget

| Stage | Default tier | Over frontier ceiling |
| --- | --- | --- |
| 0 requirements | frontier | local planner model, or stop |
| 1 blueprint | frontier | local planner model, or stop |
| 2 crew | local | local |
| 3 finish gate | none | none |
| 4 QA | local | local |
| 5 review | frontier | local reviewer, flagged as such in the record |
| escalation of a failed task | frontier, once | skip |

The ceiling is a utilization fraction of the frontier plan's window (this kit
reads it from the Agent SDK's rate-limit events; any provider that reports
usage will do). Nothing in the pattern ever buys overage.

Reference costs (snippet-vault-size app, Claude Sonnet as architect and reviewer,
qwen3-coder-next as crew, one M4 Max): stage 0 ≈ $0.40, stage 1 ≈ $1–2, stage 5
≈ $0.50, everything else electricity. Total ≈ $2–3 against $6.65 all-frontier.

---

## 6. Applying it to any project

### Greenfield (a build)

Stage 0 starts from the idea. The blueprint creates the whole layout.
`baseline_commit` is the blueprint commit.

### Brownfield (a change, repair, or maintenance job on an existing repo)

- Stage 0's "problem" is the change; acceptance criteria describe new or changed
  behaviour only; `QUALITY.md.bar` is discovered from the repo's existing task
  runner and **not invented** (if the repo has no tests, the first task is to add
  the runner, and that task is architect-written).
- Stage 1's blueprint is a **delta**: new/changed signatures, new tests (red),
  stubs only for new files. `DESIGN.md` may reference existing modules by path
  instead of restating them.
- Ownership's "architect-owned tests" means tests added in the blueprint; the
  crew may not modify pre-existing tests either, but may add new ones only if a
  task explicitly names the file.
- `baseline_commit` is still the blueprint commit; the gate's tamper check
  compares task-runner scripts against it, so pre-existing scripts are the
  baseline.

### Any stack

The five documents are stack-neutral; the gate reads commands from
`QUALITY.md`, never from a package manager it happens to know. Reference bars:

| Stack | install | lint | typecheck | test | build | start probe |
| --- | --- | --- | --- | --- | --- | --- |
| Node | `npm ci` | `npm run lint` | `npm run typecheck` | `npm test` | `npm run build` | `npm start` → `GET /` |
| Python | `uv sync` / `pip install -e .` | `ruff check .` | `mypy .` | `pytest` | – | `python -m app` → `GET /health` |
| Go | `go mod download` | `golangci-lint run` | (compile) | `go test ./...` | `go build ./...` | `./bin/app` → `GET /healthz` |
| .NET | `dotnet restore` | `dotnet format --verify-no-changes` | (compile) | `dotnet test` | `dotnet build` | `dotnet run` → `GET /health` |
| CLI (any) | as above | as above | as above | as above | as above | `<bin> --help` exit 0 |

Hygiene lists per stack: Node `node_modules/ dist/ coverage/`; Python
`.venv/ __pycache__/ .pytest_cache/ *.pyc`; Go `bin/`; .NET `bin/ obj/`; plus
the tool-state entries (`.qwen/ .aider* .cursor/worktrees/`) and `.env`, `*.db`
everywhere.

Test-file conventions the ownership rule recognises: `test/ tests/ __tests__/
spec/`, `*.test.* *.spec.*`, `test_*.py *_test.py`, `*_test.go`, `*Tests.cs`.

### Any model pair

The crew must be able to (a) read files, (b) edit files, (c) run a shell
command, (d) end its turn with a fenced JSON block. Any agentic CLI over an
OpenAI-compatible endpoint qualifies. If the crew runner caps tool calls per
turn (qwen-code: 100), the orchestrator continues an interrupted turn with a
note rather than failing it; progress is on disk.

The architect must be able to write a lot of correct code in one turn (the
tests and stubs). This is the one place the pattern is sensitive to model
quality, and it is why the reviewer's session is fresh: an architect reviewing
its own blueprint anchors on it.

### By hand, with no orchestrator

The pattern degrades gracefully to a checklist:

1. Paste `architect-crew-gate/prompts/requirements.md` into a frontier chat with the job
   (idea, bug report, change request, upgrade order). Commit what it writes.
2. Paste `architect-crew-gate/prompts/blueprint.md`. Commit. Confirm `npm test` is red.
3. For each task, paste `architect-crew-gate/prompts/task.md` with the task block into the
   local model's agent. Then run the gate commands yourself: the quality bar,
   `git diff --name-status`, `git ls-files | grep -E '…'`. Reject and retry on
   any failure.
4. Paste `architect-crew-gate/prompts/qa.md` into any agent in a fresh clone.
5. Paste `architect-crew-gate/prompts/review.md` into a **new** frontier chat.

You lose the automatic retries and the record-keeping; you keep every quality
property.

---

## 7. Failure modes and their fix

| Symptom | Cause | Fix in the pattern |
| --- | --- | --- |
| Crew "passes" by editing a test or lint rule | self-certification | ownership + tamper rules; the crew cannot touch what the gate reads |
| Suite green, app broken | tests assert nothing | vacuous-suite probe at finish; test rules in `QUALITY.md` |
| Works on the crew's machine only | undocumented step | clean-start probe from a fresh clone |
| Crew redesigns mid-task | blueprint incomplete | a signature the crew had to choose is a stage-1 defect; add it to `DESIGN.md`, re-run the task |
| Two parallel tasks conflict | shared file or changed port | `parallel_ok` requires file exclusivity and interface stability; else run sequentially |
| Review finds what QA missed | scripted QA is literal | that is the division of labour; the reviewer exists for judgment, QA for regressions of the stated criteria |
| Reviewer argues with the crew's report | it read the report as fact | review prompt labels every report a claim; fresh session |
| Job stops at `blueprint-incomplete` | an `R` with no test, task, or scenario | cheapest possible failure; fix the blueprint, not the crew |
| Frontier ceiling hit mid-job | budget | stages 0/1/5 divert to the local planner and are flagged in the record; or the job stops resumable |

---

## 8. Measuring it

"Better" is a number from a **blind rubric review**: the seven criteria in
`QUALITY.md`, scored 1–5 with anchors, by a frontier model in a fresh read-only
session, on an anonymised copy of the repo (engine words, repo name, authors,
tool directories removed; their prior presence recorded as a hygiene fact),
candidates shuffled, engine identity joined back only after scoring. Two
repeats, medians. Same prompt version (hash it), same model, same idea across
every candidate compared.

Calibrate first on candidates a human has already scored; require the same
ranking within ±3 before trusting new numbers.

Success for a change to the pattern: the treated build's median total is within
3 of the all-frontier build, its verdict is not `do-not-merge`, security and
correctness are ≥ 3, no criterion regressed by more than 1, and frontier spend
stayed under the budget line.

---

## 9. Running it with this kit

Prompts: `architect-crew-gate/prompts/{requirements,blueprint,task,qa,qa-fix,review,review-fix}.md`.
Templates: `architect-crew-gate/templates/`. Gate: `architect-crew-gate/src/quality-gate.ts`
(reads `QUALITY.md`'s machine block; `package.json` scripts as the fallback).
Loop: `architect-crew-gate/src/blueprint-loop.ts` over `src/io.ts`, selected with
`--loop blueprint` / `BUILD_LOOP=blueprint`. Scoring: `npm run quality-review`
(`architect-crew-gate/src/quality-review.ts`, rubric in `prompts/quality-review.md`).

```bash
ENGINE=hybrid LOCAL_MODEL=qwen3-coder-next npm run doctor -- --phase A
npm run build-app -- --loop blueprint --engine hybrid --idea-file ideas/example.md --create-repo my-app   # build
npm run build-app -- --loop blueprint --engine hybrid --idea "Copying a body with & pastes &amp;" --repo https://github.com/you/app   # repair
npm run build-app -- --resume cc-…                                                                    # from the stage that stopped
npm run quality-review -- --job-file ideas/example.md https://github.com/you/my-app --repeat 2 [--dry-run]
```

Env: `LOCAL_GATE*` (section 4), `HYBRID_*` and `MAX_UTILIZATION_CEILING`
(section 5), `LOCAL_MODEL` / `LOCAL_PLANNER_MODEL` / `LOCAL_RUNNER`,
`QA_BROWSER` (`playwright`, the default, gives the QA analyst a headless
Chromium through `@playwright/mcp` on either tier — registered in the fresh
clone's `.qwen/settings.json` for qwen-code, passed as `mcpServers` to the
Claude SDK; `0` runs QA without one), `PLAYWRIGHT_MCP_ARGS` (default
`--headless --isolated`).

---

## 10. Checklists

**Architect, stage 0.** Job kind named · problem in one observable sentence
(for a repair: the reproduction) · every criterion has
an id and a check · every user-facing flow is a requirement with a browser
check · workflows listed with steps and ids · coverage line per must-have ·
non-goals explicit · every ambiguity decided · quality bar commands are real
for this stack · rubric targets set.

**Architect, stage 1.** Every exported symbol has a signature and error
behaviour · ports are per consumer · `createApp(deps)` or the stack's equivalent
· a test per requirement id, red · a browser test per browser-flow requirement
· stubs for every file · tooling + ignore file + README skeleton · tasks are
file-exclusive and one-turn-sized · a QA scenario per requirement and per
workflow, page steps as browser actions · traceability complete.

**Crew, each task.** Read the task block and only the design sections it names ·
run the named tests, see red · implement inside the named files · run the
commands · commit with the task id · report JSON · never touch tests, config,
or other files.

**Release.** Finish gate passed · QA all green with evidence · review verdict
`ship` or all checks green after the fix turn · PR body carries the QA
traceability table and the review summary · cost lines per meter.
