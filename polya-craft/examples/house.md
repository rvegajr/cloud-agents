# Building a house, every step

*The third worked example, beside the grant proposal and the one-line bug in
`../WALKTHROUGH.md`. A house is the hardest test of the pattern because
construction already runs all four steps as institutions: the brief, the
drawings, the trades, the inspections. If the pattern adds nothing here it
adds nothing anywhere. It adds three things, named at the end.*

The cast, in the pattern's words:

| Role | On this house |
| --- | --- |
| **Solver** | the architect and the general contractor planning together; a strong model can play it |
| **Hand** | each trade: framers, roofers, plumbers. A person, working from the sheet, not from a conversation |
| **Checks** | the tape, the level, the county inspection schedule, the bank draw ledger |
| **Verifier** | someone who did not build it, walking the outer test: the family's own inspector |
| **Reviewer** | the architect, fresh eyes, at the end of each phase |

---

## 0. The ledger

The builder's notebook is `LESSONS.md`. Entries whose tags match
`kind:build domain:construction county:X soil:clay`:

```
## L-2025-11-03-02
Tags:     domain:construction soil:clay stage:plan kind:build
When:     the soil report says expansive clay
Lesson:   over-excavate footings 6" and bring in select fill; do not trust the slab spec alone
Evidence: the Marsh house, slab crack at 14 months, U3 of phase 1
Status:   confirmed(2)

## L-2026-02-19-01
Tags:     domain:construction county:X stage:carry-out
When:     any framing inspection in county X
Lesson:   post the nail schedule on the wall before the inspector arrives; he checks against it
Evidence: the Oduya house, framing re-inspection cost 4 days
Status:   confirmed(1)

## L-2026-05-30-01
Tags:     domain:construction stage:understand kind:build
When:     the family asks for an open kitchen
Lesson:   mock the sightline from the kitchen to the room they want quiet, with tape on the slab, before framing
Evidence: the Reyes house, office noise, found at look back
Status:   candidate
```

All three go into the Understand prompt.

## 1. Understand — one Solver turn

Paste `prompts/understand.md` with the brief verbatim: the survey, the soil
report, the family's list, the budget letter, the county's adopted code, the
first-meeting sketch. The Solver writes:

```markdown
# Problem: a house the Larsens live in from 2027-08-01, under $520k, with a CO
Kind: build
Size: L

## Given
- Lot 14, survey `site/survey.pdf`: 62' × 140', setbacks 25' front, 10' sides
- Soil report `site/geotech.pdf`: expansive clay to 6'
- Family of four; one adult works from home on calls all day
- Budget $520,000 all-in, `finance/commitment.pdf`; bank draws at five milestones
- County X, IRC 2021 with county amendments `code/county-x-amendments.pdf`
- HOA exterior rules `hoa/design-guidelines.pdf`
- Sketch from the first meeting `design/sketch-01.pdf`: 3 bed, 2.5 bath, open kitchen

## Unknown
A finished house on lot 14 that the county certifies for occupancy and the
Larsens move into on 2027-08-01.

## Condition
Code and county amendments bind. The HOA must approve the exterior before
framing. Every bank draw needs its inspection passed. Clay governs the
foundation.

## Restated
Three bedrooms, one of which is an office that must stay quiet while the
kitchen is in use; that is the thing the family will judge the house by, and
the open kitchen they asked for works against it. Expansive clay means the
foundation is the risk, not the framing. The date is fixed by a school year.

## Done-check
- D1: the Larsens sleep in the house on 2027-08-01 and the county has issued a CO
  — Check: the CO on file; the family confirms — Now: unmet
- D2: total spend ≤ $520,000
  — Check: the draw ledger's final total — Now: unmet
- D3: every scheduled inspection passed on the first or second visit
  — Check: county inspection record — Now: unmet
- D4: the office measures ≤ 40 dB(A) with the kitchen fan and dishwasher running
  — Check: sound meter, door closed, 60-second average — Now: unmet
- D5: the HOA approval letter matches what was built
  — Check: letter on file; exterior walk against it — Now: unmet
- D6: no slab movement > 1/4" at 12 months
  — Check: survey pins, read at handover and at 12 months — Now: unmet

## Not this
No pool, no detached garage, no solar this phase. No change to the lot grade
beyond the drainage plan.

## Lessons consulted
- L-2025-11-03-02 clay footings — applied: over-excavation and select fill go into phase 1
- L-2026-02-19-01 nail schedule posted — applied: becomes a step in every framing unit
- L-2026-05-30-01 sightline mockup — applied: a unit in phase 1, before framing, with the family present
```

