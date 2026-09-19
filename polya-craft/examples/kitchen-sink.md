# The kitchen sink leaks

*A physical problem you can solve this afternoon with the pattern. Cause
unknown at the start, which is the point: Understand has to earn the
done-check before anyone plans anything. `house.md` is the big version of
this; here every step fits on one page and you are the Hand.*

The cast:

| Role | This afternoon |
| --- | --- |
| **Solver** | you with a chat model open, or you alone with a notebook |
| **Hand** | you, later, with the packet on your phone and the tools out; or the helper you text it to |
| **Checks** | a dry paper towel, a timer, a flashlight |
| **Verifier** | whoever uses the sink tomorrow without knowing what you did |

The two roles are the same person wearing different hats, and the hats
matter. The Solver thinks and writes. The Hand does what the packet says
and does not improvise. If the Hand wants to improvise, that is a question,
and it goes back to the Solver.

---

## 0. The ledger

`LESSONS.md`, tags `domain:home kind:repair`:

```
## L-2026-03-02-01
Tags:     domain:home kind:repair stage:understand
When:     water under a sink
Lesson:   dry everything first and find the leak with a paper towel; the wet spot is rarely where the drip starts
Evidence: the bathroom sink, replaced the trap, the leak was the supply line above it
Status:   confirmed(1)
```

## 1. Understand

Do not plan yet. The problem as given is "there is water in the cabinet
under the kitchen sink." That is not a problem statement, it is a symptom.

The Solver writes what is given, and finds that half of it is missing. So
step one of Understand is to *go and look*, which Pólya allows: you cannot
restate a problem whose given you have not seen. With the flashlight, and
with the ledger entry in mind, the person dries everything, runs the tap
for two minutes, and watches. The water beads at the cold supply line's
compression nut, above the shutoff. The trap is dry. The cartridge is dry.

Now there is a given, and the Solver writes `ONE-PAGE.md`:

```markdown
# The kitchen sink leaks at the cold supply nut
Kind: repair · Size: S

## Problem
- Given: water beads at the compression nut on the cold supply line, at the
  shutoff valve, within two minutes of running cold. Trap and cartridge dry
  after five minutes. Line is 3/8" compression, braided steel, about six
  years old. Photo: phone, 14:02. Shutoff valve turns freely.
- Unknown: a dry cabinet under normal use.
- Condition: no plumber today; hardware store is open until six; the
  dishwasher shares the cold line and must work tonight.
- Restated: the cold supply's compression fitting has lost its seal, probably
  the ferrule; the trap is not involved. A tightened nut may hold or may
  not; a new line with a new ferrule will. The family will judge this by
  the cabinet being dry tomorrow, not by what was replaced.
- D1: the cabinet floor is dry after 24 hours of normal use, dishwasher
  cycle included — Check: a fresh paper towel laid flat under the valve at
  the start, inspected at 24 h, no wet spot — Now: unmet
- D2: the cold tap and the dishwasher both run — Check: run each for one
  minute — Now: met (invariant; must stay met)
- D3: no drip at the fitting under a five-minute cold run — Check: paper
  towel wrapped on the nut, dry after five minutes — Now: unmet
- Lessons consulted: L-2026-03-02-01 — applied: the wet spot was the cabinet
  floor; the drip was the nut above it
```

**The three questions.** Is D1 the answer in use? Yes: a day of use, not a
property of the fitting. Can a stranger run every Check? Yes, with a paper
towel and a clock. Is every D unmet? D1 and D3 yes; D2 is met and named as
the invariant, which is what stops the Hand from "fixing" the leak by
shutting the valve and leaving it.

Note what Understand did not do. It did not decide between tightening and
replacing. That is a plan decision, and it belongs to the next step.

## 2. Devise

The Solver decides, so the Hand will not have to. Tightening a compression
nut a quarter turn sometimes works and sometimes crushes the ferrule
further. The hardware store is open. The decision: replace the line, and
keep the quarter turn as the fallback if the store is out of the part.

```markdown
## Plan
- Approach: replace the cold supply line and its ferrule; a new fitting
  seals, a re-tightened old one may not. Borrowed from every faucet
  replacement ever done.
- Outer test: run cold for five minutes (D3); run the dishwasher tonight;
  read the towel tomorrow (D1); cold tap and dishwasher run (D2).

## U1: buy the line
Serves:   D3
Produces: one braided supply line, 3/8" compression × 1/2" FIP, 20", in the
          kitchen
Given:    the photo from 14:02; the old line's length (20", measured); the
          store's plumbing aisle
Do:       1. Match the photo: 3/8" compression on the valve end, 1/2" FIP on
          the faucet end. 2. Buy 20" or the next length up, never shorter.
          3. Buy one, not a pair.
Touches:  nothing in the house
Check:    the new line's valve-end nut threads onto the shutoff by hand,
          dry, two full turns — Now: unmet
Depends:  none
Not:      do not buy a new shutoff valve; the valve is not the problem.

## U2: swap the line
Serves:   D2 D3
Produces: the new line installed, cold side, both ends hand-tight plus a
          quarter turn
Given:    the new line (U1); an adjustable wrench; a towel; the shutoff
          valve, which closes clockwise
Do:       1. Close the cold shutoff. Open the cold tap; wait until it stops.
          2. Towel under the valve. Loosen the old nut at the valve, then at
          the faucet; remove the line. 3. Thread the new line on by hand at
          both ends. 4. Wrench: a quarter turn past hand-tight at each end,
          no more. 5. Open the shutoff slowly. Open the cold tap for ten
          seconds.
Touches:  the cold supply line only
Check:    D3: paper towel on the valve nut, dry after a five-minute cold run;
          D2: cold tap runs — Now: unmet
Depends:  U1
Not:      the hot line; the trap; the faucet cartridge. If a nut will not
          come off, stop; that is a question, not a decision.

## Order
U1 → U2. Then the outer test overnight.
```

