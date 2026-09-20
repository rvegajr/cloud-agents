# Request: a key-value HTTP API with expiry, no UI

<!-- kind: build, API only, Node built-ins, persistence to a file. -->

## Why
I keep writing the same ten-line "share a value between two scripts" server. Solved feels
like: one process, four routes, values that expire on their own, and it survives a restart.

## I will judge it by
- `PUT /kv/color` with body `blue` then `GET /kv/color` returns `blue` with status 200.
- `PUT /kv/tmp?ttl=1` then, two seconds later, `GET /kv/tmp` returns 404.
- After `kill` and restart, `GET /kv/color` still returns `blue`.
- `DELETE /kv/color` returns 204 and a second `DELETE` returns 404.
- `GET /kv` lists the live keys as a JSON array, expired ones excluded.

## Wrong looks like
- A key with a space or a slash in it corrupts the store or another key.
- A body over 1 MB is stored instead of refused with 413.
- The store file is written on every request, so a loop of 1000 PUTs takes more than a few seconds.

## Must not change
- The port is 8787 unless `PORT` is set.

## Not this
- No auth, no clustering, no dependencies, no UI.

## Where it lives, who uses it
Node 22 or newer, macOS and Linux, a stranger with `curl` from a fresh clone after `npm ci`.

## The one walk-through
I run `npm ci && npm start`, then `curl -X PUT -d blue localhost:8787/kv/color` and `curl localhost:8787/kv/color` prints `blue`.
