# Problem: Snippet Vault — local-first code-snippet search
Kind: build
Size: M

<!-- Understand only. No plan text. See PATTERN.md section 2.1. -->

## Given

- **Repo state** — owned by this repo's working tree (`git ls-files`, `git log
  --oneline --all`): three commits (`Initial commit`, `chore: seed agent kit`,
  `polya: remove the kit's seeded AGENTS.md and QWEN.md; the prompts carry the
  rules`); the tree today holds only `README.md` (one line, the repo name) and
  `.gitignore`. No `package.json`, no `src/`, no tests, no `AGENTS.md`, no
  `QWEN.md` — the kit's usual convention/gate files were seeded then
  deliberately removed for this run. This is a greenfield build; nothing named
  below exists yet, and no repo file states language, layout, or command
  conventions.
- **Ignore rules** — owned by `.gitignore`: `node_modules/`, `dist/`,
  `build/`, `coverage/`, `*.db`, `*.sqlite`, `*.sqlite3`, `.env`, `.qwen/`,
  `.aider*`, `.cursor/worktrees/`. `*.db` covers a SQLite main file but not a
  default-journal-mode sidecar (`<name>.db-journal`), which does not match any
  listed pattern.
- **Materials location** — owned by
  `https://github.com/rvegajr/polya-live-sv-r0`: `git remote -v` confirms this
  clone's `origin` is that repo; no issue/wiki content beyond the three seed
  commits already read above.
- **Product idea** — owned by the task description handed to this solver (no
  repo file holds it): a single-user, local-first web app to create, edit,
  delete, tag, and full-text-search code snippets, with copy-to-clipboard,
  SQLite persistence inside the project directory, a JSON API under
  `/api/snippets` shared by UI and tests, one-command startup after install,
  no accounts and no network dependency. Its Example names the exact command
  `npm run dev`. Restated below in this solver's own words rather than pasted
  a second time.
- **Build environment** — owned by the machine that will run the checks
  (`node --version`, `npm --version` here): Node v26.7.0, npm 11.19.0. Any
  SQLite approach chosen later must declare an `engines.node` minimum that is
  actually verified to work unflagged, not merely assumed from this machine's
  version.

## Unknown

A Node process, started by one command after install (`npm run dev`, per the
Example), that:
1. serves a browser UI at a fixed local port, with no accounts, login, or
   network call required for any must-have behavior,
2. exposes a JSON HTTP API under `/api/snippets` supporting create, read,
   update, delete, and a search query, used by both the UI and the tests,
3. stores snippets (title, language, body, tags) in a SQLite file inside the
   project directory that survives a process restart, with every file SQLite
   writes beside it excluded from git,
4. returns full-text search matches (substrings, not just whole words) across
   title, body, and tags as the UI query text changes, with no submit step,
5. offers a copy-to-clipboard control per snippet in the UI that places the
   snippet's exact body on the clipboard, and
6. keeps an edited snippet's untouched fields byte-identical after a save,
   and shows the user a visible error when a save fails, rather than
   discarding the edit silently.

## Condition

- No user accounts, login, or outbound network call is required for any
  must-have behavior to work.
- The SQLite file lives under the project directory (not `/tmp`, not
  in-memory only); it and every sidecar file its journal mode writes are
  excluded from git — `.gitignore`'s `*.db` alone does not cover a
  `-journal` sidecar, so whatever mode is chosen must be checked the same
  way, not assumed safe because the option once considered (WAL) was
  rejected for the same reason.
