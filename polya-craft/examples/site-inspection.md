# Inspect a site and find as many bugs as possible

*The fourth example, and a different kind: the deliverable is a report, not
a fix. Kind: answer. The problem as given is unbounded, and the first thing
the pattern does is refuse to accept it that way.*

The cast:

| Role | On this inspection |
| --- | --- |
| **Solver** | the strong model: turns "find all the bugs" into something finishable, writes the oracle, triages |
| **Hand** | a cheap model with a browser, or a person with a checklist; one workflow per fresh session |
| **Checks** | link checker, HTML validator, axe, Lighthouse, the console; then the coverage table |
| **Verifier** | a stranger who reproduces findings from the report alone |

---

## 0. The ledger

`LESSONS.md`, tags `kind:answer domain:qa`:

```
## L-2026-06-11-02
Tags:     kind:answer domain:qa stage:devise
When:     inspecting a site with more than one user role
Lesson:   walk every workflow once per role; half the defects are a role seeing what it should not
Evidence: the clinic portal, 9 of 21 findings were role leaks
Status:   confirmed(2)

## L-2026-07-30-01
Tags:     kind:answer domain:qa stage:understand
When:     the requester says "find all the bugs"
Lesson:   done is a coverage map plus reproducible findings, never "all"; write the oracle before the first walk
Evidence: the storefront, two days of unfocused clicking, no way to say when to stop
Status:   confirmed(1)
```

## 1. Understand

The problem as given: "Here is the staging URL and two logins. Find all
the bugs, or as many as you can, by Friday."

The Solver's first move is Pólya's: what is given, what is sought, how are
they connected. And it finds that "all the bugs" is not an unknown you can
check. There is no test for "all." So it restates the problem into one
that has a done-check.

```markdown
# Problem: an inspection report for the staging site that a stranger can act on
Kind: answer
Size: M

## Given
- Staging URL, two logins: customer and admin (`creds/staging.txt`, owner: the requester)
- The sitemap and the route list (`curl staging/sitemap.xml`; the admin nav)
- The spec, such as it is: the product's help pages and the acceptance tests in `e2e/` (owner: the repo)
- Browsers in scope: current Chrome and Safari, desktop and a 390px phone
- Two days; no changes to the site; no production

## Unknown
A report: a coverage map of every route and workflow per role, and a list of
defects each with steps, expected, observed, evidence, and severity, such
that the developer reproduces any one of them on the first try.

## Condition
Only what the spec, the help pages, or ordinary expectation defines as
wrong counts as a defect. "I would have designed it differently" is not a
finding. The site is read-only to us except for test data we create and
delete.

## Restated
We are not finding all the bugs; nobody can check that. We are walking
every workflow the site offers, once per role, per breakpoint, against a
written oracle, and recording every deviation with enough evidence that a
stranger reproduces it. Done is coverage plus reproducibility. The
requester will judge the report by whether the developer can act on it
without coming back to ask.

## Done-check
- D1: the developer reproduces a random five findings from the report alone, first try
  — Check: a Verifier who did not inspect picks five by dice and follows the steps — Now: unmet
- D2: every route in the sitemap and every admin nav item has a coverage row with a walk date and a role
  — Check: `python3 tools/coverage.py report.md sitemap.xml` exits 0 when no row is empty — Now: unmet
- D3: every finding has all six fields
  — Check: `python3 tools/lint-findings.py report.md` exits 0 — Now: unmet
- D4: no two findings describe the same defect
  — Check: the reviewer's dedupe pass finds none — Now: unmet
- D5: the site's data is as we found it
  — Check: the admin's record count before equals after; our test records deleted — Now: met (invariant)

## Not this
- No fixes. No performance tuning. No opinions on design.
- No production. No load.

## Lessons consulted
- L-2026-07-30-01 — applied: this restatement
- L-2026-06-11-02 — applied: every workflow unit runs once per role
```

**The three questions.** D1 is the report in use: a developer reproducing
from it. D2 and D3 are commands; the Solver writes the two small scripts
at Devise, and they are the red tests. D5 is the invariant that stops a
careless inspection from becoming an incident.

