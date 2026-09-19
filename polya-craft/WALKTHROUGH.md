# polya-craft by hand

*Two chat windows and a terminal. No kit code. If this page works for you,
the pattern works; the loop in `src/` only automates what you do here.*

You need:

- **A Solver.** The strongest model you have, in a chat window. It reads the
  problem, writes what done looks like, and plans the units. Three turns.
- **A Hand.** A cheap or local model that can be given a *fresh* session each
  time. It never sees the whole problem, only one unit. One turn per unit.
- **Checks.** A terminal for software. Your own eyes, a page count, a
  spreadsheet total, a checklist for anything else. No model.
- The prompts in `prompts/` and the templates in `templates/`. The ledger
  `LESSONS.md` beside this file.

The worked problem below is a grant proposal, on purpose. If the pattern only
worked for code it would be a build pipeline, not a way to solve problems.
Section 6 does the same walk for a one-line bug in fifteen lines.

---

## 0. Before you start: read the ledger

Open `LESSONS.md`. Find the entries whose tags match what you are about to do
(`kind:answer`, `domain:grants`, the funder's name). Copy them. They go into
the first prompt. If nothing matches, write `(no prior lessons)`.

Five minutes, and it is the only step people skip that they later regret.

## 1. Understand — Solver, one turn

Open the Solver. Paste `prompts/understand.md` with three things filled in:

| Slot | What you paste |
| --- | --- |
| `problem` | The problem as it was given to you, verbatim. The call text, the deadline, the page limit, where the prior results live. Do not tidy it. |
| `repo` | Where the materials are: a folder, a repo, a shared drive. For the grant: the folder with F's call, our figures F1–F3, table T1, the CVs. |
| `prior_lessons` | The ledger entries from step 0. |

The Solver writes `PROBLEM.md`. For the grant it looks like this (trimmed):

```markdown
# Problem: a proposal to F that scores ≥4/5 on every rubric criterion
Kind: answer
Size: M

## Given
- F's call text and scoring rubric (5 criteria), `call/F-2026.pdf`
- Page limit 12, margins per call §4
- Prior results: figures F1–F3 (`results/`), table T1 (`results/T1.xlsx`)
- Team CVs (`team/`), budget ceiling $240k over 2 years, deadline 2026-10-15

## Unknown
A submitted PDF plus attachments that a reviewer holding F's rubric scores
≥4 on each criterion.

## Condition
F's rubric and formatting rules bind. The budget must total the ceiling
exactly and sum across years.

## Restated
F funds work that shows X. Our evidence for X is F2; F1 and F3 support it.
The objection a reviewer will raise is Y, and T1 answers it. A proposal that
leads with the aims and buries the budget will lose on criterion 4.

## Done-check
- D1: a reader who is not us, given only F's rubric, scores every criterion ≥4
  — Check: a fresh cheap session scores the PDF blind against the rubric — Now: unmet
- D2: every criterion has a section that addresses it
  — Check: table criterion → section, every row filled — Now: unmet
- D3: ≤12 pages, margins per call §4
  — Check: page count and margins read from the PDF — Now: unmet
- D4: budget totals $240,000 and sums across years
  — Check: spreadsheet totals — Now: unmet
- D5: attachment list matches the call's checklist
  — Check: tick list against call §6 — Now: unmet

## Not this
Not a new experiment. Not a letter of intent. Not F's other programme.

## Lessons consulted
- L-2026-04-12-01 "F's reviewers penalise aims without a measurable endpoint"
  — applied: every aim will carry a numeric endpoint.
```

**Your job before moving on.** Read the done-checks only. Ask three questions:

1. Is `D1` the answer *in use*, not a property of the document? "A stranger
   scores it ≥4" is in use. "The proposal is well written" is not.
2. Could a stranger run every Check without asking you anything?
3. Is every Check `unmet` today? If one is already met, it is not a done-check,
   it is a given.

If any answer is no, say which D and why, and let the Solver revise once.
Do not let it write plan text into this file. Understanding ends here.

## 2. Devise — Solver, one turn

Same Solver session. Paste `prompts/devise.md` with `PROBLEM.md` whole, the
unit cap (`8`), and the list of D ids.

The Solver writes `PLAN.md`: an approach, the shape of the answer by level
with a check at each level, the outer test, and the units. Two units from the
grant plan:

```markdown
## U1: write the Specific Aims page
Serves:   D1 D2
Level:    L1:aims
Produces: `proposal/01-aims.md`, one page
Given:    the three aims verbatim from PROBLEM.md §Restated; figure F2 and
          its caption (`results/F2.png`, `results/F2.txt`); lesson L-2026-04-12-01
Do:       1. State aim 1 in one sentence ending with its numeric endpoint.
          2. State aim 2 the same way and cite F2 by name.
          3. State aim 3 the same way.
          4. Add one paragraph, ≤120 words, on why F should care, using the
             sentence "F funds work that shows X" from §Restated as the opener.
Touches:  `proposal/01-aims.md`
Check:    file exists; exactly three lines begin with "Aim"; each contains a
          number followed by a unit; "F2" appears; word count ≤ 500 — Now: unmet
Depends:  none
Not:      do not mention the budget; do not describe methods.

## U2: fill the budget table
Serves:   D4
Level:    L1:budget
Produces: `proposal/budget.xlsx`, sheet "Summary"
Given:    T1 (`results/T1.xlsx`), ceiling $240,000, two years, F's categories
          from call §5 (personnel, equipment, travel, other)
Do:       1. Copy the four categories as rows, years as columns.
          2. Personnel = T1 row 3 split 55/45 across years.
          3. Equipment = $18,000 in year 1 only.
          4. Travel = $6,000 per year.
          5. Other = whatever makes each year's column sum to $120,000.
Touches:  `proposal/budget.xlsx`
Check:    year columns each total $120,000; grand total $240,000; four rows — Now: unmet
Depends:  none
Not:      no justification text; that is U5.
```

**Your job before moving on: the stranger test.** For each unit, imagine
handing that block, alone, to someone with no context, no memory, and no
permission to decide anything. Four questions:

| | Question | If no |
| --- | --- | --- |
| **Start** | Can they begin without asking you anything? | `Given` is incomplete. Send it back. |
| **Same** | Would two strangers both pass `Check`? | A choice is still open. The Solver makes it now, in the unit, not the Hand later. |
| **Decide** | Is `Check` outside `Touches`, and unmet today? | The Hand could satisfy the check by editing it. Move it. |
| **Sitting** | One deliverable, `Do` ≤ 7 steps, fits in one turn? | Split the unit. |

Also scan `Do` for the words *choose, decide, appropriate, as needed, best,
etc.* Each one is a decision the Solver has left for the Hand. Send it back.

Then confirm every Check is unmet: for the grant, the files do not exist yet.
For software, run the red tests the Solver wrote and see them fail.

If more than one unit came back with a *no*, say so and let the Solver revise
the plan once. If the plan came back with more than eight units, ask it to
split the problem into two sub-problems, each with its own plan.

## 3. Carry out — Hand, one fresh session per unit

Take the units in the order `PLAN.md` gives. For each one:

1. **Open a new Hand session.** New, every time. The Hand must not remember
   the last unit.
2. Paste `prompts/carry-out.md` with the unit block verbatim, the `Restated`
   paragraph, and the D lines the unit serves. Nothing else from the plan.
   For software, also paste the current failing output of the unit's Check.
3. Take what it produces and put it where `Produces` says. For the grant,
   that is the file. For software, the Hand edits the files itself.
4. **Run the unit's Check yourself.** Count the aims. Open the spreadsheet.
   Run the test. The Hand's "done" is a claim; the Check is the verdict.
5. Pass → next unit. Fail → paste the failure back into the *same* session,
   once or twice. Still failing after two retries → stop; that is a plan
   defect, not a Hand defect (see section 5).

Units with no `Depends` on each other and disjoint `Touches` can run in
parallel: two Hand windows, or a friend.

When every unit in a level group is done (all of `L1:aims`, say), run the
group's check from `PLAN.md` §Shape before starting the next group. For the
grant, "the aims section reads end to end without a gap" is a group check.
For software, it is the integration test the Solver wrote for that module.

**If the Hand asks a question**, do not answer it. Copy the question, go back
to the Solver, and say: "U3 was not workable; the Hand asked: …". The Solver
re-plans that unit only. Write the question down as a candidate lesson; it
is the most valuable output of the whole run.

## 4. Look back

Four parts, in order. The first is free and catches most of it.

**(a) Checks, from a clean state.** Not from your working folder. A fresh
export of the PDF, a fresh clone of the repo. Run every D Check and every unit
Check again. For the grant: count the pages, open the budget, tick the
attachment list, fill the criterion → section table. For software, that is
`npm test` from a clean clone plus the start command. Write down what passed.

**(b) Verify, optional.** Open a *fresh* Hand session. Paste `prompts/verify.md`
with the outer test from `PLAN.md` and the results of (a). The Hand walks the
deliverable as a stranger, black-box, and reports per step with evidence.
For the grant, this is the blind rubric score, and it *is* D1. For a one-line
bug whose outer test is `curl … → 404` and you already ran it in (a), skip
this part.

**(c) Review, Solver, fresh session.** Open a *new* Solver window, not the
one that planned. Paste `prompts/look-back.md` with `PROBLEM.md`, the
deliverable (or its diff), the (a) and (b) results, and the `Lessons
consulted` list. Label the Hand's reports as claims. It answers Pólya's
questions in order:

- Does the result answer the *restated* problem, not the plan?
- Can the result be checked another way?
- What does only judgment see? Findings, each with how to check it.
- What worked, what did not, and which consulted lessons helped.

A high finding → one more Hand turn on the unit it names, then the finding's
own check decides. Do not let the reviewer fix it.

**(d) Write it down.** Fill `templates/LOOKBACK.md` from (a), (b), (c). Then
append the lessons to `LESSONS.md` in the ledger format. "No lesson: the plan
held" is a valid entry. A lesson you consulted that helped gets its
`confirmed` count raised. Commit `LOOKBACK.md` with the deliverable.

For the grant, the lesson that came out was: *"For F, reviewers read the budget
justification before the aims — lead with it."* That is now in the ledger
under `funder:F stage:plan`, and the next proposal to F reads it in step 0.

## 5. What to do when

| Situation | What it means | What to do |
| --- | --- | --- |
| The Hand asks a question | The unit failed the stranger test | Back to the Solver; re-plan that unit; candidate lesson |
| A unit's Check passes before the Hand ran | The Check does not measure the unit | Back to the Solver; a Check must be unmet first |
| The Solver writes plan steps inside `PROBLEM.md` | Understanding and planning got mixed | Delete them; understanding ends at the done-checks |
| More than eight units | The problem is two problems | Split; each half gets its own `PLAN.md`; the whole keeps one `PROBLEM.md` |
| The Hand edits a Check, a test, or a plan file | It graded its own work | Revert; the Hand may touch only `Touches` |
| (a) passes, (c) says it does not answer the problem | The done-checks were wrong, not the work | That is a lesson about Understand, the most expensive kind. Write it first |
| You cannot run a Check yourself | It is not a Check, it is an opinion | Rewrite it as something a stranger scores the same way you would |

## 6. The same walk for a one-line bug

Problem: `GET /nope` answers 200. Use `templates/ONE-PAGE.md`; one file.

1. **Ledger.** Grep for `kind:repair` and the repo name. One entry: "check the
   static handler after a middleware change".
2. **Understand + Devise, one Solver turn.** For a repair the Solver may write
   both halves in one turn, done-checks above the plan. It writes: Restated
   "the catch-all is registered before the not-found handler, so every miss
   falls through"; D1 (outer) `curl -s -o /dev/null -w '%{http_code}' :4571/nope`
   prints `404`, now unmet; D2 `npm test` exit 0, now met (so a given, kept as
   the invariant). Plan: U1, reorder the registration in `src/app.js`, Check
   `node --test test/notfound.test.js`, red now. It writes the red test.
3. **You check.** Run the test. It fails. Stranger test on U1: yes, yes, yes, yes.
4. **Carry out.** New Hand session, U1 packet plus the red output. It edits
   `src/app.js`. You run the Check. Green.
5. **Look back.** (a) Fresh clone, `npm test`, start it, `curl /nope` → 404,
   `curl /` still 200 (the ledger entry). (b) Skipped; the outer test is D1
   and you ran it. (c) Fresh Solver, one paragraph: answers the restated
   problem; another way to check is the access log. No findings.
   (d) `LOOKBACK.md` is four lines. Lesson: none, and say so.

Three model turns, one of them cheap. The paperwork was one page, and every
line of it was something you would have had to know anyway.

## 7. What this costs

| | Grant proposal (M) | One-line bug (S) |
| --- | --- | --- |
| Solver turns (strong) | 3: understand, devise, review | 2: understand+devise, review |
| Hand turns (cheap) | one per unit, 6–9, plus (b) | 1 |
| Your time | the stranger test, running the checks | five minutes |
| Fresh sessions | every Hand turn, (b), (c) | the Hand turn, (c) |

The strong model is never asked to type. The cheap model is never asked to
decide. Nobody grades their own work. That is the whole pattern; `THEORY.md`
says why and `PATTERN.md` says exactly.
