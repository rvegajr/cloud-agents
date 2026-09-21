# Request: a CLI that prints the ISO week for a date

<!-- kind: build, CLI, Node, date edge cases. From ideas/ready/farm-iso-week.md. -->

## Why
`date +%V` is easy to forget and differs from US week numbers. Solved feels like:
`iso-week 2026-09-17` prints `2026-W38 4`.

## I will judge it by
- `iso-week 2026-01-01` prints `2026-W01 4` (ISO year edge: a Thursday decides the year).
- `iso-week 2027-01-01` prints `2026-W53 5` (a date that belongs to the previous ISO year).
- `iso-week 2026-02-30` exits 2 with one line on stderr and nothing on stdout.
- `iso-week` with no argument prints today's week in UTC, in the same shape.

## Wrong looks like
- A week number computed with the local time zone, so the answer changes with the machine's clock setting.
- `2026-1-1` (no zero padding) accepted as valid.

## Must not change
- The command name `iso-week`, as the package `bin` and the `npm run` script name.

## Not this
- No week ranges, no locale week starts, no dependencies.

## Where it lives, who uses it
Node 22 or newer, macOS and Linux, a stranger from a fresh clone after `npm ci`, in any time zone.

## The one walk-through
I run `npm ci`, then `TZ=Pacific/Kiritimati npx iso-week 2026-01-01` and `TZ=America/Los_Angeles npx iso-week 2026-01-01`, and both print `2026-W01 4`.