**The stranger test, on U2.** Start: could a helper begin with only this
block, the wrench, and the photo? Yes; the packet says which way the valve
closes. Same: would two helpers both pass the Check? Yes, because "a quarter
turn past hand-tight" is a number, where "snug" would not have been. Decide:
is the Check outside Touches? Yes, the paper towel does not care what you
did. Sitting: one line, five steps. Yes.

The first draft of step 4 said "tighten until snug." The Solver caught it
against the forbidden-word rule before handing over. Two helpers reading
"snug" would produce two different torques, and one of them would leak.

## 3. Carry out

**U1.** You, or the helper, at the store with the photo and the block. The
store has 20" and 24". Buy 24"; the block says never shorter. Back home,
the Check: the nut threads onto the shutoff by hand, two turns, dry. Pass.

**U2.** The Hand puts the Solver's hat down. Step 1, step 2. The old nut at
the valve comes off. The old nut at the faucet end does not; it is seized.

The Hand's instinct is to grab pliers and force it. The block says: stop,
that is a question. So the Hand stops and asks: *"The faucet-end nut is
seized. Force it, or leave the old line's faucet end and splice?"*

The Solver, which is you with the other hat on, does not answer on the spot.
That is the discipline. You step back and re-plan U2 only. Given the seized
nut, forcing it risks the faucet's tailpiece, which is not in Touches and
would make this a much bigger afternoon. The new U2a: penetrating oil on the
faucet-end nut, ten minutes by the timer, then a second wrench holding the
tailpiece still while the first turns the nut. If it still will not move,
stop again; that is the plumber.

U2a runs. The nut moves with the second wrench holding the tailpiece. Steps
3 through 5 follow the block. Check: towel wrapped on the valve nut, five
minutes of cold. Dry. Cold tap runs. Pass.

## 4. Look back

**(a) Checks, from a clean state.** Not "I'm pretty sure it's fine." Dry the
cabinet floor completely. Lay a fresh paper towel flat under the valve.
Note the time. Run the dishwasher tonight as normal.

**(b) Verify.** Tomorrow, whoever opens the cabinet first, without being
told what happened, reads the towel. Dry. That is D1, and it was read by a
stranger.

**(c) Review, fresh eyes.** You, the next morning, coffee in hand, asking
Pólya's questions rather than admiring the work:

- Does it solve the *restated* problem? The restatement said the ferrule
  had lost its seal and the trap was not involved. The new line sealed. The
  trap stayed dry through a dishwasher cycle. Yes.
- Another way to check? Run the cold tap hard for two minutes with a hand
  on the valve nut. Dry. Yes.
- What does only judgment see? The hot line is the same age as the cold one
  and was installed the same day. Nothing in the done-checks covers it. A
  finding, medium, with a check: wrap the hot nut, five-minute hot run, read
  the towel. Dry today. Noted for the ledger, not fixed today, because it is
  outside Not-this and the plan.

**(d) Write it down.**

```markdown
## Look back
- Result: D1 met (towel dry at 24 h, read by someone else); D2 met (both
  run); D3 met (dry at five minutes).
- Judgment: solves the restated problem; hot line is the same age, checked
  dry, watch it.
- What worked: the photo at the store; "a quarter turn past hand-tight."
- What did not: U2 stopped on a seized faucet-end nut. The plan did not
  know the nut was seized because Understand looked at the valve end only.
- Lesson:
  ## L-2026-09-18-04
  Tags:     domain:home kind:repair stage:understand
  When:     replacing a line with two fittings
  Lesson:   at Understand, test both nuts by hand before planning; a seized
            nut is a given, not a surprise
  Evidence: the kitchen sink, U2, faucet-end nut
  Status:   candidate
- Confirmed: L-2026-03-02-01 → confirmed(2)
```

The next sink, the Solver reads both entries in step 0 and tests both nuts
before writing a plan. That is the whole point of the fourth step, and it
took four minutes.

## 5. What this one shows that the house did not

- **Understand can include going to look.** The problem as given was a
  symptom. The Solver could not restate it without a flashlight and a
  towel. That looking is part of Understand, and the ledger told it where
  to look.
- **The Hand and the Solver can be one person**, and the hats still
  matter. The moment the Hand wanted to force the nut was the moment to
  change hats, not to push harder.
- **A Check can be a paper towel.** It is outside Touches, unmet before the
  unit, met after, and two strangers read it the same way. That is the
  entire contract.
- **The invariant is a done-check.** D2, "both still run," is what stops
  the cheapest possible fix, closing the valve, from counting as done.
