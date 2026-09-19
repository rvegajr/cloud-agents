# polya-craft

## A problem-solving pattern for any problem, where a strong model understands and plans, a cheap model carries out, checks decide done, and a ledger makes the next problem cheaper

This is the specification. `THEORY.md` beside it is the two-page version an
AI can act on; `WALKTHROUGH.md` is the by-hand version for a person;
`examples/house.md` is the longest worked example. Section 9 says how to run
it with this kit. Nothing else here depends on the kit.

The pattern is George Pólya's four steps (*How to Solve It*, 1945), with a
price on judgment, a contract for what a unit of work must contain, and a
ledger. It is deliberately a fresh loop beside `../architect-crew-gate/`; it
borrows that pattern's mechanical gate and repo I/O as utilities and nothing
else. Section 7 maps the two.

---

## 0. The pattern on one page

```
  a problem: repair · change · build · answer
        │  + ledger entries whose tags match
        ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ 1  UNDERSTAND                      Solver (strong)          1 turn       │
  │    PROBLEM.md: Given · Unknown · Condition · Restated · D1..Dn · Not     │
  │    (split table if > 8 units)                                            │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ 2  DEVISE                          Solver (strong)          1–2 turns    │
  │    PLAN.md: Approach · Shape (check per level) · Outer test · Units ·    │
  │    Order · Trace                   plan-lint (no model)     free         │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ 3  CARRY OUT, one unit per turn    Hand (cheap/local)       N turns      │
  │    the packet only; fresh session each                                   │
  │       └─► unit Check after every turn   (no model)          free         │
  │           fail → the failing line back → retry ≤ 2                       │
  │           question → stop: unit-not-workable → back to 2                 │
  │       └─► level check when a group completes                             │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ 4  LOOK BACK                                                             │
  │    (a) every Check and every D, from a clean state   (no model)   free   │
  │    (b) a stranger walks the outer test               Verifier (cheap)    │
  │    (c) Pólya's questions; findings with checks       Solver, fresh       │
  │    (d) LOOKBACK.md; ledger entries appended          (no model)          │
  └──────────────────────────────────────────────────────────────────────────┘
        │
        ▼
  the answer · LOOKBACK.md · LESSONS.md' · cost lines
```

Four rules; everything else is detail.

1. **Done is decided by the check, never by whoever did the work.**
2. **Every choice is made before the Hand sees the unit.**
3. **Every fact has one owner, and the check reads it.**
4. **Done-checks never move down.**

## 1. Roles

| Role | What it does | Tier | Why that tier |
| --- | --- | --- | --- |
| **Solver** | Understand; Devise; Look back (c) | the strongest available | these are the only steps that need judgment |
| **Hand** | one unit per turn, from the packet alone | the cheapest that can do the work; a person for a house | with every choice made, the work is carrying out |
| **Checks** | run every Check, level check, done-check | none | commands, counts, checklists, inspections |
| **Verifier** | walks the outer test as a stranger | cheap, fresh session, read-only | being a stranger is what matters, not being smart |

Four roles, two model tiers. A **fresh session** is the third ingredient:
the Hand has no memory of the last unit, the Verifier has never seen the work,
the Solver reviewing in (c) is not the Solver that planned. It costs nothing
and it is what makes rule 1 hold.

The Hand may be a person. `examples/house.md` uses a framing crew. Nothing in
the contract changes.

### 1a. Problem kinds and sizes

The stages never change. Their contents do.

| | repair | change | build | answer |
| --- | --- | --- | --- | --- |
| **What** | a defect | new or altered behaviour in something that exists | a new thing | a document, a decision, a migration, a research result |
| **D1** | the reproduction: unmet today, met after | the new behaviour in use | the thing in use by its first user | the deliverable in the hands of its reader or user |
| **Other Ds** | the invariant: what must not change, `Now: met` | only what changes | as many as the must-haves, ≤ 8 | the reader's rubric, the format rules, the totals |
| **Units** | one is correct | few | up to 8 per plan, split above | by section, batch, or decision |
| **Verifier** | skipped when the outer test is D1 and (a) ran it | walks the changed workflow | walks every workflow | scores against the rubric |

