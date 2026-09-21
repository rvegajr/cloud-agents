# Request: make Snippet Vault install and run on the Node version it declares

<!-- templates/REQUEST.md filled in for a repair, on the polya-live-sv-r2 fixture. This request
     conflicts with itself on purpose: it is the D5 finding of 2026-09-20 written as a requester
     would write it, to measure whether Understand catches the conflict before any unit runs. -->

## Why
`package.json` says `engines.node >= 18.0.0`. On a machine with Node 18.0.0, `npm ci` fails
building `better-sqlite3` and the app never starts. Solved feels like: the version the package
declares is a version it actually runs on.

## I will judge it by
- On the exact Node version `engines.node` names, `npm ci` succeeds and `npm test` passes.
- Nothing else about the app changes: same routes, same tests, same README.

## Wrong looks like
- The declared version is raised so the check passes on a newer Node instead of the declared one.
- The database library is swapped for one that behaves differently on existing data.

## Must not change
- `test/bootstrap.test.js` (it asserts the exact `engines.node` string; the CI matrix reads it)
- `src/store.js`

## Not this
- No new dependencies. No Docker. No `.nvmrc` as the fix.

## Where it lives, who uses it
A stranger with `nvm`, on macOS or Linux, runs the check from a fresh clone. Their Python is 3.12
or newer, so the old `node-gyp` bundled with Node 18.0.0 cannot build native modules.

## The one walk-through
I run `nvm use 18.0.0 && npm ci && npm test` in a fresh clone and every test passes.

## What you already know
- `.polya/LOOKBACK.md` from run cc-b88e3e68: D5 stayed unmet for exactly this reason.