**The person's three questions.** D1 is the house in use, not "the house is
finished": yes. Every Check is runnable by a stranger with the documents
named: yes. Every Check unmet today: yes, including D6, which cannot be met
until a year after handover and is still a done-check because it is what
"solved" means on clay.

**Size L: the split.** Eight units is one trade's week, not a house. The Solver
splits the problem into phases, each its own `PLAN.md`, the whole keeping one
`PROBLEM.md`. The phase boundaries are the county's inspection schedule and
the bank's draws, which is not a coincidence; those are the level checks.

| Phase | Plan | Level check (written by someone else) | Serves |
| --- | --- | --- | --- |
| P1 site and foundation | `plans/P1.md` | footing inspection; slab inspection; draw 1 | D2 D3 D6 |
| P2 shell | `plans/P2.md` | framing inspection; dried-in; draw 2 | D2 D3 D4 D5 |
| P3 systems | `plans/P3.md` | rough-in inspections (electrical, plumbing, mechanical); insulation; draw 3 | D2 D3 D4 |
| P4 finishes and handover | `plans/P4.md` | final inspection; CO; draw 4 and 5 | D1 D2 D4 D5 |

D4, the quiet office, crosses three phases. That is the trace the pattern
insists on: each phase's plan must name the unit that carries D4, or D4 is
lost between trades. That is exactly how it was lost on the Reyes house.

## 2. Devise — phase 2, the shell

Paste `prompts/devise.md` with `PROBLEM.md`, the phase row, and the cap of
eight units. The Solver writes `plans/P2.md`:

