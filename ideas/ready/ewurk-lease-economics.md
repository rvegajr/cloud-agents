# EWURK lease economics

## One sentence
A small, honest model of whether $20/month covers real refurb cost — so the
program does not pretend the lease is rent when it is a nudge to bring
machines back.

## The problem
The ops app records $20/month by hand. Nobody has run the arithmetic against
what a donated laptop actually costs to wipe, image, and keep in the field
(parts, volunteer time optional, failed units). Solved feels like: staff
paste real costs into a sheet or tiny tool and see months-to-recover, what
breakage does to the number, and that non-payment is still not a lockout.

## Must have (v1)
- Inputs the operator fills in. **Do not invent dollar amounts.** Ship a
  template with empty (or clearly labeled example) cells and a README that
  says which numbers must come from the shop (typical parts, hours, yield).
- Outputs: cost per machine that reaches `available`; months of $20/month
  to recover that cost; effect of a swap/repair; effect of a machine that
  never leases.
- State in the README: the lease is a behavioral nudge, not a debt
  instrument. The model must not recommend disabling a device for non-payment.
- Integer cents (or spreadsheet currency formatted from cents) — no float
  money math.
- GPL-3.0.

## I will judge it by
- I can enter three real numbers from a Saturday shop and get a recovery
  period without rewriting formulas.
- Example data is labeled example and is not presented as Worthless Haunted
  Meat’s actual cost.
- A reader who only reads the README understands $20/month is not “rent.”

## Wrong looks like
- Made-up refurb costs presented as facts.
- A collections model, credit score, or automatic shutoff recommendation.
- Stripe/Square integration (ops app v1 has a manual ledger).
- Replacing EWURK’s payment screen.

## Must not change
- Do not modify `Worthless-Haunted-Meat/ewurk` payment logic.
- No family PII in sample data (use the same fictional names as EWURK seed
  if any: Herrera, Osei).

## Nice to have (later)
- Feeding real EWURK payment exports.
- Donor vs lessee subsidy split.

## Shape
- New tiny repo **or** a `docs/economics/` folder if farmed into ewurk —
  prefer a standalone repo `ewurk-lease-economics` so farm does not rebuild
  the ops app.
- Spreadsheet (csv + documented formulas) or a small Node CLI that reads
  csv and prints the recovery table. Tests for the formulas using fixture
  numbers that are obviously fixtures.

## Example
The shop records: $40 parts, 2 hours at a stated volunteer-hour placeholder,
1 in 5 machines never lease. The tool prints months of $20 payments to
cover a successful unit, and a sentence that past-due in EWURK is still
only a flag.
