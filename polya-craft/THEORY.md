# polya-craft: the theory

*Point an AI at this file and give it a problem. This file is enough to act on.
The specification is `PATTERN.md`; the by-hand walk is `WALKTHROUGH.md`; the
worked examples are there and in `examples/`.*

---

## The claim

A problem is solved when a stranger can check that it is. Everything that
needs judgment happens before anything is built: saying what the problem is
in your own words, writing the check that will decide done, and breaking the
work into units that a stranger could carry out without asking a question.
After that, building needs no judgment. It is carrying out. Carrying out is
cheap, and it can be checked by things that cannot be argued with.

Then the step everyone skips: look back. Not to admire the result, but to
write down what would have made this problem cheaper, where the next problem
will read it before it starts.

That is George Pólya's *How to Solve It* (1945), four steps, with two things
added that he did not need: a price on judgment, and a ledger.

## Two prices

Judgment is expensive. The model that can restate a problem, see what done
looks like, and plan units a stranger can execute is the best you have, and
it should do only that. Carrying out is cheap. A small or local model with no
memory, given one unit with every choice already made, completes it
reliably, because nothing in it requires a decision. Put the expensive thing
where judgment is needed and nowhere else. Put the cheap thing everywhere
else. Put no model at all wherever a command and an exit code will do.

## The four moves

**1. Understand.** Write down what is given, what is sought, and how they are
connected. Restate the problem in your own words; if you cannot, you do not
understand it yet. End with the done-checks: `D1..Dn`, each a statement plus
a check a stranger can run plus whether it is met today. `D1` is always the
answer *in use*: the family sleeping in the house, the route answering 404
under `curl`, a reviewer scoring the proposal. Not one line of plan.

**2. Devise.** Name the approach, and the related problem it borrows from.
Give the answer a shape: levels, each with its own check, so the whole is
assembled upward from parts that were each checked. Write the outer test, the
walk a stranger takes through the finished thing. Then the units: each one a
packet a stranger could carry out alone. A plan is judged by one question,
asked of every unit: *could a stranger do this without asking?*

**3. Carry out.** One unit per turn, in a fresh session, the packet and
nothing else. The unit's check decides done, never the one who did the work.
A Hand that must decide something stops and says so. That is not a failure
of the Hand; it is a unit that was not workable, and it goes back to the
plan.

**4. Look back.** First the checks, from a clean state, every one. Then a
stranger walks the outer test. Then fresh eyes ask Pólya's questions: does
it answer the problem as restated, can it be checked another way, what does
only judgment see. Then write the lessons into the ledger, where the next
Understand will read them.

## The workable-unit contract

```
## U<n>: <verb + deliverable>
Serves:   D<ids>                     which done-checks this unit moves
Level:    L1:<group>                 which part of the shape it belongs to
Produces: one deliverable, by location
Given:    every input, by owning location or verbatim; nothing else is read
Do:       ≤7 imperative steps, every choice already made
Touches:  the complete set the Hand may change
Check:    decided without the Hand; unmet now; outside Touches
Depends:  U<ids> | none
Not:      what to leave alone
```

**The stranger test.** Hand the block, alone, to someone with no context, no
memory, and no permission to decide.

| | Ask | If no |
| --- | --- | --- |
| Start | Can they begin without a question? | `Given` is incomplete |
| Same | Would two strangers both pass `Check`? | a choice is still open; make it in the plan |
| Decide | Is `Check` outside `Touches` and unmet today? | the Hand could satisfy it by editing it |
| Sitting | One deliverable, one turn? | split |

The words *choose, decide, appropriate, as needed, best, etc.* in `Do` are
each a decision left for the Hand. Each one fails the test.

## The shape

```
 problem ─► UNDERSTAND ─► DEVISE ─► CARRY OUT ×units ─► LOOK BACK ─► answer
 + ledger    (Solver)     (Solver)   (Hand, fresh      (checks: none
                                      session each;    verifier: cheap
                                      check after      reviewer: Solver, fresh)
                                      each: no model)         │
                                                               ▼
                                                            ledger'
```