- Search reflects the current query text without a form submit ("updating as
  the user types," per the product idea), and matches substrings, not only
  exact/whole-word hits, across title, body, and tags.
- The app answers on a fixed local port via the exact command the idea names,
  `npm run dev`; there is no other file in this repo naming a different
  default command or port, so this build establishes both.
- The server stays up under malformed or hostile HTTP input — it answers
  with some status, it does not exit — because a done-check exercising only
  well-formed requests would miss the defect a blind reviewer finds first.
- The tag/edit form's text format and the API's parser must agree: any value
  the API accepts (commas inside a tag, extra whitespace, mixed case) must
  survive an edit-form open-then-save with no field changed, unchanged.
- A save that fails (server error, stale response) must be visible to the
  user in the UI, not silently swallowed or reset.
- Since no `AGENTS.md`/`QWEN.md` survives in this repo, no external gate
  dictates language, lint, or typecheck; this build sets and must document
  its own install/start/test commands, discoverable once it exists.

## Restated

Build a small local Node app where one person captures a code snippet — a
title, a language, a body, and tags — and gets it back by typing a few
characters into a search box, with no login and no internet, started by
`npm run dev`. Wrong looks like: search that only matches exact/whole words
instead of substrings across title, body, and tags; a restart that loses data
because it was never written to disk, or leaves an untracked `-journal` file
in git status; a copy button that copies the wrong text or nothing; an edit
that quietly rewrites fields nobody touched; a failed save the user can't
tell happened; or a server a stray `%2f` or a wrong HTTP verb can crash. The
requester judges the result by running `npm run dev`, performing the exact
flow in the Example (paste a jq one-liner, title and tag it, save, restart,
search "ids" and see it appear while typing, click Copy, paste it into a
terminal), and by whatever install/test commands this build documents for
itself, since none exist yet.

## Done-check

- D1: A person can, in a browser, paste a snippet's body, title it, tag it,
  save it, restart the app, then type a partial word into the search box and
  see it appear before finishing typing, then click its Copy control and
  paste the exact body elsewhere — the full Example flow, end to end. —
  Check: a stranger performs this after `npm ci && npm run dev`, opening
  `http://localhost:3000/` (this build's own documented default port/URL). —
  Now: unmet.
- D2: The app starts with one command after install — the exact command the
  idea names — with no account/login and no outbound network call needed to
  serve the UI or API. — Check: `git clone . scratch && cd scratch && npm ci
  && npm run dev & sleep 2; test "$(curl -s -o /dev/null -w '%{http_code}'
  http://localhost:3000/)" = 200`. — Now: unmet.
- D3: `/api/snippets` supports create, read, update, and delete of a snippet
  (title, language, body, tags). — Check: `id=$(curl -s -X POST
  localhost:3000/api/snippets -H 'Content-Type: application/json' -d
  '{"title":"t","language":"jq","body":"b","tags":["jq"]}' | jq -r .id);
  curl -sf localhost:3000/api/snippets/$id; curl -s -X PUT
  localhost:3000/api/snippets/$id -H 'Content-Type: application/json' -d
  '{"title":"t2","language":"jq","body":"b2","tags":["jq"]}' | grep -q t2;
  curl -s -o /dev/null -w '%{http_code}' -X DELETE
  localhost:3000/api/snippets/$id | grep -Eq '200|204'; test "$(curl -s -o
  /dev/null -w '%{http_code}' localhost:3000/api/snippets/$id)" = 404`. —
  Now: unmet.
- D4: A search query against `/api/snippets` matches a substring anywhere in
  title, body, or tags, not just whole-word/exact hits, and a query for text
  absent from all three returns neither fixture. — Check: create a snippet
  with tag `jq` and body containing the word `ids`; `curl -s
  'localhost:3000/api/snippets?q=id'` and `curl -s
  'localhost:3000/api/snippets?q=jq'` both return it; a query for an absent
  string returns it in neither. — Now: unmet.
- D5: A snippet created before a restart is still readable after the process
  is stopped and restarted, from a SQLite file inside the project directory,
  and neither that file nor any sidecar it writes shows up in `git status`.
  — Check: create a snippet, confirm a `*.db`/`*.sqlite*` file exists under
  the project directory, stop the server, start it again, `curl -sf
  localhost:3000/api/snippets/<id>` still returns it; `git status
  --porcelain` shows nothing for the db file or any `-journal`/`-wal`/`-shm`
  sidecar it created. — Now: unmet.
- D6: Every rendered snippet has a Copy control that places its exact body on
  the clipboard. — Check: a stranger opens the UI, clicks Copy on a snippet,
  pastes into another app, and the pasted text matches the body character for
  character. — Now: unmet.
- D7: Malformed or unexpected HTTP input never crashes the server; it keeps
  answering afterward. — Check: `curl -s -o /dev/null -w '%{http_code}\n'
  localhost:3000//; curl -s -o /dev/null -w '%{http_code}\n'
  'localhost:3000/api/snippets/%2f'; curl -s -o /dev/null -w '%{http_code}\n'
  localhost:3000/$(python3 -c 'print("a"*2000)'); curl -s -X PATCH -o
  /dev/null -w '%{http_code}\n' localhost:3000/api/snippets; test "$(curl -s
  -o /dev/null -w '%{http_code}' localhost:3000/)" = 200` (the last, plain
  request still answers). — Now: unmet.
- D8: Editing a snippet without touching a field leaves every field
  byte-identical, even when a tag contains a comma or extra whitespace the
  edit form must format and re-parse; and a failed save shows the user a
  visible error instead of silently discarding the edit. — Check: (a) `curl
  -s -X POST localhost:3000/api/snippets -H 'Content-Type: application/json'
  -d '{"title":"t","language":"jq","body":"b","tags":["two
  words","c,d","Go"]}'`, open it in the edit UI, click Save with nothing
  changed, then `curl -s localhost:3000/api/snippets/<id>` shows
  `tags` still exactly `["two words","c,d","Go"]`. (b) a stranger stops the
  server (or blocks the network) mid-edit and clicks Save in the UI; the page
  shows a visible error rather than resetting or losing the edit. — Now:
  unmet.

## Not this

- Syntax highlighting, GitHub gist import, keyboard-only navigation, JSON
  export/import — explicitly deferred ("Nice to have (later)").
- Multi-user accounts, auth, or any hosted/network deployment.
- A rich framework-heavy frontend; a dependency-light server-rendered or
  small vanilla/JSX bundle satisfies the shape.
- Inventing lint/typecheck/CI conventions this repo does not declare; this
  build documents its own, it does not fabricate someone else's.

## Lessons consulted

- **L-2026-09-18-01** (name the file as owner, never paste a drifting copy)
  — *not applicable because* the product idea lives in no repo file this
  solver or the Hand can read (no `SPEC.md` et al. exist, and none is a file
  this build is asked to create for that purpose); it is restated once, here,
  rather than copied from a second file.
- **L-2026-09-18-02** (a done-check spanning sub-problems needs the D carried
  in every sub-plan's Trace) — *not applicable because* this problem has no
  Split; all 8 done-checks belong to one plan.
- **L-2026-09-18-03** (adopt an existing check verbatim instead of writing a
  parallel one) — *not applicable because* this repo has no `QWEN.md` or
  other existing inspection/CI file to adopt (removed on purpose for this
  run, per commit `fea42e7`); the Quality bar below is authored fresh, not
  copied from a repo-owned gate.
- **L-2026-09-19-01** (add a done-check for malformed paths/methods; the app
  must answer, never exit) — *applied as* D7: `//`, `%2f`, an oversized
  path, and a wrong method must each get an HTTP response, and the server
  must still answer a normal request afterward.
- **L-2026-09-19-02** (pin `engines.node` to the exact version verified to
  work unflagged, not just the version it first appeared behind a flag) —
  *applied as* a Condition: whichever SQLite access this build chooses, its
  `engines.node` must match a minimum this solver actually installs and
  tests against, not this machine's Node v26.7.0 by assumption. Not written
  as its own D because verifying an alternate installed Node version is a
  Devise/Carry-out action, not something a stranger checks against this
  problem statement alone.
- **L-2026-09-19-03** (a unit's Check must prove only its Touches changed,
  via file hash and clean `git status`) — *not applicable because* this
  stage produces no unit Do/Check; it concerns how the Devise stage builds
  each unit's Check, which has not happened yet.
- **L-2026-09-19-04** (test that every value the API accepts survives the
  edit page's format-and-parse round trip) — *applied as* D8(a): tags with a
  comma inside one tag and extra spacing must round-trip unchanged through
  an untouched edit-then-save.
- **L-2026-09-19-05** (test a page's failure-state wiring against a fake
  window/fetch, not just its exported helpers) — *applied as* D8(b): a
  failed save must be visible to the user, checked by actually forcing the
  save to fail, not just by reading the code that claims to handle it.
- **L-2026-09-19-08** (put the exact command the idea names in a done-check;
  a sibling command sharing its code path does not prove it) — *applied as*
  D1 and D2: both use `npm run dev` verbatim, the command the Example names,
  not a substitute like `npm start`.
- **L-2026-09-19-09** (check a kept storage option's side files the same way
  a rejected option was checked) — *applied as* D5: the restart/persistence
  check also asserts that any `-journal`/`-wal`/`-shm` sidecar the chosen
  journal mode writes is absent from `git status`, not only the `*.db` file
  itself.

## Quality bar
<!-- Software only. No package.json exists yet; these are the commands this
build must establish and document, per the Example and the idea's shape
("Runs with one command after install"). Nothing here is discovered from an
existing script — none exists — and nothing beyond install/test/dev is
asserted, since no lint/typecheck convention survives in this repo. -->
| Purpose | Command |
| --- | --- |
| Install | `npm ci` |
| Dev/start (the Example's exact command) | `npm run dev` |
| Test | `npm test` |

```json problem
{
  "kind": "build",
  "size": "M",
  "done": [
    { "id": "D1", "text": "End-to-end Example flow works in a browser: create, tag, save, restart, live search, copy.", "check": "stranger observation after `npm ci && npm run dev`, http://localhost:3000/", "outer": true, "now": "unmet" },
    { "id": "D2", "text": "One command (`npm run dev`, the idea's exact command) starts the app after install; no accounts, no network required.", "check": "`git clone . scratch && cd scratch && npm ci && npm run dev & sleep 2; test \"$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)\" = 200`", "outer": false, "now": "unmet" },
    { "id": "D3", "text": "`/api/snippets` supports create, read, update, delete.", "check": "curl sequence: POST then GET, PUT, DELETE, then GET returns 404", "outer": false, "now": "unmet" },
    { "id": "D4", "text": "Search matches substrings across title, body, and tags; absent text matches neither fixture.", "check": "curl `/api/snippets?q=...` against a fixture snippet's title/body/tag substrings and an absent string", "outer": false, "now": "unmet" },
    { "id": "D5", "text": "Data persists across a restart via a SQLite file in the project directory; the db file and every sidecar it writes stay out of git.", "check": "create, confirm db file on disk, restart process, GET still returns it; `git status --porcelain` clean of the db file and any -journal/-wal/-shm sidecar", "outer": false, "now": "unmet" },
    { "id": "D6", "text": "Every snippet has a working copy-to-clipboard control.", "check": "stranger observation: click Copy, paste elsewhere, text matches body exactly", "outer": false, "now": "unmet" },
    { "id": "D7", "text": "Malformed HTTP input (`//`, `%2f`, oversized path, wrong method) never crashes the server.", "check": "curl sequence of malformed requests, then a normal request still answers 200", "outer": false, "now": "unmet" },
    { "id": "D8", "text": "Editing without changing a field leaves all fields byte-identical, even tags with commas/whitespace; a failed save is visibly shown to the user.", "check": "(a) POST a snippet with tags [\"two words\",\"c,d\",\"Go\"], open+save unchanged in the edit UI, GET confirms tags unchanged; (b) force a save to fail (server stopped/network blocked) and observe a visible error in the UI", "outer": false, "now": "unmet" }
  ],
  "lessons": [
    { "id": "L-2026-09-18-01", "applied": false, "how": "not applicable because the product idea lives in no repo file the Hand can read; restated once here rather than copied from a second file" },
    { "id": "L-2026-09-18-02", "applied": false, "how": "not applicable because there is no Split; all 8 done-checks belong to a single plan" },
    { "id": "L-2026-09-18-03", "applied": false, "how": "not applicable because this repo has no existing QWEN.md/inspection file to adopt (removed on purpose for this run); the Quality bar is authored fresh" },
    { "id": "L-2026-09-19-01", "applied": true, "how": "D7: malformed path/method/oversized-path checks, server must answer and keep answering" },
    { "id": "L-2026-09-19-02", "applied": true, "how": "Condition: engines.node must be pinned to a version actually verified to work unflagged, not assumed from this machine's Node" },
    { "id": "L-2026-09-19-03", "applied": false, "how": "not applicable because this stage writes no unit Do/Check; it concerns the Devise stage's unit construction, not yet reached" },
    { "id": "L-2026-09-19-04", "applied": true, "how": "D8(a): tags with a comma and extra whitespace must round-trip unchanged through an untouched edit-then-save" },
    { "id": "L-2026-09-19-05", "applied": true, "how": "D8(b): a failed save must be visibly shown to the user, verified by forcing the failure, not by reading the handling code" },
    { "id": "L-2026-09-19-08", "applied": true, "how": "D1 and D2 use `npm run dev` verbatim, the exact command the Example names" },
    { "id": "L-2026-09-19-09", "applied": true, "how": "D5 checks the chosen journal mode's sidecar files (-journal/-wal/-shm) are git-ignored, the same way the rejected option would have been checked" }
  ],
  "split": [],
  "bar": { "install": "npm ci", "dev": "npm run dev", "test": "npm test" }
}
```
