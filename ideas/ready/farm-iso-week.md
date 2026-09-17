# ISO week

## One sentence
A CLI that prints the ISO week number for a date.

## The problem
`date +%V` is easy to forget and differs from US week numbers. Solved feels like: `iso-week 2026-09-17` → `2026-W38`.

## Must have (v1)
- Accept `YYYY-MM-DD` or default to today (UTC).
- Print `YYYY-Www` and the weekday number (1=Mon).
- Reject unparseable dates with exit 2.

## Nice to have (later)
- Range of weeks.
- Locale week start.

## Shape
- Local Node CLI, no network, no deps beyond tests.
- Tests for a known Thursday (ISO year edge) and invalid input.

## Example
`iso-week 2026-01-01` prints `2026-W01` (verify against the ISO calendar, not US weeks).
