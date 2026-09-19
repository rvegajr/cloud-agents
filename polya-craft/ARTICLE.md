# polya-craft: where it comes from

## 1. The question

`../architect-crew-gate/` answered a narrow question: can a strong model
plan and a cheap model build software, with a gate between them, and score
within a few points of the strong model building alone? The measurement in
`../architect-crew-gate/ROADMAP.md` says yes, mostly.

polya-craft asks the wider one. Can a strong model and a cheap model solve
*any* problem together, not just build software, if all the judgment is
spent before anything is built and a ledger carries what was learned into
the next problem? A grant proposal, a one-line bug, a house. If the answer
is yes, the software pipeline was a special case of a problem-solving loop,
and the loop is the thing worth keeping.

The claim is in `THEORY.md`. The specification is `PATTERN.md`. This file
says where the pieces came from and why they were assembled again instead
of renamed.

## 2. The ancestors

**George Pólya, *How to Solve It* (1945).** Four steps: understand the
problem, devise a plan, carry out the plan, look back. Understand asks what
is given, what is sought, and how they are connected, and demands the
problem be restated in your own words. Devise asks for a related problem
you have solved before. Look back asks four questions: can the result be
checked, can it be derived differently, can the method be used for another
problem, and did you use everything given. polya-craft takes the four stages
whole, the Given / Unknown / Condition triple, the restatement, and the four
look-back questions as the reviewer's script. It leaves the assumption that
one person does all four steps. Here the steps are priced, and the cheap
ones go to a cheap model.

**The V-model.** Systems engineering draws design as a left arm descending
from requirements to units, and verification as a right arm ascending from
unit tests to acceptance. Every level on the left defines the check that
level will face on the right. Assembly goes upward, and nothing joins a
level until the level below passed. polya-craft takes the check-per-level
rule (the Shape in `PLAN.md`), assembly upward (`PATTERN.md` section 3.4),
and the rule that a failure at a level whose parts all passed is a defect in
that level's plan. It leaves the document weight and the idea that the
levels are fixed in advance for every project.

**Double-loop, outside-in TDD (Freeman and Pryce, *Growing Object-Oriented
Software, Guided by Tests*).** An outer acceptance test is written first and
stays red while an inner loop of unit tests turns green one at a time. Red
first, always: a test written after the code confirms what the code does,
not what it should do. polya-craft takes the outer test as a standing
artifact beside the units, the rule that every unit Check must be unmet
before the unit runs, and the discipline that the outer loop is walked by
someone who did not write the inner one. It leaves the object-oriented
vocabulary and the assumption that the check is always a test. A page
count, a rubric, and a county inspection are checks too.

**RIBA Plan of Work (2020).** Eight stages, 0 to 7: strategic definition,
preparation and briefing, concept design, spatial coordination, technical
design, manufacturing and construction, handover, use. Briefing is finished
before concept begins. Technical design is finished before construction
begins. Handover and use are stages with their own outputs, not the end of
the drawings. polya-craft takes the ordering, the idea that the brief is a
deliverable that later stages are checked against, and the last two stages:
D1 is the answer *in use*, and Look back is a stage, not a wrap-up. It
leaves the professional roles and the assumption that the stages are months
long. Here the stages never shrink to zero, but their contents can shrink to
a paragraph.

**The construction metaphor.** ACG's framing was an architect drawing a
blueprint and a crew framing walls from it. polya-craft keeps it, and takes
it seriously enough to build a house with it in `examples/house.md`. A
framer working from a complete sheet is a memoryless executor. A drawing set
that raises no question on site is a plan that passed the stranger test.
What the metaphor is asked to give up is the assumption that the crew is
always cheap software: the Hand may be a person, and the contract does not
change.

**`../architect-crew-gate/`, the immediate sibling.** polya-craft keeps
four things from it unchanged. The gate: only the named files changed, the
named commands pass, no test or config bent to pass them, junk not tracked.
The ownership rule: a unit may touch only its `Touches`. The fresh-session
reviewer: read-only, sees the reports as claims, findings each with a check.
The blind score: `npm run quality-review`, unchanged, so the two loops can be
compared on the same instrument. It deliberately changes five things. One
artifact per stage instead of two or five. The stranger test as the plan's
exit criterion, in place of file lists and traceability alone. Adopted
checks: an inspection, a CI job, or a rubric that already exists is the
level check, and no parallel one is written. One owner per fact, with the
packet assembled from the owner when the unit runs. And the ledger, which ACG
does not have at all.

## 3. Why a fresh loop instead of a rename

