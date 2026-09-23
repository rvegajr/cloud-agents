# EWURK Linux image

## One sentence
A reproducible Linux image for refurbished donated laptops, so a volunteer can
image a wiped machine the same way every Saturday and a family gets a usable
computer, not a tech project.

## The problem
The ops app (`Worthless-Haunted-Meat/ewurk`) already tracks devices through
`imaged` → `available` → `leased`. Nothing in that repo produces the image.
Today imaging is whoever is in the shop that day. Solved feels like: flash a
known image, first boot asks for a language and a name, no telemetry, no
accounts to create, and the README names the exact USB/dd/ventoy command.

## Must have (v1)
- A documented, repeatable build of a Debian- or Ubuntu-based desktop for
  typical donated Intel laptops (not a custom distro from scratch).
- First-boot: locale, keyboard, hostname optional, a single non-admin user
  the family will use. No cloud account, no OEM bloat, no telemetry.
- Offline-capable basics: browser, document suite, printer/wifi that works
  without a vendor portal.
- Wipe-friendly: imaging a machine must not be confused with sanitization.
  The README states that NIST wipe is recorded in EWURK *before* imaging,
  and this repo never claims to be the wipe.
- GPL-3.0, matching the rest of Worthless Haunted Meat.

## I will judge it by
- A volunteer who has never built a distro can follow the README and produce
  a bootable USB from a clean clone.
- First boot on a VM (documented) reaches a desktop without a paid account.
- The image does not phone home on first boot (called out and tested).

## Wrong looks like
- Shipping a Windows refurb or a license that the charity cannot grant.
- An image that requires Ubuntu One, Google, or Microsoft sign-in to be usable.
- Treating this repo as the wipe: no device should be `available` in EWURK
  just because it was imaged.
- Inventing hardware support for ARM Chromebooks in v1.

## Must not change
- Do not modify `Worthless-Haunted-Meat/ewurk`. This is a new repo.
- No automated lock/brick of a leased device.
- No collection of family PII in the image.

## Nice to have (later)
- Auto-enroll into a management tool.
- Tablet images.
- Integration that sets EWURK device status to `imaged` from the bench.

## Shape
- New GitHub repo under Worthless-Haunted-Meat, e.g. `ewurk-linux-image`.
- Build documented for a Linux host; tests can be script-level (image
  exists, expected packages, no telemetry services enabled) plus a VM
  smoke if that stays free and unattended.
- No paid services, no accounts, no secrets in the repo.

## Example
A tech finishes a NIST wipe on `EW-0042` and records it in EWURK. They flash
the USB from this repo, boot the Latitude, walk through first-boot, and mark
the device `imaged` then `available` in EWURK. The Herrera family later
leases it without ever seeing a developer prompt.