```markdown
# Plan for: P2 shell — the Larsen house

## Approach
Platform framing, 2×6 exterior walls, engineered trusses. The office wall to
the kitchen is a double-stud partition with a 1" gap; the office door rough
opening is sized for a solid-core door (P4 must honour it). Nail schedule S-4
is posted on the wall before the first stud goes up (L-2026-02-19-01).

## Shape
- L2 the shell, dried in — check: framing inspection passed; hose test at every
  window and door, no water inside after 10 minutes
- L1:floor — check: subfloor flat within 1/4" over 10', glued and screwed per S-2
- L1:walls — check: every wall plumb within 1/8" over 8'; every rough opening
  matches the window and door schedule W-1 within 1/4"
- L1:roof — check: trusses set per the truss layout T-1, bracing per T-2
- L1:openings — check: every window and door installed, flashed per detail D-7
- L0 units below

## Outer test
1. Walk the slab edge: sill plates anchored at every bolt (D3)
2. Walk every wall with the W-1 schedule and a tape (D3, D5 for exterior openings)
3. Stand in the office; the kitchen wall is double-stud with the gap (D4)
4. Climb: trusses match T-1, bracing per T-2 (D3)
5. Hose test each opening from outside, 10 minutes (D3)
6. Compare the exterior to the HOA approval drawing (D5)

## Units

## U1: set sill plates and anchor
Serves:   D3
Level:    L1:floor
Produces: treated sill plates on every stem wall, anchored
Given:    foundation plan F-1; anchor bolt layout F-2; sill sealer spec S-1
Do:       1. Sill sealer on the stem wall. 2. Treated 2×6 plates, drilled at
          each bolt on F-2. 3. Nuts and washers torqued. 4. Check level; shim
          per S-1 where the stem wall is low.
Touches:  the sill plates only
Check:    every bolt on F-2 has a nut and washer; plates level within 1/8" over 10' — Now: unmet
Depends:  none
Not:      no floor framing.

## U2: floor system and subfloor
Serves:   D3
Level:    L1:floor
Produces: the first-floor deck, ready to frame on
Given:    floor framing plan F-3; joist hanger schedule S-2; subfloor spec S-2
Do:       1. Rim and joists per F-3, hangers per S-2. 2. Blocking at F-3 marks.
          3. Subfloor glued and screwed per S-2, staggered. 4. Snap the wall
          lines from A-101 on the deck.
Touches:  the floor system
Check:    L1:floor check; wall lines snapped and match A-101 within 1/4" — Now: unmet
Depends:  U1
Not:      no wall framing.

## U3: frame the south and east walls
Serves:   D3 D5
Level:    L1:walls
Produces: south and east exterior walls standing, plumb, braced
Given:    sheets A-201, A-202; lumber schedule S-3; nail schedule S-4;
          header table S-5; window and door schedule W-1
Do:       1. Post S-4 on the deck. 2. Plates per S-3, crown up, layout from
          the snapped lines. 3. Studs 16" o.c. from the south-east corner.
          4. Rough openings per W-1, headers per S-5. 5. Nail per S-4.
          6. Raise, plumb, brace.
Touches:  south and east walls
Check:    plumb within 1/8" over 8'; every rough opening matches W-1 within
          1/4"; nails per S-4 at every joint on the checklist — Now: unmet
Depends:  U2
Not:      no sheathing; no interior partitions.

## U4: frame the north wall
Serves:   D3 D5
Level:    L1:walls
Produces: the north exterior wall standing, plumb, braced, grid A to D
Given:    sheet A-203; S-3; S-4; S-5; W-1 rows for openings 3 and 4
Do:       1. Plates per S-3, crown up, layout from the snapped lines.
          2. Studs 16" o.c. from the north-west corner. 3. Rough openings 3
          and 4 per W-1; headers per S-5 (2×10 over opening 4). 4. Nail per
          S-4: two 16d at every stud end, 16" o.c. on the plates.
          5. Raise, plumb, brace.
Touches:  the north wall
Check:    plumb within 1/8" over 8'; openings 3 and 4 match W-1 within 1/4";
          header at opening 4 is 2×10; nails per S-4 at every joint — Now: unmet
Depends:  U2
Not:      no sheathing.

## U5: west wall and interior partitions, including the office wall
Serves:   D3 D4
Level:    L1:walls
Produces: west exterior wall and every interior partition on A-101
Given:    A-204, A-101; S-3, S-4, S-5; detail D-12 (double-stud office wall);
          door schedule W-1 rows D1–D9
Do:       1. West wall as U3 steps 2–6. 2. Partitions per A-101, 16" o.c.
          3. The office–kitchen wall per D-12: two 2×4 walls, 1" gap, no
          shared studs, no shared plates. 4. Office door rough opening per
          W-1 row D6 (solid core, 36"). 5. Nail per S-4.
Touches:  west wall and interior partitions
Check:    plumb within 1/8"; D-12 wall has no member crossing the gap; D6
          opening 38 1/2" × 82 1/2"; nails per S-4 — Now: unmet
Depends:  U2
Not:      no blocking for cabinets; that is P3.

## U6: set trusses
Serves:   D3
Level:    L1:roof
Produces: trusses set and braced
Given:    truss layout T-1; bracing T-2; hurricane tie schedule S-6; the
          crane booked for the date in the schedule
Do:       1. Mark layout on the top plates from T-1. 2. Set per T-1, ties per
          S-6 at every bearing. 3. Bracing per T-2 as you go, not after.
Touches:  the roof structure
Check:    L1:roof check; ties at every bearing on S-6 — Now: unmet
Depends:  U3 U4 U5
Not:      no sheathing on the roof.

## U7: sheathing, roof deck, house wrap
Serves:   D3
Level:    L2
Produces: walls and roof sheathed, wrapped, ready for openings
Given:    sheathing nail schedule S-7; wrap detail D-6
Do:       1. Wall sheathing per S-7. 2. Roof deck per S-7 with clips.
          3. Wrap per D-6, shingled, taped.
Touches:  exterior surfaces
Check:    nails per S-7 on the checklist; wrap laps shingle-fashion at every seam — Now: unmet
Depends:  U6
Not:      no windows.

## U8: windows and exterior doors
Serves:   D3 D5
Level:    L1:openings
Produces: every opening on W-1 installed and flashed
Given:    W-1; flashing detail D-7; the delivered units checked against W-1
Do:       1. Check each delivered unit against W-1 before install. 2. Sill pan
          per D-7. 3. Set, shim, fasten per the manufacturer's sheet.
          4. Flash per D-7, bottom, sides, top, in that order.
Touches:  the openings
Check:    L1:openings check; hose test per L2 — Now: unmet
Depends:  U7
Not:      no trim.

## Order
U1 → U2 → U3, U4, U5 in parallel (disjoint walls) → U6 → U7 → U8.
Framing inspection after U7. Dried-in check after U8. Draw 2 after both.

## Trace
D3 → U1–U8 → steps 1, 2, 4, 5. D4 → U5 → step 3. D5 → U3, U4, U8 → steps 2, 6.
```

**The stranger test, applied.** The Solver's first draft of U4 step 4 read
"nail appropriately." That fails *Same*: two framers would nail differently
and both call it done. The person sent it back with one line, and the
revision names S-4 and the count. That is the entire difference between a
drawing set a crew can build from and one they will phone about.

U5 carries D4 and is the only unit that does, in this phase. If the Trace
line had not shown D4 → U5, the quiet office would have quietly become a
single-stud wall, which is what the Reyes lesson was about.

**Every Check unmet:** nothing is framed. Yes.

## 3. Carry out

The framing crew gets **the U4 packet**: the unit block, the Restated
paragraph, the D3 and D5 lines, and sheets A-203, S-3, S-4, S-5, the two W-1
rows. They do not get A-101 or the office detail. That is the fresh session:
the crew works from the sheet, and the sheet has to be enough.

