# Architect–Crew–Gate: the theory

*Point an AI at this file and give it a job. This file is enough to act on. The
full specification is `PATTERN.md`; the evidence is `ARTICLE.md`.*

---

## The claim

Software built by AI is only as good as the point at which judgment enters the
process. Put judgment at the end, as a review of whatever got built, and you pay
for it twice: once in the model that did the building without it, once in the
rework. Put judgment at the beginning — as a written standard, a blueprint down
to the signatures, and the tests that define done — and the building itself
needs no judgment at all. It becomes typing. Typing is cheap. Typing can be
checked by machines.

That is the whole theory. Everything below is what follows from it.

## Five principles

**1. Define the standard before the design.**
Write down what "good" means — the commands that must pass, the rules the code
must follow, the rubric it will be scored on — before drawing anything. The
standard is not a review checklist applied afterwards; it is the contract every
later step is built to and judged by. If the crew was never told the bar, the
crew did not miss it.

**2. The blueprint removes judgment from the work.**
An architect names every file, every exported signature, every port and who
consumes it, every route and status code, and writes the tests that will define
done — red, before any implementation exists. What remains is "make these tests
pass by filling in these files." That is a unit of work a small, cheap, or local
model completes reliably, because nothing in it requires a decision.

**3. Nobody grades their own work.**
The crew's report of "done" is a claim, never a verdict. Done is decided in
order by: a gate that runs commands and reads exit codes; a quality analyst who
executes scripted scenarios black-box from a fresh clone, walking every
user workflow in a real browser; and a reviewer in a fresh session who was
told that every report is a claim. The model that wrote the code never
certifies the code. Tests prove the code; the browser proves the product.

**4. What can be checked mechanically is checked mechanically.**
Tests passing, lint passing, a clean clone starting, no junk tracked, no test
or config edited to get green, a test suite that fails when the source is
deleted — none of these need a model. A gate that runs them after every turn
costs nothing and catches most of what a review would otherwise spend judgment
on. Save judgment for what only judgment can see.

**5. Every job is the same stages at a different size.**
A new product, a feature, a bug, an upgrade: each gets a requirements document,
a standard, a blueprint, tests-first tasks, a gate, QA, and a review. A repair
is one requirement whose check is the reproduction, one red test, one task, one
scenario, one review. The stages never shrink to zero; their contents do. A
gardening crew still needs to know which beds are which, what done looks like,
and who inspects.

## The shape

```
 job ─► ARCHITECT ─► BLUEPRINT ─► CREW ×N ─► GATE ─► QA ─► REVIEW ─► done
        (judgment)   (judgment    (typing,    (no     (script, (judgment,
                      written      cheap)      model)   cheap)   fresh eyes)
                      down)
```

| Role | What it does | Model tier | Turns |
| --- | --- | --- | --- |
| Architect | writes `REQUIREMENTS.md`, `QUALITY.md`, `DESIGN.md`, the red tests, the stubs, `TASKS.md`, `QA.md` | the best you have | 2–3 |
| Crew | one task per turn: make its tests pass inside its files | the cheapest that can edit files and run a shell | one per task |
| Gate | runs the standard's commands after every crew turn; feeds failures back | none | free |
| QA analyst | executes `QA.md` from a fresh clone, reports evidence | cheap | 1 |
| Reviewer | fresh session, read-only, hunts what gates cannot see, emits findings with a check command each | the best you have | 1 |

## The ownership rule

The crew may write only the files its task names. It may never modify a test,
a lint or type config, a task-runner script, or any of the five architect
documents. Creating a new test for new behaviour is fine; going back to change
one to get green is the failure mode this whole pattern exists to prevent, and
the gate detects it. A crew that thinks a test is wrong says so and stops.

## What the numbers say

On the same idea, same day, same prompts: an all-frontier build cost $6.65 of
plan usage and a blind review scored it 29/35. An unguarded frontier-plans,
local-types build cost $0.40 and scored 19/35 — functionally equal, but with a
stub test that asserted nothing, a lint rule bent around one variable, tool
junk committed, and a start command that failed from a clean clone. Every one of
those is a case of the crew grading its own work. The gate alone catches all of
them. The blueprint and the review are for what it cannot.