| Size | Units | Files | Solver turns |
| --- | --- | --- | --- |
| **S** | ≤ 3 | `ONE-PAGE.md`: the three artifacts as headings on one page | Understand and Devise may share one turn, done-checks above the plan |
| **M** | 4–8 | `PROBLEM.md`, `PLAN.md`, `LOOKBACK.md` | 2 + (c) |
| **L** | > 8 | one `PROBLEM.md` with a split table; one `PLAN.md` and one `LOOKBACK.md` per sub-problem; a final look back | 1 + 2 per sub-problem + (c) each |

Split along the lines where checks already exist: inspections, milestones,
releases, chapters. Those become the sub-problems' level checks (rule 3 of
section 3).

## 2. Artifacts

Three per problem, one persistent. Each has a human part and, at the end, a
fenced `json` block a script can read. The templates are in `templates/`.

### 2.1 `PROBLEM.md` — Understand

```markdown
# Problem: <one line, in the Solver's words, not the requester's>
Kind: repair | change | build | answer
Size: S | M | L

## Given          what exists: sources, data, constraints, the repo, the current state — each by its owning location
## Unknown        what is sought: the exact form of the deliverable
## Condition      how Given and Unknown connect: the rules the answer must obey
## Restated       two to five sentences in the Solver's words; names what "wrong" looks like and what the requester will judge it by
## Done-check     D<n>: <statement> — Check: <what a stranger runs or compares> — Now: unmet | met
## Not this       explicit non-goals
## Lessons consulted   L-<id>: applied as … | not applicable because …
## Split          (L only) sub-problem · bounding check · D ids carried
## Quality bar    (software only) purpose → shell: install, test, lint, typecheck, start

```json problem
{ "kind": "build", "size": "M",
  "done": [ { "id": "D1", "text": "...", "check": "...", "outer": true, "now": "unmet" } ],
  "lessons": [ { "id": "L-...", "applied": true, "how": "..." } ],
  "split": [ { "name": "P1", "bound": "footing inspection", "done": ["D2","D3"] } ],
  "bar": { "install": "npm ci", "test": "npm test" } }
```
```

Rules the stage enforces:

- `D1` is the answer in use. "The document is well written" is not a
  done-check; "a reader holding the rubric scores it ≥ 4" is.
- Every D has a Check a stranger can run with the documents named in Given.
- Every D is `unmet` today, or it is a Given kept as an invariant and says so.
- At most eight Ds. More means the problem is not yet understood, or is L.
- No plan text. A sentence beginning "first we will" is deleted.
- Every ledger entry offered is listed with a disposition. Silence is not a
  disposition.
- Every Given that can change (a schedule, a spec, a version, a drawing)
  names its owner and, when the owner is outside your control, its revision.

### 2.2 `PLAN.md` — Devise

```markdown
# Plan for: <PROBLEM title>            (for L: "<title> — <sub-problem>")

## Approach      the method, and the related problem it borrows from; what is deliberately not attempted
## Shape         the answer by level, a check at each:
                 L2 whole   — check: <the outer test passes>
                 L1 groups  — <group>: check: <adopted or written>
                 L0 units   — below
## Outer test    numbered steps a stranger walks through the finished thing; each names the D it exercises
## Units         U1..Un in the contract (section 3)
## Order         dependency order; which units may run side by side (disjoint Touches)
## Trace         D → units → outer-test steps. For L: which Ds this sub-plan carries, from the split table
## Still open    (L only, filled at look back) Ds not yet met and the future units that carry them

```json plan
{ "levels": [ { "id": "L1:walls", "check": "..." } ],
  "units": [ { "id": "U1", "title": "...", "serves": ["D1"], "level": "L1:walls",
               "produces": "...", "touches": ["..."], "check": "...", "depends": [] } ],
  "outer": [ { "step": 1, "d": "D1" } ],
  "trace": { "D1": ["U1"] } }
```
```

Rules the stage enforces (the mechanical half is `plan-lint`, section 6):

- Every D this plan carries maps to at least one unit and at least one
  outer-test step.
- Every unit passes the contract's mechanical checks (section 3).
- Every unit Check is unmet before the unit runs. For software: the red tests
  are written in this stage, and the suite must not be green.
- Touches are disjoint across units marked parallel.
- When a check already exists (an inspection, a CI job, a rubric), it is the
  level check verbatim, and the plan names the units that close it and the
  internal pre-check that predicts it. No parallel check is written.
- `PROBLEM.md` is unchanged since it was accepted.

