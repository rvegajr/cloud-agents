# Build an app from an idea: phase 1, specification

You are the first turn of an unattended pipeline that will build a complete
application from the idea below. You will be called again, many times, with the
instruction "do the next milestone". Everything those later turns know about the
product comes from the two files you write now. Write them for a capable engineer
who has never heard the idea.

## The idea

{{idea}}

## Constraints from the operator

- Repository: `{{repo}}`. It may be empty apart from a README, or contain a
  scaffold. Check before assuming.
- Prefer boring, widely known technology with a small dependency footprint. Pick
  the stack that gets a working product fastest with strong tooling for tests.
  State the choice and one sentence of why. Do not ask; decide.
- The product must be runnable end to end from a fresh clone with documented
  commands. If it needs a database, default to SQLite or an in-memory store.
- The operator's machine may run a newer Node (or language runtime) than this VM.
  Prefer pure-JS packages or Node built-ins (e.g. `node:sqlite` on Node 22+)
  over native addons. If you must use a native addon, pin its **latest major**
  so prebuilt binaries exist for current releases, and declare `engines` in
  `package.json`.
- No external paid services, no accounts to create, no secrets required to run
  locally. If the idea implies one (e.g. "send email"), stub it behind an
  interface and note it in Non-goals for v1.

## What to write

### `SPEC.md`
1. **Summary**: what it is, who uses it, in three sentences.
2. **Core user flows**: numbered, each one sentence, in priority order.
3. **Non-goals for v1**: explicit list. This is the most important section for
   keeping later turns from wandering.
4. **Stack**: language, framework, storage, test runner, and why.
5. **Architecture**: directory layout, main modules, how data flows. Short.
6. **Data model**: entities and fields.
7. **Quality bar**: the commands that must pass before any milestone is done
   (install, lint, typecheck, test, build). These are fixed for the whole project.

### `ROADMAP.md`
A list of milestones, at most {{max_milestones}}, each in this exact form:

```
## M1: Walking skeleton
Status: [ ] todo
Goal: one sentence.
Acceptance:
- [ ] `npm test` passes with at least one real test
- [ ] `npm run dev` starts and `GET /` returns 200
Notes:
```

Rules for milestones:
- **M1 is always the walking skeleton**: project scaffold, tooling (lint, test,
  typecheck), one trivial end-to-end path, run instructions in README. Nothing
  else. It proves the pipeline works before features begin.
- Every acceptance item must be checkable by running a command or opening a
  specific URL/file. "Works well" is not acceptance.
- Each milestone should be finishable in one focused session. Split if not.
- Order by dependency, then by user value.
- The last milestone is always "Polish and release readiness": README complete,
  error states handled, fresh-clone verification.

## Then

Commit both files with message `docs: add SPEC.md and ROADMAP.md`. Do not start
implementing M1 in this turn.

## Output

Finish with a short summary, then a single fenced `json` block:

```json
{
  "stack": "one line",
  "milestones": [{ "id": "M1", "title": "Walking skeleton" }],
  "open_questions_decided": ["any ambiguity in the idea and how you resolved it"]
}
```
