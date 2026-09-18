# Job: phase 1, blueprint

You are the architect. `REQUIREMENTS.md` and `QUALITY.md` are committed; read
both first, including the job kind under Decisions. Your task now is to draw the
blueprint so completely that a smaller model with no memory of this
conversation, no ability to ask questions, and no licence to make design
decisions can do the whole job one task at a time. Every signature it would
otherwise have to choose, you choose here. Every test it will be judged by, you
write here.

The blueprint scales with the job. A **build** draws the whole layout. A
**change** or **repair** draws a delta: only new or altered signatures, only new
tests, stubs only for new files, and `DESIGN.md` references the existing modules
by path. A **maintain** job's design is the invariant list and the migration
steps; its tests are the existing suite plus any test that proves an invariant
the suite did not already cover. One task is a valid `TASKS.md`.

## The job (orientation only; REQUIREMENTS.md is authoritative)

{{job}}

## Write and commit, as one commit

Every file below must exist on disk when you finish — created with your
file-writing tool, staged, committed. The orchestrator reads the working tree,
not your reply; a blueprint that exists only in your message is a failed turn.

### `DESIGN.md`

1. **Layout**: every file the finished job will have touched or created, one
   line each: path, what it exports, one sentence of responsibility. For a
   change or repair, list only the files in the delta.
2. **Ports**, one per consumer (interface segregation): for each port, who uses
   it, every method with its full signature, return type, and error behaviour
   (what it throws or returns on bad input, on not-found). Small interfaces;
   a consumer never depends on a method it does not call.
3. **Wiring**: how adapters are injected (`createApp(deps)` or this stack's
   equivalent). No module opens a database, file, or socket at import time.
4. **Data model**: entities and fields with types.
5. **API contract** (if any): every route, request shape, response shape, status
   codes, the single error envelope, and the JSON 404 for unknown API paths.
   For a CLI: every flag, exit code, and output format.
6. **Existing code** (change, repair, maintain): reference modules you keep by
   path; list only what changes. For a repair, name the defect's location and
   the invariant the fix must not break.

### Tests, red

For every requirement id, at least one test that imports the **real** modules
and asserts behaviour, named with the id (`R2: search matches body`). For a
repair, the reproduction becomes a test that fails today. For maintenance, an
invariant becomes a test if the suite did not already prove it. Unit tests
against a port use a fake of that port; route or CLI tests use the wired app
with fakes injected. Commit them **before** any implementation exists; the suite
must fail at this commit. These tests are the definition of done; the crew may
not edit them.

**Browser tests, if the job has a user interface.** For every requirement whose
check is a browser flow, one test that drives the real page: Playwright (or the
stack's equivalent) starts the app on a fixed port, opens it, acts by role and
accessible name (`getByRole('button', { name: 'Copy' })`), and asserts on what
the user sees. Tag them with the requirement id like every other test, run them
from the same `test` command as the rest of the bar (a `playwright.config` with
`webServer` is the usual way), and make `install` fetch the browser
(`npx playwright install chromium`). These are the tests that make a stubbed
frontend red; without them the crew can pass every unit test and ship a page
that does nothing.

### Stubs and tooling

- Every **new** file in the layout, exporting every signature from `DESIGN.md`,
  with bodies that throw `not implemented: <name>`. Existing files are not
  stubbed; the task that changes them names them in `Files:`.
- The quality bar from `QUALITY.md` wired for real: the scripts or targets, lint
  and typecheck config, the test runner. `npm run lint` and typecheck must pass
  on the stubs; `npm test` (or the stack's equivalent) must run and fail.
- `.gitignore` covering `QUALITY.md`'s `hygiene_never_tracked`.
- `README.md` skeleton: what it is, install, run, test — the exact commands.

### `TASKS.md`

Ordered tasks the crew will execute one per turn. Each in exactly this form:

```
## T1: <title>
Requirements: R1, R3
Files: src/store/sqlite.js
Ports: SnippetReader, SnippetWriter
Tests: test/store.sqlite.test.js
Commands: npm test -- test/store.sqlite.test.js, npm run lint
Parallel: yes
Out of scope: routes, search, UI
Goal: one sentence.
```

Rules: `Commands` are real shell lines, one per comma, each runnable as-is
under `sh -c` (`npm test -- test/x.test.js`, not "start the server then curl");
anything that needs a running server belongs in `QA.md`, not here. `Files` is
the complete list a task may write, nothing else; a task fits
one focused turn of a small model (1–3 files, roughly 150 changed lines); order
by dependency; `Parallel: yes` only when the task shares no file with, and
changes no port used by, any other parallel task; at most {{max_tasks}} tasks;
the last task owns `README.md` completion (or, for a repair or maintenance
job, the changelog or release-note line if the repo keeps one).

End with:

```json tasks
{ "tasks": [ { "id": "T1", "title": "...", "requirements": ["R1"], "files": ["..."], "ports": ["..."], "tests": ["..."], "commands": ["..."], "parallel_ok": true } ] }
```

### `QA.md`

One black-box scenario per requirement id, executable by someone who has never
seen the code, from a fresh clone, using only the README's run instructions:

```
## Q1 (R1): <title>
Given: fresh clone; <install>; <start command with a fixed port>
When:  <exact commands: curl / CLI invocation / steps>
Then:  <exact expected status, output, or state>
Evidence: <what to capture>
```

Then **one scenario per workflow** in `REQUIREMENTS.md` ({{workflow_ids}}),
headed `## Qn (W1): <title>`, whose `When` is the workflow's steps in order,
each step with its own expected observation, so a failure names the step. A
step that happens in a browser is written as browser actions (open URL, click
the button named X, type Y into the field named Z, expect visible text), never
as an API call: the QA analyst has a real headless browser and uses it for
exactly these lines. Where a browser action's outcome is also visible over the
API, add the API check as a second line of evidence, not a substitute. Two
rules learned the hard way: every scenario creates its own data with a unique
title (or resets the store) so an earlier scenario's leftovers cannot change
its count; and a browser step whose action can fail (clipboard, network,
permission) states the visible state the failure must leave ("the button reads
'Copy failed'"), so a fix that merely silences the error cannot pass.

End with:

```json qa
{ "scenarios": [ { "id": "Q1", "requirement": "R1" }, { "id": "Q12", "requirement": "W1" } ] }
```

## Before you commit, check traceability

Every `R` id has: a test tagged with it, a task listing it, a QA scenario for
it. Every `W` id has a QA scenario that walks it. If any is missing, add it.
The orchestrator checks this and stops the job if it fails, so fix it here.

## Then

One commit: `blueprint: design, red tests, stubs, tasks, qa`. Do not implement
anything. Do not make the tests pass.

## Output

A short summary, then a single fenced `json` block, nothing after it:

```json
{
  "tasks": [ { "id": "T1", "title": "...", "requirements": ["R1"], "files": ["..."], "tests": ["..."], "parallel_ok": true } ],
  "qa_scenarios": [ { "id": "Q1", "requirement": "R1" } ],
  "tests_red": true,
  "baseline_commit": "the commit message you used"
}
```