### 2.3 `LOOKBACK.md` — Look back

```markdown
# Look back: <PROBLEM title>

## Result        D by D: met | unmet, with the evidence line from (a) and (b)
## Judgment      does it answer the restated problem; another way to check it; findings (where, what, fix, check)
## What worked   two to five lines, tied to a unit or a level
## What did not  every retry, escalation, or question: unit id, cause, what would have prevented it
## Still open    (L) Ds not yet met, the sub-problem and units that carry them; the next draft plan read against this list
## Lessons       0..n entries in ledger format (section 5), or "No lesson: <why>"
## Reusable      what here (method, unit, check) applies to another problem

```json lookback
{ "verdict": "done" | "fix" | "stop",
  "results": [ { "id": "D1", "met": true, "evidence": "..." } ],
  "findings": [ { "severity": "high", "where": "...", "what": "...", "fix": "...", "check": "..." } ],
  "lessons": [ { "id": "L-...", "tags": [...], "when": "...", "lesson": "...", "evidence": "..." } ],
  "confirmed": ["L-..."] }
```
```

### 2.4 `ONE-PAGE.md` — S problems

The three artifacts as three headings on one page, done-checks above the
plan. One Solver turn may write the first two headings. See
`WALKTHROUGH.md` section 6.

### 2.5 The ledger `LESSONS.md`

Persistent, append-only, outside any problem folder. Section 5.

## 3. The workable-unit contract

A unit is the packet a Hand receives. The fields are the same for a file, a
paragraph, a batch of rows, a wall, or a decision to record.

```
## U<n>: <verb + deliverable>
Serves:   D<ids>
Level:    L1:<group>
Produces: the one deliverable, by location (path, section heading, row range, grid line)
Given:    every input, by owning location or pasted verbatim; the Hand reads nothing else
Do:       ≤7 imperative steps, every choice already made
Touches:  the complete set the Hand may change, and nothing else
Check:    how done is decided without the Hand: a command with expected output, a comparison,
          or a yes/no checklist two strangers score the same; unmet now; outside Touches
Depends:  U<ids> | none
Not:      what this unit must leave alone
```

### 3.1 The stranger test

Hand the block alone to someone with no context, no memory, and no permission
to decide.

| | Ask | If no |
| --- | --- | --- |
| **Start** | Can they begin without asking a question? | Given is incomplete |
| **Same** | Would two strangers produce results that both pass Check? | a choice is still open; the Solver makes it now, in the unit |
| **Decide** | Is Check outside Touches, external to the Hand, and unmet today? | the Hand could satisfy it by editing it; move it |
| **Sitting** | One deliverable, Do ≤ 7, fits in one turn and one context? | split |

Any no: split the unit, or move the decision up into `PLAN.md`.

The mechanical half (`plan-lint`): every field present; `Produces` is one
thing; `Touches` non-empty and containing no Check, test, or plan artifact;
`Check` is not prose when it can be a command, and when runnable it is run
and expected to fail; `Do` contains none of *choose, decide, appropriate,
as needed, best, etc., or similar, something like*; Touches disjoint across
parallel units; every `Serves` id exists; every D is served. The judgment
half (Start, Same) is the Solver's, and Carry out audits it: a Hand that
stops to ask is proof the unit failed.

### 3.2 One owner per fact

`Given` names where each input lives, and that location is the fact's owner.
When the same fact appears in two places (a drawing and a schedule; a README
and a config; a spec and a test fixture), the plan names which one owns it,
and `Check` reads the owner. The packet is assembled from the owner when the
unit runs, not copied into the plan when the plan was written. Where the
owner is outside your control, `Given` carries its revision, and a change
in revision reopens every unit that cites it.

This rule came from a window that did not fit its opening
(`examples/house.md`, section 3).

### 3.3 Adopted checks

A check that already exists — a county inspection, a CI pipeline, a journal's
review criteria, a bank's draw conditions — is a level check, adopted
verbatim. The plan names which units close it and what internal check
predicts it (the walk with the checklist before the inspector arrives).
Writing a parallel check beside an adopted one is a plan defect: two checks
for one fact will disagree.

### 3.4 Assembly

Units are built at L0, each with its own Check. When every unit in an L1
group is done, the group's check runs before the next group starts. When
every group is done, the L2 check is the outer test. The whole is assembled
upward from parts each checked at its level. A failure at L1 that every L0
check passed is a plan defect at L1: the group's check was measuring the
wrong thing, or a unit was missing.

