# Problem: Snippet Vault

## Given

- **Repo state** — owned by this repo's working tree (`git ls-files`): two commits,
  three files (`AGENTS.md`, `QWEN.md`, `README.md`), no `package.json`, no `src/`,
  no tests. This is a greenfield build; nothing named below exists yet.
- **Contributor conventions and layout** — owned by `AGENTS.md`: TypeScript strict
  mode, Conventional Commits, one file per route under `src/routes/`, tests mirror
  `src/` under `test/`, install with `npm ci`, dev server on `$PORT` (default 3000).
  This file is still template boilerplate (placeholder prose); its command table
  and layout are the interface this build must make real, not evidence they
  already exist.
- **Orchestrator quality gate** — owned by `QWEN.md`: after every turn, a fresh
  `git clone . scratch && npm ci` must run `npm start` and get HTTP 200 (or a
  CLI's `--help` must exit 0); `npm run lint|typecheck|test|build`, whichever
  exist, must exit 0; `git ls-files` must never include `.qwen/`, `.aider*`,
  `dist/`, `build/`, `coverage/`, `node_modules/`, `*.db`, `.env`; SPEC/ROADMAP/
  REQUIREMENTS/QUALITY/DESIGN/TASKS/QA.md, lint/tsconfig/test-runner config, and
  `package.json` scripts are not to be edited; test files define done and are not
  to be edited.
- **Product request** — owned by the task description handed to this solver
  (no repo file holds it yet): a single-user, local-first web app to create,
  edit, delete, tag, and full-text-search code snippets, with copy-to-clipboard,
  SQLite persistence in the project directory, a JSON API under
  `/api/snippets`, one-command startup, and no accounts or network dependency.
  Restated below in this solver's own words, per the procedure, rather than
  copied a second time verbatim.
- **Materials location** — owned by
  `https://github.com/rvegajr/polya-live-snippet-vault`: this clone is that
  repo's `origin`; there is no additional issue/wiki content beyond the two
  seed commits already read above.

## Unknown

A Node process, started by one command after install, that:
1. serves a browser UI at a fixed local port (no accounts, no network calls
   required to function),
2. exposes a JSON HTTP API under `/api/snippets` supporting create, read,
   update, delete, and a search query, shared by the UI and by tests,
3. stores snippets (title, language, body, tags) in a SQLite file inside the
   project directory that survives a process restart,
4. returns full-text search matches across title, body, and tags as the UI
   query changes, and
5. offers a copy-to-clipboard control per snippet in the UI.

## Condition

- No user accounts, login, or external network call is required for any must-have
  behavior to work.
- The SQLite file lives under the project directory (not `/tmp`, not in-memory
  only) and is excluded from git via the existing `.gitignore` (`*.db`,
  `*.sqlite*`).
- Search must reflect the current query text without requiring a form submit
  ("updating as the user types," per the product request).
- The default port is `3000`, per `AGENTS.md`'s documented dev-server default;
  `npm start` must answer on it (per `QWEN.md`'s gate).
- The server must stay up under malformed or hostile HTTP input — it answers
  with some status, it does not exit — because a done-check that only exercises
  well-formed requests would miss the defect a blind reviewer finds first
  (Lesson L-2026-09-19-01).
- All of `AGENTS.md`'s and `QWEN.md`'s constraints apply: strict TypeScript,
  Conventional Commits, no edits to protected doc/config files or test files,
  no new runtime dependency left unexplained, clean `git ls-files`.

## Restated

Build a small local Node app where one person captures a code snippet with a
title, language, body, and tags, and gets it back by typing a few characters
into a search box — no server round trip they can see stall, no login, no
internet. Wrong looks like: search that only matches exact/whole words instead
of substrings across title/body/tags; a restart that loses data because it was
never written to disk; a copy button that copies the wrong text or nothing; or
a server that a stray `%2f` or a wrong HTTP verb can crash. The requester
judges the result by running `npm run dev` (or `npm start`), performing the
exact flow in the Example (paste a jq one-liner, tag it, save, later search
"ids", see it appear while typing, click Copy, paste it into a terminal), and
by the repo's own lint/typecheck/test/build/clean-tree gate in `QWEN.md`.

## Lessons consulted

- **L-2026-09-18-01** (name the file as owner, never paste a drifting copy) —
  *not applicable because* the product request does not yet live in any file
  this repo can read (no `SPEC.md` et al., and those are protected files this
  solver must not create); it is restated once, here, rather than duplicated
  from a second copy.
- **L-2026-09-18-02** (a done-check spanning sub-problems needs the D carried
  in every sub-plan's Trace) — *not applicable because* this problem has no
  Split; all 8 done-checks belong to one plan, so there is no second sub-plan
  to carry them into.
- **L-2026-09-18-03** (adopt an existing check verbatim instead of writing a
  parallel one) — *applied as* D8 and the Quality bar below: `QWEN.md`
  already specifies the orchestrator's lint/typecheck/test/build/fresh-clone-
  start/git-ls-files gate, so that gate is named directly rather than a new
  one invented alongside it.
- **L-2026-09-19-01** (add a done-check for malformed paths/methods; the app
  must answer, never exit) — *applied as* D7: malformed path, `%2f`, an
  oversized path, and a wrong method must each get an HTTP response, and the
  server must still answer a normal request afterward.

## Done-checks

- D1: A person can, in a browser, paste a snippet's body, title it, tag it,
  save it, restart the app, then type a partial word into the search box and
  see it appear before finishing typing, then click its Copy control and
  paste the exact body elsewhere — the full Example flow, end to end. —
  Check: a stranger performs this after `npm ci && npm run dev` (or
  `npm start`), open `http://localhost:3000/`. — Now: unmet.
- D2: The app starts with one command after install, with no account/login
  and no outbound network call needed to serve the UI or API. — Check:
  `git clone . scratch && cd scratch && npm ci && npm start & sleep 2; test "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)" = 200`.
  — Now: unmet.
- D3: `/api/snippets` supports create, read, update, and delete of a snippet
  (title, language, body, tags). — Check: `id=$(curl -s -X POST localhost:3000/api/snippets -H 'Content-Type: application/json' -d '{"title":"t","language":"jq","body":"b","tags":["jq"]}' | jq -r .id); curl -sf localhost:3000/api/snippets/$id; curl -s -X PUT localhost:3000/api/snippets/$id -H 'Content-Type: application/json' -d '{"title":"t2","language":"jq","body":"b2","tags":["jq"]}' | grep -q t2; curl -s -X DELETE -o /dev/null -w '%{http_code}' localhost:3000/api/snippets/$id | grep -Eq '200|204'; test "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/snippets/$id)" = 404`.
  — Now: unmet.
- D4: A search query against `/api/snippets` matches a substring anywhere in
  title, body, or tags, not just whole-word/exact hits. — Check: create a
  snippet with tag `jq` and body containing the word `ids`, then
  `curl -s 'localhost:3000/api/snippets?q=id' | grep -q '"id"'` and
  `curl -s 'localhost:3000/api/snippets?q=jq'` both return that snippet, while
  a query for text absent from all three fields returns it in neither list.
  — Now: unmet.
- D5: A snippet created before a restart is still readable after the process
  is stopped and started again, from a SQLite file under the project
  directory. — Check: create a snippet, `ls <projectdir>/*.db *.sqlite* 2>/dev/null`
  finds the file, stop the server, start it again, `curl -sf
  localhost:3000/api/snippets/<id>` still returns it. — Now: unmet.
- D6: Every rendered snippet has a Copy control that places its exact body on
  the clipboard. — Check: a stranger opens the UI, clicks Copy on a snippet,
  pastes into another app, and the pasted text matches the body character for
  character. — Now: unmet.
- D7: Malformed or unexpected HTTP input never crashes the server. — Check:
  `curl -s -o /dev/null -w '%{http_code}\n' localhost:3000//; curl -s -o /dev/null -w '%{http_code}\n' 'localhost:3000/api/snippets/%2f'; curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/$(python3 -c 'print("a"*2000)'); curl -s -X PATCH -o /dev/null -w '%{http_code}\n' localhost:3000/api/snippets; test "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/)" = 200`
  (process still answers the last, plain request). — Now: unmet.
- D8: The repo's own quality gate passes. — Check: `npm run lint && npm run
  typecheck && npm test && npm run build` (whichever of these exist) all exit
  0, and
  `! git ls-files | grep -E '(^|/)(\.qwen/|\.aider|dist/|build/|coverage/|node_modules/|[^/]*\.db$|\.env$)'`
  finds none of `.qwen/`, `.aider*`, `dist/`, `build/`, `coverage/`,
  `node_modules/`, `*.db`, `.env`. — Now: unmet.

## Not this

- Syntax highlighting, GitHub gist import, keyboard-only navigation, JSON
  export/import — explicitly deferred ("Nice to have (later)").
- Multi-user accounts, auth, or any hosted/network deployment.
- A rich framework-heavy frontend; a dependency-light server-rendered or
  small vanilla/JSX bundle satisfies the shape.
- Editing test files, `SPEC.md`/`ROADMAP.md`/etc., lint/tsconfig/test-runner
  config, or `package.json` scripts — `QWEN.md` reverts these.

## Quality bar

| Purpose | Command |
| --- | --- |
| Install | `npm ci` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Test | `npm test` |
| Build | `npm run build` |
| Start (fresh clone must answer 200) | `npm start` |

```json problem
{
  "kind": "build",
  "size": "M",
  "done": [
    { "id": "D1", "text": "End-to-end Example flow works in a browser: create, tag, save, restart, live search, copy.", "check": "stranger observation after `npm run dev`/`npm start`, http://localhost:3000/", "outer": true, "now": "unmet" },
    { "id": "D2", "text": "One command after install starts the app; no accounts, no network required.", "check": "`git clone . scratch && cd scratch && npm ci && npm start & sleep 2; test \"$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)\" = 200`", "outer": false, "now": "unmet" },
    { "id": "D3", "text": "`/api/snippets` supports create, read, update, delete.", "check": "curl sequence: POST then GET, PUT, DELETE, then GET returns 404", "outer": false, "now": "unmet" },
    { "id": "D4", "text": "Search matches substrings across title, body, and tags.", "check": "curl `/api/snippets?q=...` against a fixture snippet's title/body/tag substrings", "outer": false, "now": "unmet" },
    { "id": "D5", "text": "Data persists across a restart via a SQLite file in the project directory.", "check": "create, confirm db file on disk, restart process, GET still returns it", "outer": false, "now": "unmet" },
    { "id": "D6", "text": "Every snippet has a working copy-to-clipboard control.", "check": "stranger observation: click Copy, paste elsewhere, text matches body exactly", "outer": false, "now": "unmet" },
    { "id": "D7", "text": "Malformed HTTP input (`//`, `%2f`, oversized path, wrong method) never crashes the server.", "check": "curl sequence of malformed requests, then a normal request still answers 200", "outer": false, "now": "unmet" },
    { "id": "D8", "text": "Repo quality gate passes: lint/typecheck/test/build exit 0; git ls-files stays clean of ignored artifacts.", "check": "`npm run lint && npm run typecheck && npm test && npm run build`; `! git ls-files | grep -E '(^|/)(\\.qwen/|\\.aider|dist/|build/|coverage/|node_modules/|[^/]*\\.db$|\\.env$)'`", "outer": false, "now": "unmet" }
  ],
  "lessons": [
    { "id": "L-2026-09-18-01", "disposition": "not applicable because the product request lives in no repo file yet (protected files may not be created), so it is restated once rather than copied from a second file" },
    { "id": "L-2026-09-18-02", "disposition": "not applicable because there is no Split; all 8 done-checks belong to a single plan" },
    { "id": "L-2026-09-18-03", "disposition": "applied as D8 and the Quality bar: QWEN.md's orchestrator gate is adopted verbatim, not re-specified" },
    { "id": "L-2026-09-19-01", "disposition": "applied as D7: malformed path/method/oversized-path checks, server must answer and keep answering" }
  ],
  "split": [],
  "bar": [
    { "purpose": "Install", "command": "npm ci" },
    { "purpose": "Lint", "command": "npm run lint" },
    { "purpose": "Typecheck", "command": "npm run typecheck" },
    { "purpose": "Test", "command": "npm test" },
    { "purpose": "Build", "command": "npm run build" },
    { "purpose": "Start", "command": "npm start" }
  ]
}
```