| Role | Does | Model | Turns |
| --- | --- | --- | --- |
| Solver | Understand, Devise, Look back (c) | the best you have | 3 |
| Hand | one unit per turn | the cheapest that can do the work | one per unit |
| Checks | run every Check and done-check | none | free |
| Verifier | walks the outer test as a stranger | cheap, fresh, read-only | 1, optional |

Four roles, two models. The third ingredient is a fresh session, and it
costs nothing.

## Four rules

1. **Done is decided by the check, never by whoever did the work.** A report
   is a claim. The check is the verdict. Editing a check to pass it is the
   failure this pattern exists to prevent.
2. **Every choice is made before the Hand sees the unit.** A question from
   the Hand is evidence about the plan, and the most valuable output of a
   run.
3. **Every fact has one owner, and the check reads it.** When two documents
   hold the same fact, they will disagree, and the Hand will build to the
   wrong one. The plan names the owning source; the packet is assembled from
   it when the unit runs, not copied when the plan was written.
4. **Done-checks never move down.** A big problem splits into sub-problems,
   each with its own plan and its own look back. The done-checks stay in the
   one problem statement, and every sub-plan says which of them it carries.
   A check that crosses a seam is lost unless a seam owns it.

## Sizes

A one-line repair is one page: done-checks above the plan, one unit, a
paragraph of look back. A feature is three files. A product, or a house, is
a split into sub-problems along the lines where checks already exist:
inspections, milestones, releases. When a check already exists, adopt it as
the level check; never write a parallel one. The stages never shrink to zero.
Their contents do.

---

## If you are an AI reading this

You have been given a problem and this file. Do this, in order:

1. Ask which of two roles you are. If you are the **Hand**, skip to step 8.
2. Read the ledger (`LESSONS.md`, or whatever you were given) for entries
   whose tags match the problem's kind and domain. You will cite each one.
3. **Understand.** Write `PROBLEM.md` per `templates/PROBLEM.md`: Given,
   Unknown, Condition, Restated in your own words, done-checks `D1..Dn`
   each with a Check and `Now: unmet|met`, Not-this, Lessons consulted with
   a disposition for each. `D1` is the answer in use. Write no plan. If the
   problem is too big for eight units, add the split table: sub-problems,
   the existing check that bounds each, the D ids each carries.
4. **Devise.** Write `PLAN.md` per `templates/PLAN.md`: Approach, Shape with
   a check per level (adopt existing ones), Outer test, Units in the
   contract above, Order, Trace. Run the stranger test on every unit
   yourself before you hand the plan over; fix what fails. Every Check must
   be unmet now. For software, write the red tests and stubs now.
5. Hand each unit, in Order, to a fresh Hand session: the unit block, the
   Restated paragraph, the D lines it serves. Nothing else.
6. After each unit, run its Check. Pass: next. Fail: hand the failing line
   back, at most twice. A question from the Hand: re-plan that unit, and
   write the question as a candidate lesson.
7. **Look back.** Re-run every Check and every D from a clean state. Have a
   stranger walk the outer test. In a fresh session, answer: does it solve
   the restated problem, how else could it be checked, what does only
   judgment see, with a check for each finding. Write `LOOKBACK.md` and
   append lessons to the ledger. "No lesson" is an entry.
8. **If you are the Hand:** you have one unit. Read only `Given`. Do only
   `Do`. Change only `Touches`. Run `Check`. Report what you did as a claim.
   If anything requires a decision, stop and say what the question is. Do
   not edit a check, a test, or a plan. Do not guess.

## If you are a person using this

Read `WALKTHROUGH.md`. It is the same eight steps with two chat windows and
a terminal, worked on a grant proposal and a bug. `examples/house.md` is a
house. Your job in the loop is small and specific: the three questions after
Understand, the stranger test after Devise, running the checks, and reading
the look back. Nothing else needs you.