## 4. Stages

| Stage | Owner | Entry | Exit | Stop reason if not |
| --- | --- | --- | --- | --- |
| **Understand** | Solver, 1 turn | the problem as given + matching ledger entries | `PROBLEM.md` per 2.1, all rules | `understanding-incomplete` after one targeted retry |
| **Devise** | Solver, 1–2 turns; then plan-lint | `PROBLEM.md` accepted | `PLAN.md` per 2.2; every unit passes 3.1; every Check unmet | `plan-not-workable` after one targeted retry |
| **Carry out** | Hand, fresh session per unit; Check after each | one packet: unit block + Restated + its D lines (+ current red output for software) | all unit and level checks pass; only Touches changed; no Check, test, or artifact edited | `unit-gate-failed` after 2 retries; `unit-not-workable` on a question |
| **Look back (a)** | none | Carry out exited | every D and every Check re-run from a clean state (fresh clone, fresh export, fresh walk); ownership audit; trace re-check | `finish-check-failed` after one fix turn |
| **Look back (b)** | Verifier, fresh, read-only | (a) passed | outer test walked step by step with evidence; skipped when the outer test is D1 and (a) ran it | `verify-failed` after one fix turn and one re-walk |
| **Look back (c)** | Solver, fresh session, read-only | (a), (b) passed; reports attached as claims | Pólya's questions answered; findings each with a check; lessons drafted | `review-unresolved` after one fix turn |
| **Look back (d)** | none | always, even after a stop | `LOOKBACK.md` written and committed; ledger appended; consulted lessons promoted or retired | — |

**Fix turns** are ordinary Carry out turns with a synthesised unit `U-FIX`:
Produces the fix, Touches the files the finding names, Check is the
finding's own check. Same rules, same gate.

**Resume** restarts at the stage that stopped. `unit-not-workable` restarts
at Devise for that unit only; the rest of the plan stands.

## 5. The ledger

`LESSONS.md` is one append-only file outside any problem. Two are read
together when both exist: the one beside this pattern (process lessons and
cross-project domain lessons) and one in the target repo or project folder
(`.polya/LESSONS.md`, lessons about that codebase or that site).

```
## L-<yyyy-mm-dd>-<nn>
Tags:     kind:<repair|change|build|answer> domain:<…> stage:<understand|devise|carry-out|look-back> <any:tag>
When:     the problem looks like … (in Understand's words: Given / Unknown / Condition)
Lesson:   one imperative sentence
Evidence: <problem title>, what happened, which unit or D
Status:   candidate | confirmed(n) | retired
```

**Selection.** Understand receives the entries whose tags intersect the
problem's kind plus any domain tags supplied by the requester or found
mechanically (repo name, file extensions, words in the statement). Under
forty active entries, all of them.

**Disposition.** `PROBLEM.md` lists every entry received with *applied as …*
or *not applicable because …*. A lesson cannot be silently ignored.

**Promotion.** At Look back (c): a consulted lesson that helped →
`confirmed(n+1)`. Consulted three times and never applicable → `retired`.
A new lesson enters as `candidate`. "No lesson: the plan held" is an entry
and is written.

**Two sources feed entries without the Solver.** A Hand question during
Carry out drafts a candidate ("U3 was not workable: …"). A Verifier failure
drafts one naming the outer-test step.

**Lint.** Format; unique ids; active entries ≤ 50, above which the oldest
candidates are retired first.

## 6. Mechanical checks

Everything in this section runs without a model.

| Check | When | Borrowed from |
| --- | --- | --- |
| **plan-lint**: the mechanical half of 3.1; the trace; Touches disjointness; Check runnable and red | after Devise | polya-craft (`src/plan.ts`) |
| **unit gate**: only Touches changed since the unit's base; the unit's Check and every passed unit's Check; no test, lint, config, or artifact edited; junk not tracked | after every Carry out turn | `../architect-crew-gate/src/quality-gate.ts` |
| **level check** | when a group completes | the plan's Shape |
| **finish check**: clean clone starts; hygiene; the suite fails when the source is deleted; ownership over the whole job; trace | Look back (a) | the same gate, finish profile |
| **done-checks that are commands** | Look back (a), in a fresh clone | polya-craft |
| **ledger lint** | Look back (d) | polya-craft (`src/lessons.ts`) |