Note the move. "As many bugs as possible" became "every workflow walked
against an oracle, every finding reproducible." That is finishable by
Friday, and it is also the honest description of what any inspection ever
does.

## 2. Devise

**The oracle first.** A Hand with no judgment cannot decide what a bug is.
So the Solver writes the checklist that decides for it: per page type, what
must be true. Forms: every required field rejects empty; every error names
the field; submit twice does not create twice; back after submit does not
resubmit. Lists: sort and filter persist across pagination; empty state
has text. Auth: every admin route answers 403 or redirects for the customer
login. Links: none 404. Phone: no horizontal scroll; every tap target
reachable. Console: no uncaught errors. The oracle is `ORACLE.md`, and it
is a Given for every walking unit. "Is this a bug?" is now a lookup.

```markdown
# Plan for: an inspection report for the staging site

## Approach
Mechanical checks first, because they are free and they clear the noise.
Then one unit per workflow per role, each walking against ORACLE.md and
writing findings in the fixed format. The report assembles from the units'
rows. Borrowed from every QA pass that ever worked: coverage map, oracle,
reproduction steps.

## Shape
- L2 the report — check: D1 through D5
- L1:mechanical — check: the four tool reports are attached and their findings imported
- L1:customer — check: every customer route has a row; every finding has six fields
- L1:admin — check: the same, for admin routes
- L1:phone — check: every route walked at 390px has a row

## Outer test
1. The developer opens the report cold and reproduces five findings picked by dice (D1)
2. The coverage script exits 0 (D2); the lint script exits 0 (D3)
3. The reviewer reads every finding once and marks duplicates (D4)
4. The admin record count matches the number taken at the start (D5)

## Units

## U1: run the mechanical checks
Serves:   D2 D3
Level:    L1:mechanical
Produces: `report/mechanical/` with four files: links, html, axe, lighthouse
Given:    the sitemap; `tools/run-mechanical.sh` (writes all four)
Do:       1. Run the script against the sitemap. 2. Import each tool's
          failures as findings with the tool named as evidence.
Touches:  report/mechanical/, report.md findings section
Check:    `ls report/mechanical | wc -l` prints 4; lint-findings.py exits 0 — Now: unmet
Depends:  none
Not:      do not judge the tools' findings; import them all, the reviewer triages.

## U2: walk the customer checkout as the customer, desktop
Serves:   D1 D2 D3 D5
Level:    L1:customer
Produces: coverage rows for /cart, /checkout, /checkout/confirm; findings
Given:    ORACLE.md; the customer login; the steps in e2e/checkout.spec.ts
          read as a script; a test product named "INSPECT-<date>"
Do:       1. Add the test product to the cart. 2. Walk checkout exactly as
          the spec walks it. 3. At every page, run the ORACLE.md section for
          that page type. 4. Record every deviation as a finding: steps,
          expected (quote the oracle line), observed, screenshot, page,
          role. 5. Cancel the order; confirm the test product is gone.
Touches:  report.md (rows and findings for these three routes only)
Check:    three coverage rows with today's date and role=customer;
          lint-findings.py exits 0; the test order is not in the admin list — Now: unmet
Depends:  U1
Not:      no other routes; do not decide severity; do not skip a step because it "obviously works".

## U3: the same walk as admin
## U4: the same walk at 390px
## U5: admin user management, desktop, both roles (the customer must be refused)
## U6: search and filters, both roles
## U7: account settings and password reset, customer
## U8: assemble the report: dedupe input, coverage table, findings sorted by page
   Check: coverage.py exits 0; lint-findings.py exits 0

## Order
U1 → U2 … U7 in any order, side by side (each owns its own rows) → U8

## Trace
- D1 → U2–U7 → step 1 · D2 → U1, U8 → step 2 · D3 → every unit → step 2
- D4 → U8 and the reviewer → step 3 · D5 → U2–U7 step 5 → step 4
```