They frame it. The GC, not the framer, walks it with the Check. One line
fails: the header at opening 4 is a doubled 2×8. The GC hands back that line
only: *"Check: header at opening 4 is 2×10. Found 2×8."* The crew swaps it.
The Check passes on the second visit. That is one retry; the pattern allows
two before it becomes a plan defect.

U3 and U5 run the same days on the other walls. Then U6, U7.

**The Hand asks a question.** On U8 the window installer says: *"The rough
opening for window 3 on the north wall is 1/2" narrower than W-1."* Nobody
answers this on site. It goes back to the Solver, because the question means
a unit failed the stranger test somewhere upstream: U4's Check said the
opening matched W-1 and the GC ticked it, so either the check was walked
loosely or W-1 changed after A-203 was issued. The Solver finds the second:
W-1 was revised for a stock size and A-203 was not. The re-plan is one unit,
U8a, "open up RO 3 by 1/2" per revised W-1," with its own Check. Candidate
lesson: *"walk every RO against the current W-1, dated, not the one on the
sheet."*

**Level checks.** After U7, the framing inspection. S-4 is posted on the wall.
It passes first visit; the ledger entry earned its `confirmed(2)`. After U8,
the hose test at every opening, then draw 2.

## 4. Look back — phase 2

**(a) Checks, from a clean state.** Not the GC's memory of the week. A fresh
walk: the inspection record shows framing passed on 2026-11-14, first visit.
Every unit Check walked again with the checklist: 8 of 8. Hose test: dry.
The bank's inspector's report for draw 2 on file.

**(b) Verify.** The Larsens' own inspector, who has not been on site, walks
the six outer-test steps with `plans/P2.md` and a tape. Step 3, the office
wall: double-stud with the gap, confirmed. Step 6: the north elevation
matches the HOA drawing except the window 3 size, which the HOA drawing
shows at the old W-1. Reported as evidence, not as a verdict.

**(c) Review.** The architect, who was not on site during framing, walks the
shell against the *restated* problem. Findings:

- **High.** The HOA approval drawing shows window 3 at the old size. Built to
  the revised W-1, D5 fails at the final walk. Fix: submit the revision to the
  HOA now, before siding. Check: the amended approval letter on file.
- **Medium.** The finish schedule in the P4 draft still lists door D6 as
  hollow core. The double-stud wall is then wasted; D4 fails on the door.
  Fix: P4's plan must carry D4 to a solid-core unit. Check: P4 Trace line.
- Another way to check D4 early: a phone dB meter in the office with a radio
  in the kitchen, now, before insulation. 44 dB. Not a fail, since P3 adds
  insulation, but a number to beat.

**(d) `plans/P2-LOOKBACK.md`.** The result table, the three findings, and:

```
## Lessons
## L-2026-11-20-01
Tags:     domain:construction stage:plan kind:build
When:     any unit whose Check references a schedule (W-1, S-5) that can be revised
Lesson:   the Check names the schedule's revision date; the packet includes that revision
Evidence: the Larsen house P2, RO 3, U8 stopped and asked
Status:   candidate

## L-2026-11-20-02
Tags:     domain:construction stage:understand kind:build
When:     a done-check crosses phases (the quiet office, D4)
Lesson:   write the D into every phase's Trace line, and read the next phase's draft plan at look back
Evidence: the Larsen house P2 review, finding 2, caught the hollow-core door in P4's draft
Status:   candidate

L-2026-02-19-01 (nail schedule posted) → confirmed(2)
L-2025-11-03-02 (clay footings) → confirmed(3), from P1's look back
```

Phase 3 begins with its own Understand turn reading these.

## 5. What the house taught the pattern

Three things construction already does, and the one thing it does not:

1. **Inspections are level checks written by someone else.** The pattern does
   not invent them. It only insists each one is named in the plan and closed
   by specific units. A house plan without the Trace line is a house where the
   quiet office is nobody's unit.
2. **The Hand being human changes nothing in the contract.** A framer working
   from a complete sheet is a memoryless executor. The stranger test is what
   a good drawing set passes and a bad one fails, and it is the same four
   questions.
3. **Size L is phases, and phases are sub-problems.** One `PROBLEM.md`, one
   `PLAN.md` per phase, one look back per phase, one final look back at the
   CO. The eight-unit cap forced the same split the trades and the bank use.
4. **The one thing construction does not do:** write the lesson down where
   the next house's architect will read it before the first meeting. The RO
   revision, the hollow-core door, the clay footings all happened before on
   other houses. The ledger is the only new artifact here, and it is the one
   the next house is cheaper for.
