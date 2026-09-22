# EWURK — Electronic Waste Urban Renewal Kit

## One sentence
The operations system for a nonprofit that takes donated business/church e-waste,
refurbishes it into Linux laptops and tablets, and leases them to low-income
families for $20/month — so that staff always know which machine is where, who
has it, and whether its previous owner's data was destroyed.

## The problem
Today this program runs on a spreadsheet and somebody's memory. A church drops
off 14 laptops; six months later nobody can say which of them was wiped, which
went to which family, or which family is owed a replacement for the one that
broke. The $20/month lease only works as a behavior device — it exists to make
families bring broken machines back — and that fails the moment staff can't
answer "what do you have, and what do we owe you?" on the phone. Solved feels
like: a volunteer at a loading dock scans a donation in on a phone, and a
caseworker three months later pulls up a family and sees their device, its wipe
record, their payment history, and their class attendance on one screen.

## Must have (v1)
- **Donation intake → tax acknowledgment.** Log a donor org, pickup, and the items received; generate an IRS-compliant contemporaneous written acknowledgment. The letter describes the property and must NOT state a dollar value — the donor determines fair market value, not the charity.
- **Device lifecycle with an asset tag and a mandatory wipe record.** `received → triaged → wiped → refurbished → imaged → available → leased → returned → repair → retired`. A device cannot reach `available` without a recorded sanitization (method, date, operator) per NIST SP 800-88.
- **Leases and swaps.** A family holds one lease; a broken device is swapped for a new one without ending the lease or restarting the clock. Full custody chain per device.
- **Payment ledger, manual entry.** Record $20/month payments, show who is current/behind, and support a hardship pause. No live payment processor in v1.
- **Class sessions and attendance**, rostered off active leases.

## I will judge it by
- I can stand at a loading dock with a phone, log a 14-item donation in under five minutes, and hand the church a signed acknowledgment before I leave.
- Given a family's name on a phone call, I reach device + wipe record + payment status + class attendance in one screen, no cross-referencing.
- Given a serial number off a laptop lid, I can tell you who donated it, who wiped it, and which family has it now.
- Every device that ever held a business's data has a sanitization record attached to it, and the system made that non-optional rather than reminding me about it.
- A volunteer with no training can be shown the intake flow once and run it alone the following Saturday.

## Wrong looks like
- A device reaching `available` or `leased` with no wipe record — the single liability that could end this program, since donated business machines hold customer data.
- An acknowledgment letter that prints a dollar value for donated goods. That is the charity valuing an in-kind gift, which it must not do.
- Non-payment automatically disabling, locking, or bricking a child's laptop. The lease is a behavioral nudge, not a debt instrument; past-due is a flag for a human conversation and nothing more.
- Collecting SSNs, bank details, or income documentation to "qualify" families. Minimize PII on low-income households and minors; a name, a contact, and a neighborhood referral is the ceiling.
- Desktop-only layouts. Intake happens at a loading dock and swaps happen in a church basement, both on a phone.
- Losing the link between a returned broken device and the replacement that took its place.

## Must not change
- The charity never states a value for donated property anywhere in the system.
- No device leaves `refurbished` without a sanitization record.
- No automated enforcement action against a lessee for non-payment.
- License: GPL-3.0, matching the org's other program repo.

## Nice to have (later)
- Live recurring billing (Square or Stripe) once the pilot proves the lease.
- Donor self-serve pickup request form on the public site.
- Bulk CSV import for a large single donation.
- Device imaging/provisioning integration; remote wipe for leased hardware.
- Waitlist and neighborhood referral partner accounts.
- Spanish-language UI for lessee-facing screens.

## Shape
- Web app, multi-user with roles: **staff** (full), **volunteer** (intake + refurb only), **instructor** (rosters/attendance only). No lessee login in v1.
- Mobile-first. The two highest-volume flows (donation intake, device status change) must be one-handed on a phone.
- Hosted on Azure (the org holds Azure credits and a Microsoft Tech for Social Impact entitlement). Postgres. Server-rendered is fine and preferred over an SPA.
- Auth: email magic-link or Google Workspace sign-in against the org's domain. No password table.
- Seed data must include a realistic donation, five devices across different lifecycle stages, two leases, and one swap, so the app is explorable on first run.
- Tests must cover the two invariants above: wipe-before-available, and no-value-on-acknowledgment.

## Example
A church calls. A volunteer opens EWURK on her phone, creates a donation for
"St. Anne's Parish," and schedules a Saturday pickup. At the church she taps
"receive" and adds 14 items — for each, a model and serial off the label, which
mints an asset tag. Back at the shop, a tech pulls up the batch, marks nine as
triaged-good, and for each one runs a wipe and records method + date; the other
five he marks for parts. The nine become `available` only once their wipe records
exist — the app refuses otherwise. A caseworker leases asset `EW-0042` to the
Herrera family at $20/month, and the lease enrolls them in Saturday classes.
Two months later the screen cracks. Mrs. Herrera brings it in; a volunteer opens
her lease, hits "swap," scans `EW-0088` out to her, and `EW-0042` drops into
`repair` with its history intact. Her lease clock never stopped, her payment
record follows her, and the next person to pick up `EW-0042` can see everywhere
it has been.