Three things are different enough that renaming ACG's stages would have
produced a loop that says one thing and does another.

**Understand ends with the check for done.** ACG's stage 0 produces
requirements and a quality standard; the acceptance tests come in stage 1,
from the architect, alongside the design. polya-craft refuses to let
understanding end before the done-checks are written, each with what a
stranger runs and whether it is met today. No plan text is allowed in that
artifact. The most expensive lesson in `PATTERN.md` section 8 is a D that
was met while the problem was not solved, and the only place to prevent it
is before the plan exists.

**Plan is judged by workability.** ACG validates a task by its fields: files
named, tests named, no test file under `Files:`. That catches the defects
ACG measured. It does not catch a task a cheap model cannot finish without a
decision. polya-craft's exit criterion for Devise is the stranger test: can
someone with no context, no memory, and no permission to decide begin, and
would two of them both pass the Check? The mechanical half is `plan-lint`;
the judgment half is the Solver's, and Carry out audits it. A question from
the Hand is proof the plan failed.

**Look back feeds the next problem.** ACG's review ends the job. polya-craft's
look back ends by writing to a ledger that the next Understand must read and
answer, entry by entry. "No lesson" is an entry. Without that write-back the
same defect recurs on the next problem, and `examples/house.md` section 5
argues this is the one thing construction, for all its inspections, does
not do.

The honest cost is a second loop to maintain beside `../architect-crew-gate/src/blueprint-loop.ts`.
The two share the gate and the repo I/O and nothing else. The plan is not to
keep both. If the four stages measure better on the same problem with the
same models, ACG's loop retires and its gate stays. If they do not,
polya-craft stays a document and the ledger idea moves into ACG. Either way
one loop survives.

## 4. What the three worked examples taught

**The grant** (`WALKTHROUGH.md`, sections 1 to 4) was chosen first and on
purpose. If the pattern only worked for code it would be a build pipeline.
A proposal has a Hand (a cheap model writing one section from a packet),
Checks (a page count, a spreadsheet total, a criterion-to-section table),
and an outer test (a stranger scoring against the rubric, which is D1). The
lesson that came out of it, that reviewers at that funder read the budget
justification first, is exactly the kind of thing a ledger is for.

**The bug** (`WALKTHROUGH.md`, section 6) showed that one page is enough.
Understand and Devise share one Solver turn. D1 is a `curl` printing `404`,
D2 is the suite staying green as an invariant, U1 is one unit with a red
test, Look back is four lines. The stages did not shrink to zero. Their
contents shrank to what you would have had to know anyway.

**The house** (`examples/house.md`, sections 3 to 5) produced three rules.
One owner per fact, from a window that did not fit its opening because the
schedule was revised and the drawing was not (section 3). Done-checks never
move down, from a quiet-office requirement that no phase owned until the
review found a hollow-core door in the next phase's draft (section 4).
Adopt existing checks, from the county inspection schedule that was already
a better level check than anything the plan could write (section 5). All
three are now rules in `PATTERN.md` and seed entries in `LESSONS.md`.

## 5. Sources

- Pólya's four steps, summarised: [home.sandiego.edu/~pmyers/foursteps.htm](https://home.sandiego.edu/~pmyers/foursteps.htm)
- V-model: [en.wikipedia.org/wiki/V-model_(software_development)](https://en.wikipedia.org/wiki/V-model_(software_development))
- Double-loop TDD: [sammancoaching.org](https://sammancoaching.org/learning_hours/bdd/double_loop_tdd.html) and [coding-is-like-cooking.info](https://coding-is-like-cooking.info/2013/04/outside-in-development-with-double-loop-tdd/)
- Acceptance test-driven development: [en.wikipedia.org/wiki/Acceptance_test-driven_development](https://en.wikipedia.org/wiki/Acceptance_test-driven_development)
- Specification by example: [en.wikipedia.org/wiki/Specification_by_example](https://en.wikipedia.org/wiki/Specification_by_example)
- RIBA Plan of Work 2020 overview: [riba.org (PDF)](https://www.riba.org/media/syneeeto/2020ribaplanofworkoverviewpdf.pdf)
- PDCA, DMAIC, and other problem-solving methods compared: [iobeya.com](https://www.iobeya.com/lean-corner/problem-solving-method-guide/)
- Double Diamond: [launchnotes.com](https://www.launchnotes.com/blog/the-double-diamond-framework-a-comprehensive-guide-to-effective-problem-solving)
- `../architect-crew-gate/ARTICLE.md` for the sibling's own sources: PEAR, ADaPT, aider's architect/editor split, Co-Coder.
