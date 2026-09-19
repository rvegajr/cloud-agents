# PLAN

## Approach

This is a one-line repair: the catch-all branch in `src/app.js`'s request
handler answers `200 "ok"` instead of `404 "not found"`. The related
problem this borrows from is the textbook "default case of a dispatch
table" fix — the route table (`routes`) already correctly separates known
paths from unknown ones; the only defect is what the `else` branch (the
`if (handler) return handler(res)` fallthrough) sends. The method is:
write the failing regression test first (done, this turn — see Red test
below), then change exactly the one `send(...)` call in the catch-all to
the correct status and body, touching no other line, no other file, and no
route-table structure.

Deliberately not attempting: no router library, no path-normalization
logic (trailing slashes, case folding, query strings) beyond what the
existing exact-match `routes[path]` lookup already does, no change to `/`
or `/health`, no change to `test/app.test.js`, no change to
`src/server.js`, `package.json`, or `README.md`.

## Shape

- **L2 — the whole.** The app answers 404 `not found` for any path other
  than `/` and `/health`, and continues to answer `/` and `/health`
  exactly as before. Check (outer test, adopted verbatim: `npm test`,
  the project's existing quality-bar test command) — see Outer test below.
- **L1:fix-catchall** — the single group. One file, `src/app.js`, needs
  one branch changed. Closed by **U1**. Check: `npm test` exits 0 (this
  already is the L2 check; at L1 scale it is the same command because the
  whole problem is one file).

No further grouping is needed — the problem is a single-branch fix in a
single file with no other moving parts (`Not this` in PROBLEM.md rules out
new files, new dependencies, and edits to any file besides `src/app.js`).

## Red test (written this turn, by the Solver, not a Hand unit)

`test/catchall.test.js` was added in this turn. It is outside every unit's
`Touches` and must not be edited by any Hand. Confirmed red just now:

```
$ npm test
✔ GET / answers 200 home
✔ GET /health answers 200 ok
✖ GET /nope answers 404 not found
✖ GET /anything/else answers 404 not found
✖ GET /health/ (trailing slash is not an exact route match) answers 404 not found
ℹ tests 5
ℹ pass 2
ℹ fail 3
EXIT=1
```

Each failure shows `actual: { status: 200, body: 'ok' }` vs.
`expected: { status: 404, body: 'not found' }` — exactly the bug named in
PROBLEM.md.

## Outer test

A stranger, with the repo at this commit plus U1 applied, runs:

1. `npm install` — exits 0 (no dependencies to fetch; quality bar).
2. `npm test` — exits 0; output shows `tests 5`, `pass 5`, `fail 0`.
   This single command's green result is what closes **D1, D2, D3, D4,
   D5** together: `test/app.test.js` carries D3/D4/D5 (the two original
   routes and the "existing tests still pass" requirement), and
   `test/catchall.test.js` carries D1/D2 (the 404 behavior, both the
   exact reproduction path `/nope` and a second, different unmapped path
   `/anything/else`).
3. Start the app: `npm start &` (or `PORT=4571 node src/server.js &`),
   wait for the `listening on http://localhost:4571` line, then run,
   confirming each exits 0 (this replays PROBLEM.md's own Checks
   verbatim, adopted as the stranger-facing confirmation of D1–D4):
   - `test "$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/nope)" = "404"` — D1
   - `test "$(curl -s localhost:4571/nope)" = "not found"` — D1
   - `test "$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/anything/else)" = "404"` — D2
   - `test "$(curl -s localhost:4571/anything/else)" = "not found"` — D2
   - `test "$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/)" = "200"` — D3
   - `test "$(curl -s localhost:4571/)" = "home"` — D3
   - `test "$(curl -s -o /dev/null -w '%{http_code}' localhost:4571/health)" = "200"` — D4
   - `test "$(curl -s localhost:4571/health)" = "ok"` — D4
   Then stop the server: `kill %1` (or the equivalent for however it was
   started).

## Units

## U1: Fix the catch-all branch in src/app.js to answer 404 not found
Serves:   D1 D2 D3 D4 D5
Level:    L1:fix-catchall
Produces: src/app.js (modified in place)
Given:    `src/app.js` — its entire current content, verbatim, is the only
          input this unit needs (nothing else is read):
```
import { createServer } from "node:http";

/** Route table: path -> handler. Unknown paths fall through to the catch-all below. */
const routes = {
  "/": (res) => send(res, 200, "home"),
  "/health": (res) => send(res, 200, "ok"),
};

function send(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(body);
}

export function createApp() {
  return createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const handler = routes[path];
    if (handler) return handler(res);
    // catch-all
    send(res, 200, "ok");
  });
}
```
Do:
1. Open `src/app.js`.
2. Find this exact block (the last two lines inside the `createServer`
   callback):
```
    // catch-all
    send(res, 200, "ok");
```
3. Replace it with exactly:
```
    // catch-all: any path not in the route table is unknown
    send(res, 404, "not found");
```
4. Save the file. Do not change any other line in `src/app.js`.
5. Run `npm test` and confirm the output shows `tests 5`, `pass 5`,
   `fail 0`, and the command exits 0.
Touches:  src/app.js
Check:    `npm test` — now: unmet (exits 1, `pass 2`, `fail 3`, as shown
          under "Red test" above). After step 3 is applied correctly it
          must exit 0 with `pass 5`, `fail 0`. This command is outside
          Touches (it runs `test/*.test.js`, and `src/app.js` is not a
          test file).
Depends:  none
Not:      Do not edit `test/app.test.js` or `test/catchall.test.js`. Do
          not edit `src/server.js`, `package.json`, or `README.md`. Do not
          change the `routes` table, the `send` helper, the path-lookup
          logic (`new URL(req.url, "http://localhost").pathname`,
          `routes[path]`), or the responses for `/` and `/health`. Do not
          add a router library or a dependency. Do not change the 404
          body to anything other than the literal text `not found`.

## Order

U1 only — no ordering or parallelism to resolve.

## Trace

| D  | Carried by | Closed by |
|----|-----------|-----------|
| D1 | U1 (src/app.js fix), verified by `test/catchall.test.js` and outer-test curl step | U1 |
| D2 | U1 (src/app.js fix), verified by `test/catchall.test.js` and outer-test curl step | U1 |
| D3 | U1 must not regress it; verified by `test/app.test.js` and outer-test curl step | U1 |
| D4 | U1 must not regress it; verified by `test/app.test.js` and outer-test curl step | U1 |
| D5 | U1 must not regress it; verified by `npm test` (full suite, unedited `test/app.test.js`) | U1 |

```json plan
{
  "approach": "single-branch fix: catch-all send(res,200,'ok') -> send(res,404,'not found') in src/app.js",
  "shape": {
    "L2": "whole app answers 404 'not found' for any unmapped path, unchanged for / and /health",
    "L1": [ { "group": "fix-catchall", "closes": ["U1"] } ]
  },
  "outer_test": {
    "command": "npm test",
    "expect": "tests 5, pass 5, fail 0, exit 0",
    "manual_confirmation": [
      "curl -s -o /dev/null -w '%{http_code}' localhost:4571/nope == 404",
      "curl -s localhost:4571/nope == 'not found'",
      "curl -s -o /dev/null -w '%{http_code}' localhost:4571/anything/else == 404",
      "curl -s localhost:4571/anything/else == 'not found'",
      "curl -s -o /dev/null -w '%{http_code}' localhost:4571/ == 200",
      "curl -s localhost:4571/ == 'home'",
      "curl -s -o /dev/null -w '%{http_code}' localhost:4571/health == 200",
      "curl -s localhost:4571/health == 'ok'"
    ]
  },
  "units": [
    {
      "id": "U1",
      "serves": ["D1", "D2", "D3", "D4", "D5"],
      "level": "L1:fix-catchall",
      "produces": ["src/app.js"],
      "touches": ["src/app.js"],
      "depends": [],
      "check": "npm test",
      "check_now": "unmet (exit 1, pass 2, fail 3)",
      "check_after": "met (exit 0, pass 5, fail 0)"
    }
  ],
  "order": ["U1"],
  "trace": { "D1": ["U1"], "D2": ["U1"], "D3": ["U1"], "D4": ["U1"], "D5": ["U1"] }
}
```
