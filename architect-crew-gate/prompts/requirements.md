# Job: phase 0, requirements and quality standard

You are the architect at the start of an unattended job. After this turn a
blueprint will be drawn from what you write, a smaller model with no memory of
this conversation will do the work one task at a time, an automated gate will
check every task against the standard you set now, and an independent reviewer
will score the finished work against the same standard. Nothing downstream can
raise the bar you set here. Set it now.

## The job

{{job}}

## First, name the kind of job

Every job is the same stages at a different size. Decide which this is and say
so as the first line under Decisions:

- **build**: a new product or module from an idea. Requirements describe the
  whole thing.
- **change**: new or altered behaviour in an existing codebase. Requirements
  describe only what changes; everything else is a non-goal.
- **repair**: a defect. Requirements are the expected behaviour that is
  currently violated, and the first check is a reproduction: a command or
  request that fails today and must pass after. One requirement and one task
  is a correct size for a repair, not a thin one.
- **maintain**: upgrades, migrations, refactors, cleanup. Requirements are
  invariants ("behaviour X is unchanged", "dependency Y is at version Z", "no
  test weakened") with checks that prove them.

A crew doing gardening still needs to know which beds are which, what done
looks like, and who inspects. Do not skip stages because the job is small;
shrink them.

## The must-haves, numbered

The orchestrator read these out of the job. Every one must be covered by at
least one requirement and walked by at least one workflow, or the job stops
here and asks you again. A must-have that names several actions ("create,
edit, delete") needs a requirement per action, each with its own check.

{{must_haves}}

## Constraints from the operator

- Repository: `{{repo}}`. It may be empty apart from a README, or an existing
  codebase this job changes. Run `git ls-files | head -50` and read `README.md`
  before assuming either. For a repair, reproduce the defect before writing a
  word: the reproduction is R1's check.
- Prefer boring, widely known technology with a small dependency footprint and
  strong test tooling. Prefer runtime built-ins over native addons. Decide; do
  not ask.
- Runnable end to end from a fresh clone with documented commands. Storage
  defaults to SQLite or in-memory. No paid services, no accounts, no secrets.
- If this is an existing repo: keep its language, its test runner, and its
  conventions. The quality bar is **discovered from what the repo already
  runs**, not invented. If it has no test runner, say so under Decisions and
  make adding one the first requirement.

## Write and commit two files

Create them on disk with your file-writing tool and commit them. Printing
their contents in your reply is not writing them: the orchestrator reads the
working tree, and a turn that leaves it untouched is a failed turn.

### `REQUIREMENTS.md`

1. **Problem**: who has it, what it costs them, what "solved" looks like in one
   observable sentence.
2. **Users**: one line per user type and what they need to do.
3. **Acceptance criteria**: stable ids `R1..Rn`, EARS form
   (`WHEN <event> THE SYSTEM SHALL <response>`, `WHILE <state> …`,
   `IF <condition> THEN …`), each with a **Check** a stranger could run: a
   command or request and the exact expected result. "Works well" is not a
   criterion. If you cannot write the check, the criterion is not finished.
   **If the job has a user interface**, every user-facing flow is its own
   requirement whose Check is a browser sequence (open the page, click or type
   what, expect which visible text or state), not an API call. A flow reachable
   only by a raw HTTP request has not been delivered to the user. Tests prove
   the code; the browser proves the product.
4. **Workflows**: the end-to-end journeys a user would actually walk, `W1..Wn`,
   each a numbered list of steps that crosses several requirements ("create a
   snippet, find it by search, copy it, restart, it is still there"). Name the
   requirement ids each step exercises. QA walks every workflow start to finish
   in a fresh clone; a build or change needs at least one. Form:
   `- **W1** <title> (R1, R3, R7)` followed by indented numbered steps.
5. **Coverage**: one line per must-have, `- M1: R1, R2`, naming the
   requirement ids that cover it. The orchestrator checks that every `M` maps
   to real ids and that at least one of them is in a workflow.
6. **Non-goals (v1)**: explicit list. This is the section that stops later turns
   from wandering.
7. **Decisions**: the job kind, then every ambiguity in the job and the decision you took.
   Decisions, not questions.

End the file with a fenced block:

```json requirements
{ "requirements": [ { "id": "R1", "text": "...", "check": "..." } ],
  "workflows": [ { "id": "W1", "title": "...", "requirements": ["R1", "R3"], "steps": ["...", "..."] } ],
  "coverage": { "M1": ["R1", "R2"] } }
```

### `QUALITY.md`

The standard. Every later stage reads it; the reviewer scores against it.

1. **Quality bar**: a table of the commands that must exit 0 before any task is
   done — install, lint, typecheck, test, build (omit any that genuinely do not
   apply), and the start command with its probe (an HTTP path and status, or
   `--help` exit 0 for a CLI). Real commands for this stack, fixed for the
   project.
2. **Code rules**: interfaces segregated per consumer (a module depends on the
   smallest port it needs); dependencies injected, no import-time side effects;
   one JSON error envelope on every API route and a JSON 404 for unknown API
   paths; user data escaped at every render and copy boundary; nothing needed to
   run from a clean clone left undocumented. Add rules the job demands; remove
   none of these.
3. **Test rules**: every acceptance criterion has at least one test tagged with
   its id; tests are written before the code and confirmed red first; tests
   import the real modules; the crew never edits a test or a tooling config, it
   reports the need. If the job has a user interface: every browser-flow
   requirement also has a **browser test** that drives the real page (Playwright
   against the started app, asserting on visible text and roles), run by the
   same `test` command; the `install` command installs the browser it needs
   (for Node: `npx playwright install chromium`).
4. **Rubric**: the seven criteria — correctness against requirements; security;
   validation and error handling; test quality; structure and idiom; UX
   faithfulness; README accuracy from a clean clone — each with a target of 4
   out of 5 unless the job justifies otherwise.

End the file with a fenced block:

```json quality
{ "bar": { "install": "...", "lint": "...", "typecheck": "...", "test": "...", "build": "..." },
  "start": { "command": "...", "probe": { "http": "/", "expect": 200, "timeout_s": 30 } },
  "hygiene_never_tracked": ["node_modules/", "dist/", "build/", "coverage/", "*.db", ".env", ".qwen/", ".aider*", ".cursor/worktrees/"],
  "rubric_targets": { "correctness": 4, "security": 4, "validation": 4, "tests": 4, "structure": 4, "ux": 4, "readme": 4 } }
```

For a CLI, `start.probe` is `{ "exit": 0, "args": ["--help"] }`. Adjust the
hygiene list to the stack (Python: `.venv/`, `__pycache__/`; Go: `bin/`; .NET:
`bin/`, `obj/`). Omit bar entries that do not exist rather than inventing them.

## Then

Commit both files: `docs: requirements and quality standard`. Do not design, do
not scaffold, do not write code in this turn.

## Output

A short summary, then a single fenced `json` block, nothing after it:

```json
{
  "requirements": [ { "id": "R1", "text": "one sentence", "check": "command or request and expected result" } ],
  "workflows": [ { "id": "W1", "title": "...", "requirements": ["R1", "R3"], "steps": ["..."] } ],
  "coverage": { "M1": ["R1"] },
  "quality": { "bar": { "test": "..." }, "start": { "command": "...", "probe": {} } },
  "job_kind": "build | change | repair | maintain",
  "non_goals": ["..."],
  "decisions": ["ambiguity and the decision"]
}
```
