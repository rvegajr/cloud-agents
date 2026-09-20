# Request: export and import Snippet Vault as one JSON file

<!-- kind: change, on rvegajr/polya-live-snippet-vault at claude/04846696 (the R0-era build). -->

## Why
The vault lives in a SQLite file on one machine. Solved feels like: one button and one
route to get every snippet out as JSON, and a way to put that file into another vault
without duplicating what is already there.

## I will judge it by
- `GET /api/export` returns a JSON array of every snippet with all fields, and a `Content-Disposition` header so the browser saves it as a file.
- `POST /api/import` with that array adds the snippets that are not already present (same title and body) and answers with counts: added, skipped.
- Importing the same file twice adds nothing the second time.
- The page has an Export button that downloads the file and an Import control that picks a file and shows the counts.

## Wrong looks like
- An import that replaces existing snippets or renumbers their ids.
- A malformed import file that leaves the vault half-changed.

## Must not change
- Every existing route and its shape; the existing tests under `test/` pass unchanged.
- The SQLite schema.

## Not this
- No gist import, no format other than the vault's own JSON.

## Where it lives, who uses it
The existing app, run with `npm run dev`, by someone who already uses it.

## The one walk-through
I open the vault, click Export, get `snippets.json`; I open a second empty vault, Import that file, see "added 12, skipped 0"; I import again and see "added 0, skipped 12".