**The stranger test, on U2.** Start: the Hand has the login, the oracle,
the steps, and the product name. Yes. Same: two Hands walking the same
steps against the same oracle produce the same deviations. Not the same
prose, but the same rows, and lint accepts both. Yes. Decide: the Check is
the coverage rows and the lint script, which the Hand cannot satisfy by
editing them. Yes. Sitting: three routes, five steps. Yes.

What the Solver refused to leave to the Hand: severity. A cheap model
grading its own findings as "critical" is a Hand deciding. Severity is the
reviewer's, in Look back (c).

## 3. Carry out

U1 runs in a minute and imports 31 findings from the tools, most of them
the same missing alt text on one template. That is fine; the reviewer will
collapse them.

U2 through U7 run side by side, each a fresh session with a browser. The
Hand walks, screenshots, writes rows. U2 finds that submitting checkout
twice fast creates two orders; the oracle line "submit twice does not
create twice" is quoted as expected. U5 finds that the customer login
opens `/admin/users` and sees the list; the oracle's auth section is
quoted. That one the ledger predicted.

**A Hand asks.** U6, search: *"Filtering by price then sorting by name
resets the filter. The oracle says filters persist across pagination; it
does not mention sorting. Is this a finding?"* The Hand does not decide.
The Solver reads the question and does two things: answers it by adding a
line to ORACLE.md ("filters persist across sort"), which makes the answer
a fact the next walk can look up, and writes the question down as a
candidate lesson about oracle coverage. U6 continues.

Unit checks after each: the rows exist, lint exits 0, the test records are
gone. U8 assembles.

## 4. Look back

**(a) Checks, from a clean state.** A fresh checkout of the report folder.
`coverage.py` exits 0: 44 routes, 44 rows, each with a date and a role.
`lint-findings.py` exits 0: 58 findings, six fields each. The admin record
count matches the morning's number.

**(b) Verify.** Someone who did not inspect rolls a die five times and
reproduces those findings from the report alone. Four reproduce on the
first try. One does not: the steps say "click Save" and there are two Save
buttons on that page. That is D1 unmet, and it goes back as a fix unit to
the Hand that wrote it: name the button by its section. Reproduce again.
Five of five.

**(c) Review.** The Solver, fresh session, reading the report rather than
the walks:

- Does it answer the restated problem? Coverage complete, findings
  reproducible. Yes. It does not answer "all the bugs," and the report
  says so on its first page: what was walked, at which breakpoints, and
  what was not (no Firefox, no load, no email delivery).
- Another way to check? The e2e suite in the repo; every finding on a
  workflow the suite covers should correspond to a test that is missing or
  wrong. Twelve do. That is a second list, for the developer.
- What does only judgment see? Severity, assigned now: two high (double
  order, admin leak), nine medium, the rest low. And the pattern: 31 tool
  findings collapse to 4 defects, three of them in one template. Root
  cause over symptoms; the report groups them.
- Dedupe: four pairs merged. D4 met.

**(d) Write it down.** `LOOKBACK.md`, and two ledger entries: the oracle
lesson from U6's question, and "run the mechanical checks first; they were
a third of the raw findings at a hundredth of the cost", confirmed by this
run. L-2026-06-11-02 goes to `confirmed(3)`.

## 5. What "as many as possible" means in this pattern

The requester's phrase hides a loop, and Look back is where it turns.
Coverage gaps become the next plan's units: Firefox, email, load. The
root-cause pattern becomes a targeted unit: walk every page that uses that
template. The oracle grows by one line per Hand question. The second pass
is cheaper and finds different things, and the third finds fewer. The
stopping rule is not "no bugs left." It is: coverage complete for the
scope agreed, findings reproducible, time spent, and a written list of
what was not walked. That list is the most honest sentence in any
inspection report, and the pattern produces it for free.

## In the kit

This example is the reason `ROADMAP.md` lists a browser for the Hand and
the Verifier. With Playwright attached to the cheap model, U2 through U7
are ordinary carry-out turns and the walks are recorded runs. Without it,
the Hand is a person with the same packet.