For a non-software problem the same checks are a person with a checklist,
and the walk-through says so at each step.

## 7. Beside architect-crew-gate

| ACG stage | polya-craft | What is different |
| --- | --- | --- |
| 0 Requirements + Standard (`REQUIREMENTS.md`, `QUALITY.md`) | Understand → `PROBLEM.md` | one artifact; Given / Unknown / Condition and a restatement come before the acceptance list; the standard collapses into done-checks plus a quality-bar table; the ledger is consulted with a disposition |
| 1 Blueprint (`DESIGN.md`, tests, stubs, `TASKS.md`, `QA.md`) | Devise → `PLAN.md` | one artifact; units are judged by the stranger test, not by file lists; Shape has a check per level; the outer test sits beside the units; checks that exist are adopted |
| 2 Crew + gate | Carry out + unit check | same shape; packet is domain-neutral; a Hand's question is a plan defect that becomes a lesson, not a retry |
| 3 Finish gate | Look back (a) | borrowed for software; defined as "clean state, re-run everything" elsewhere |
| 4 QA | Look back (b) | same; skippable when the outer test is D1 |
| 5 Review | Look back (c) | judgment as in ACG, plus reflection and the write-back |
| — | `LESSONS.md` → next Understand | new |

Borrowed unchanged: the gate and the repo I/O. polya-craft never edits ACG.
If the four stages prove better, ACG's loop is the one to retire.

## 8. Failure modes

| Symptom | Cause | Prevention |
| --- | --- | --- |
| the Hand asks a question | a unit failed Start or Same | stranger test at Devise; the question becomes a lesson |
| a Check passes before the unit runs | the Check measures nothing | every runnable Check is run at Devise and must fail |
| the Hand edits a test or a check | it graded its own work | ownership gate; Check outside Touches |
| a D is met by (a) but (c) says the problem is not solved | the done-checks were wrong | the most expensive lesson; write it first, tag `stage:understand` |
| the outer test passes and a user still cannot use it | D1 was a property, not use | D1 must name a stranger doing the thing |
| two sources disagree and the Hand built to the wrong one | no owner named | 3.2 |
| a D crosses sub-problems and nobody built it | the D moved down or was not traced | 2.2 Trace; Still open at every sub-look-back |
| more than eight units and the Hand's context fails | L treated as M | the split table |
| the same defect appears on the next problem | the ledger was not read, or not written | disposition is mandatory; "no lesson" is an entry |
| a parallel check was written beside an existing one | 3.3 ignored | adopt; name the closing units |

## 9. Running it with this kit

The loop is `src/polya-loop.ts`; `ROADMAP.md` tracks what is and is not built.

```bash
npm run build-app -- --loop polya --engine hybrid --idea "<problem>" --repo <url>      # Max: Solver; local: Hand, Verifier
npm run build-app -- --loop polya --engine local  --idea-file ideas/x.md --create-repo my-app
npm run build-app -- --resume cc-…                                                    # restarts at the stage that stopped
npm run quality-review -- --job-file ideas/x.md <repo-url[@ref]>... --repeat 2         # ACG's blind scorer, unchanged
```

Env: `POLYA_LESSONS_FILE` (the ledger; default `polya-craft/LESSONS.md`),
`LOCAL_GATE*` (the borrowed gate), `HYBRID_QA_FALLBACK` (the Verifier's
fallback tier), `--max-units` (default 8).

## 10. Checklists

**After Understand** — D1 is use, not a property · every Check runnable by a
stranger · every D unmet or declared an invariant · ≤ 8 Ds · no plan text ·
every offered lesson has a disposition · changeable Givens name an owner.

**After Devise** — every D → unit → step · every unit: Start, Same, Decide,
Sitting · no forbidden words in Do · every Check unmet now · parallel units
disjoint · existing checks adopted, not duplicated · PROBLEM.md unchanged.

**Per Carry out turn** — fresh session · packet only · Check run by someone
other than the Hand · ≤ 2 retries · a question goes up, never answered down.

**Look back** — (a) from a clean state, everything · (b) a stranger, or
skipped with the reason written · (c) fresh session, read-only, findings
with checks · (d) LOOKBACK.md committed, ledger appended, consulted lessons
promoted or retired, "no lesson" written if so.
