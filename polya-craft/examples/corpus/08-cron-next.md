# Request: a library that says when a cron expression next fires

<!-- kind: build, a library with no CLI and no server, TypeScript, typecheck in the bar. -->

## Why
Every scheduler I write needs "next five run times for this cron line" and the packages
that do it are huge. Solved feels like: one function, typed, no dependencies.

## I will judge it by
- `next("*/15 * * * *", new Date("2026-09-20T10:07:00Z"), 3)` returns 10:15, 10:30, 10:45 UTC.
- `next("0 9 * * 1-5", ...)` skips weekends; `next("0 0 29 2 *", ...)` returns the next Feb 29.
- A bad expression (`"* * *"`, `"61 * * * *"`) throws an error naming the field, before any date is computed.
- `npm run typecheck` passes and the package exports types a consumer can import without `any`.

## Wrong looks like
- Day-of-month and day-of-week combined with AND when cron's rule is OR.
- A result in local time when the input was UTC.

## Must not change
- <nothing: the repo is empty>

## Not this
- No seconds field, no `@yearly` aliases, no time zones other than UTC, no CLI.

## Where it lives, who uses it
Node 22 or newer, TypeScript compiled with `tsc`, consumed from another project by a stranger who reads only the README and the types.

## The one walk-through
I run `npm ci && npm run build && npm test`, then in a scratch file `import { next } from "./dist/index.js"` and print the next three times for `*/15 * * * *`.
