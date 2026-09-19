# PROBLEM

## Given

- `src/app.js` — owns the route table and the request handler, including the
  catch-all for unmatched paths. Currently: `/` → 200 "home", `/health` →
  200 "ok", any other path → 200 "ok" (the bug: the catch-all comment says
  "catch-all" but returns the same body/status as `/health`, not a 404).
- `src/server.js` — owns process start-up; imports `createApp()` from
  `src/app.js` and listens on `PORT` (default 4571). Not itself in error.
- `test/app.test.js` — owns the two existing tests ("GET / answers 200
  home", "GET /health answers 200 ok"). Both pass today and must keep
  passing unchanged.
- `package.json` — owns the scripts: `npm test` runs `node --test
  test/*.test.js`; `npm start` runs `node src/server.js`. No lint or
  typecheck script exists. No dependencies (Node's built-in `node:http`
  and `node:test` only).
- `README.md` — owns the stated shape of the app: "two routes, `/` and
  `/health`. No dependencies."
- Runtime: Node v26.7.0 (verified via `node --version` in this
  environment).
- Revision in hand: `e6a59d0` "initial: two routes, catch-all answers 200"
  on branch `claude/25874041`, working tree clean.

## Unknown

A change to `src/app.js` (and only what it takes to fix the catch-all
behavior) such that:
- any request path other than `/` and `/health` answers HTTP 404 with body
  `not found`, and
- the two existing tests in `test/app.test.js` still pass unmodified.

## Condition

- The route table for `/` and `/health` must keep answering exactly as
  today (200 "home", 200 "ok" respectively) — this is the invariant the
  existing tests already check.
- Every other path — including but not limited to `/nope` — must answer
  404 with body `not found`.
- No other file needs to change to satisfy this; `test/app.test.js` is not
  to be edited (its two tests are the acceptance floor, not the target).

## Restated

`src/app.js`'s catch-all handler for unmapped paths currently returns 200
"ok" — the same success response as the real `/health` route — instead of
signaling that the path doesn't exist. That's wrong because a client
hitting a typo'd or nonexistent path (like `/nope`) is told the request
succeeded when it didn't, which is misleading to any caller and breaks the
basic contract of an HTTP app (unknown resource → 404). The requester will
judge the fix by: `curl` on any unmapped path returns status 404 and body
`not found`, `curl` on `/` and `/health` is unchanged, and `npm test`
still reports both existing tests passing.

## Done-checks

- **D1** — `GET /nope` on the running app answers 404 with body `not
  found`. This is the reproduction; unmet today.
  Check: `test "$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/nope)" = "404"` and `test "$(curl -s localhost:4571/nope)" = "not found"`
  Now: unmet
- **D2** — Any other unmapped path (not just `/nope`) also answers 404
  with body `not found`, i.e. the fix is a general catch-all, not a
  special case for `/nope`.
  Check: `test "$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/anything/else)" = "404"` and `test "$(curl -s localhost:4571/anything/else)" = "not found"`
  Now: unmet
- **D3** — `GET /` still answers 200 with body `home`.
  Check: `test "$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/)" = "200"` and `test "$(curl -s localhost:4571/)" = "home"`
  Now: met (invariant)
- **D4** — `GET /health` still answers 200 with body `ok`.
  Check: `test "$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/health)" = "200"` and `test "$(curl -s localhost:4571/health)" = "ok"`
  Now: met (invariant)
- **D5** — The two existing tests in `test/app.test.js` pass, unmodified.
  Check: `npm test` (exits 0; both "GET / answers 200 home" and "GET
  /health answers 200 ok" report ✔)
  Now: met (invariant) — true before and must remain true after the fix.

## Not this

- Not adding new routes, new dependencies, or a router library — this is a
  one-branch fix to the existing catch-all in `src/app.js`.
- Not editing `test/app.test.js` (its tests are fixed acceptance, not
  material to change) — though a new test file may be added to exercise
  D1/D2 if useful; the problem does not require one.
- Not changing `src/server.js`, `package.json`, or `README.md`.
- Not changing the response bodies/status of `/` or `/health`.
- Not adding a 404 body other than the literal text `not found`.

## Quality bar

| Check | Command | Discovered from |
|---|---|---|
| install | `npm install` (no dependencies to fetch) | `package.json` has no `dependencies` |
| test | `npm test` | `package.json` → `scripts.test` |
| start | `npm start` | `package.json` → `scripts.start` |

No `lint` or `typecheck` script exists in `package.json`; none invented.

```json problem
{
  "given": [
    "src/app.js",
    "src/server.js",
    "test/app.test.js",
    "package.json",
    "README.md"
  ],
  "unknown": "src/app.js catch-all fixed to answer 404 'not found' for any path other than / and /health, existing tests unchanged",
  "done_checks": [
    { "id": "D1", "statement": "GET /nope answers 404 'not found'", "check": "test \"$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/nope)\" = \"404\" && test \"$(curl -s localhost:4571/nope)\" = \"not found\"", "status": "unmet" },
    { "id": "D2", "statement": "any other unmapped path answers 404 'not found'", "check": "test \"$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/anything/else)\" = \"404\" && test \"$(curl -s localhost:4571/anything/else)\" = \"not found\"", "status": "unmet" },
    { "id": "D3", "statement": "GET / still answers 200 'home'", "check": "test \"$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/)\" = \"200\" && test \"$(curl -s localhost:4571/)\" = \"home\"", "status": "met (invariant)" },
    { "id": "D4", "statement": "GET /health still answers 200 'ok'", "check": "test \"$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/health)\" = \"200\" && test \"$(curl -s localhost:4571/health)\" = \"ok\"", "status": "met (invariant)" },
    { "id": "D5", "statement": "existing tests in test/app.test.js pass unmodified", "check": "npm test", "status": "met (invariant)" }
  ],
  "not_this": [
    "new routes, dependencies, or a router library",
    "editing test/app.test.js",
    "changing src/server.js, package.json, or README.md",
    "changing / or /health response bodies/status",
    "a 404 body other than 'not found'"
  ],
  "quality_bar": {
    "install": "npm install",
    "test": "npm test",
    "start": "npm start"
  },
  "kind": "repair",
  "split": false
}
```