The literature agrees from three directions: planner quality dominates outcome
and weak executors are fixed by better plans, not better executors (PEAR,
ADaPT); a strong model describing the solution and a cheap model applying it
beat either alone (aider's architect/editor); an up-front interface blueprint
with file-exclusive tasks beat sequential building by double digits (Co-Coder).

---

## If you are an AI reading this

You have been given this file and a job. Act as follows.

1. **Name the job kind** — build, change, repair, or maintain — and say it first.
2. **Be the architect first.** Before any code: write `REQUIREMENTS.md`
   (problem, users, acceptance criteria with stable ids and a runnable check
   each, the workflows a user will walk with each step naming the requirement
   it exercises, a coverage line per must-have of the job, non-goals,
   decisions) and `QUALITY.md` (the commands that must pass, the code rules,
   the test rules, the rubric). If the job has a page, every user-facing flow
   is a requirement whose check is a browser sequence, not a request. In an existing repo, discover the
   commands from what already runs; never invent them. For a repair, reproduce
   the defect before writing a word; the reproduction is the first check.
3. **Then draw the blueprint.** `DESIGN.md` with every file, every exported
   signature and its error behaviour, ports per consumer, wiring by injection,
   the data model, the API or CLI contract. Write the tests — one per
   requirement, importing the real modules — and commit them red. Stub every
   new file with `not implemented`. Write `TASKS.md`: ordered tasks, each naming
   the only files it may write, the tests it must turn green, the commands to
   run. Write `QA.md`: one black-box scenario per requirement. Check that every
   requirement has a test, a task, and a scenario.
4. **If you are also the crew** (no second model available): do one task at a
   time, in a new context if you can. Read only the task and the design sections
   it names. Red, green, refactor, inside the named files. Run the commands.
   Commit with the task id. Do not touch tests, config, or other files. Report
   what you did as a claim.
5. **Run the gate yourself** after each task: the quality-bar commands; `git
   diff --name-status` to confirm you stayed inside the task's files and
   modified no test or config; `git ls-files` to confirm no junk. On any
   failure, fix the cause, never the check.
6. **At the end, be QA**: from a fresh clone, execute every `QA.md` scenario
   exactly, record evidence, report pass/fail per requirement. Walk every
   workflow start to finish; if the job has a page, do the page steps in a
   real browser (Playwright, or any browser tool you have) and quote what it
   showed, never what a request returned.
7. **Then be the reviewer, in a new session if at all possible.** Treat every
   earlier report as a claim. Hunt import-time side effects, tests that assert
   nothing, half-done escaping, contract breaks, undocumented steps, fat
   interfaces, requirement drift. Report only what you confirmed at a file and
   line, each with a fix and a check command. Never propose weakening a test.
8. **Stop when a stage's exit rule is not met**, and say which. A blueprint
   with an untested requirement stops before any task. A task that fails the
   gate after retries stops. A review with high findings whose checks do not
   pass stops. Stopping early is cheaper than certifying wrong.

If a human is orchestrating you across two models, they will give you one role
at a time; play only that role, and treat every other role's output exactly as
the rules above say to.

---

## If you are a person using this

- Hand this file and the job to your strongest model and say: "Be the
  architect." Commit what it produces.
- Hand each task block from `TASKS.md` to the cheapest model that can edit
  files, with the matching `DESIGN.md` sections. Run the gate commands between
  tasks; reject anything that touched a test or config.
- Hand `QA.md` and a fresh clone to any model and say: "Execute these exactly."
- Open a **new** conversation with your strongest model, give it this file, the
  diff, and the QA report, and say: "Be the reviewer."
- The prompts for each of these turns are in `prompts/`; the fill-in artifacts
  are in `templates/`; the mechanics are in `PATTERN.md`.

The pattern degrades gracefully. With no orchestrator, no second model, and no
gate code, a person following the eight steps above with one chat window still
gets every quality property except the automatic retries.
