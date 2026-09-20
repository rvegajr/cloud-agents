# Plan for: Snippet Vault — local-first code-snippet search

<!-- Devise only. Every unit must pass the stranger test before this plan is handed over.
     See PATTERN.md sections 2.2 and 3. -->

## Approach

Build bottom-up in strict layers so each layer's correctness is provable in
isolation before the next stacks on it: data (SQLite), then transport (HTTP
API + static files), then client logic (`app.js`), then the client shell
(`index.html`, `styles.css`). No unit's test depends on a unit above it —
`test/db.test.js` never imports `src/server.js`; `test/app.test.js` never
imports `src/server.js` or touches a browser DOM.

Every file below was written by this solver and verified green, in this
exact session, in a scratch directory outside the repo, on this machine's
Node v26.7.0: `npm ci`, `npm test` (16/16 passing), a live `node src/server.js`
answering `curl` for create/read/update/delete/search, and a deliberate
mutation of the `if (!res.ok)` save guard in `app.js` that turned the
"failed save shows a visible error" test red and was then reverted — proving
that test actually exercises the wiring, not just its exported helpers (per
Lesson L-2026-09-19-05). The units below hand that verified content over
verbatim; the Hand's job is to place each file at its path, not invent logic.
Per Lesson L-2026-09-19-03, each unit's Check also compares its file(s)
against a sha256 recorded here and asserts `git status --porcelain` names
only that unit's own Touches, so a passing behavioural test can't hide a
transcription slip or a stray extra file.

Related problem this borrows from: a minimal CRUD service with a bundled
static frontend, solved the same way every time — store, then routes, then
page.

Deliberately not attempting:
- Syntax highlighting, gist import, keyboard-only nav, JSON export/import —
  deferred in PROBLEM.md's "Not this."
- A frontend framework or bundler — one static HTML page and one vanilla
  `app.js`, per the "dependency-light" shape.
- A native SQLite binding (`better-sqlite3`) or a lint/typecheck toolchain —
  PROBLEM.md's Quality bar names only install/dev/test, and no repo file
  survives to dictate TypeScript or ESLint conventions. The built-in
  `node:sqlite` module (`DatabaseSync`) was verified in this session to
  work with **no flag** on this machine's Node v26.7.0; `engines.node` is
  pinned to `>=24.0.0`, a conservative point well past every version where
  `node:sqlite` needed `--experimental-sqlite` (Lesson L-2026-09-19-02).
  This solver could not install an alternate, older Node in this
  environment to test the boundary itself — only v26.7.0 is available here
  — so `>=24.0.0` is a documented, deliberately conservative choice, not a
  verified-exact minimum; this limitation is recorded rather than hidden.
- Any runtime npm dependency: the built app has **zero** entries in
  `dependencies`, using only `node:http`, `node:fs`, `node:path`,
  `node:crypto`, and `node:sqlite`. This removes native-module compilation
  and registry flakiness from the one-command install entirely.

## Shape

`L2` — the whole app. Its check is the Outer test below, run against a
fresh clone.

`L1` groups, each with a check, each realized by one or two units:

| Group | Unit(s) | Check |
| --- | --- | --- |
| `L1:tooling` | U1 | `npm ci` exits 0 |
| `L1:data` | U2 | `node --test test/db.test.js` green |
| `L1:ui-logic` | U3 | `node --test test/app.test.js` green |
| `L1:api` | U4 | `node --test test/server.test.js` green |
| `L1:ui-shell` | U5, U6 | `node --test test/index-html.test.js test/static-assets.test.js` green |

## Outer test

A stranger, against a fresh clone of this repo:

1. **(D2)** `rm -rf /tmp/sv-clone && git clone . /tmp/sv-clone && cd /tmp/sv-clone && npm ci && (npm run dev &)`, then poll
   `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` every
   second for up to 15s. It reaches `200` with no account, login, or
   outbound network call made by the app itself.
2. **(D3)** `curl -X POST localhost:3000/api/snippets -H 'Content-Type: application/json' -d '{"title":"t","language":"jq","body":"b","tags":["jq"]}'`
   returns 201 with an `id`; `GET /api/snippets/<id>` returns it; `PUT` with
   a changed body returns 200 with the change; `DELETE` returns 200; a
   subsequent `GET` returns 404.
3. **(D4)** Create a snippet titled "Extract ids from array", body
   `jq ".[].id" file.json`, tags `jq` and `shell`. `GET /api/snippets?q=id`,
   `?q=jq`, and `?q=extract` each include it; `?q=zzz-nomatch-zzz` does not.
4. **(D5)** `ls /tmp/sv-clone/snippets.db` finds the file. Stop the server
   (`kill $(lsof -ti :3000)`), confirm `curl` now fails to connect, run
   `(npm run dev &)` again in the same directory, poll for `200` as in step
   1, then `GET /api/snippets/<id>` from step 2 or 3 still returns the
   snippet; `git status --porcelain` inside `/tmp/sv-clone` shows nothing
   for `snippets.db` or any `-journal`/`-wal`/`-shm` sidecar.
5. **(D1)** In a browser at `http://localhost:3000/`: paste a jq one-liner
   into the body field, title it "Extract ids from array", tag it (one tag
   per line) `jq` then `shell`, click "Save snippet". Restart the server as
   in step 4. Type `ids` into the search box and watch the snippet appear
   in the results before finishing typing — no submit, no full page reload.
6. **(D6)** On that same rendered result, click Copy, then paste into
   another application (a terminal, a text editor). The pasted text matches
   the snippet's body character for character.
7. **(D7)** `curl localhost:3000//`, `curl localhost:3000/api/snippets/%2f`,
   `curl "localhost:3000/$(python3 -c 'print("a"*2000)')"`, and
   `curl -X PATCH localhost:3000/api/snippets` each return some HTTP status
   (the process does not exit); a following plain
   `curl -o /dev/null -w '%{http_code}' localhost:3000/api/snippets` still
   returns `200`.
8. **(D8)** Click Edit on the snippet from step 5, click Save without
   changing any field, then confirm via `GET /api/snippets/<id>` its tags
   are still exactly `jq` and `shell` (not merged or reordered). Then, with
   the server stopped, click Edit and Save again in the still-open browser
   tab — the page shows a visible error on that snippet's card instead of
   silently resetting or losing the edit.

## Units

### U1: Scaffold the project's tooling
Serves:   D2
Level:    L1:tooling
Produces: `package.json`, `package-lock.json`
Given:    PROBLEM.md's Quality bar (install `npm ci`, dev `npm run dev`,
          test `npm test`) and Condition (`engines.node` pinned per Lesson
          L-2026-09-19-02, see Approach above). Nothing else is read; no
          `src/` or `public/` file exists yet.
Do:
1. Create `package.json` with exactly this content:
   ```json
   {
     "name": "snippet-vault",
     "version": "1.0.0",
     "private": true,
     "description": "Local-first code snippet search",
     "main": "src/server.js",
     "engines": {
       "node": ">=24.0.0"
     },
     "scripts": {
       "dev": "node --watch src/server.js",
       "start": "node src/server.js",
       "test": "node --test"
     }
   }
   ```
2. Create `package-lock.json` with exactly this content:
   ```json
   {
     "name": "snippet-vault",
     "version": "1.0.0",
     "lockfileVersion": 3,
     "requires": true,
     "packages": {
       "": {
         "name": "snippet-vault",
         "version": "1.0.0",
         "engines": {
           "node": ">=24.0.0"
         }
       }
     }
   }
   ```
Touches:  `package.json`, `package-lock.json`
Check:    `node -e "const c=require('crypto'),f=require('fs');const want={'package.json':'6f178f3bffff1b9078cbdb60c406ffeeb9700f5d839dc88ece1e550eb90aa520','package-lock.json':'0a5f8a388e7560b79b62c3ee759b93eab3fc3499b63a87d6cfb93e013bb51fb0'};for(const p of Object.keys(want)){const got=c.createHash('sha256').update(f.readFileSync(p)).digest('hex');if(got!==want[p]){console.error(p,'sha256 mismatch');process.exit(1);}}" && npm ci && test "$(git status --porcelain -uall | awk '{print $2}' | sort)" = "$(printf '%s\n' package-lock.json package.json | sort)"`
          — exits 0 when met — Now: unmet (neither file exists; `npm ci`
          fails today with "no such file or directory, open package.json").
Depends:  none
Not:      Do not add any `dependencies` or `devDependencies`. Do not create
          `src/`, `public/`, or `.gitignore` files, and do not edit
          `test/*.test.js`.

### U2: Write the SQLite data layer
Serves:   D3, D4, D5, D8
Level:    L1:data
Produces: `src/db.js`
Given:    `test/db.test.js` (already in the repo, do not edit it) is the
          contract this file must satisfy. No other file is read; `src/db.js`
          is new.
          ```
          openDb(dbPath) -> DatabaseSync connection, creates the `snippets`
            table if absent
          createSnippet(db, {title, language, body, tags}) -> snippet
          getSnippet(db, id) -> snippet | null
          updateSnippet(db, id, {title, language, body, tags}) -> snippet | null
          deleteSnippet(db, id) -> boolean
          listSnippets(db, query) -> snippet[]  (substring match on title,
            body, or any tag; case-insensitive; query='' or undefined
            returns all, newest updated_at first)
          snippet shape: { id, title, language, body, tags: string[],
            createdAt, updatedAt }
          ```
Do:
1. Create `src/db.js` with exactly this content:
   ```js
   'use strict';

   const { DatabaseSync } = require('node:sqlite');
   const crypto = require('node:crypto');

   function openDb(dbPath) {
     const db = new DatabaseSync(dbPath);
     db.exec(`
       CREATE TABLE IF NOT EXISTS snippets (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         language TEXT NOT NULL,
         body TEXT NOT NULL,
         tags TEXT NOT NULL,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )
     `);
     return db;
   }

   function rowToSnippet(row) {
     return {
       id: row.id,
       title: row.title,
       language: row.language,
       body: row.body,
       tags: JSON.parse(row.tags),
       createdAt: row.created_at,
       updatedAt: row.updated_at,
     };
   }

   function createSnippet(db, input) {
     const id = crypto.randomUUID();
     const now = new Date().toISOString();
     const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
     db.prepare(
       'INSERT INTO snippets (id, title, language, body, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
     ).run(
       id,
       String(input.title || ''),
       String(input.language || ''),
       String(input.body || ''),
       JSON.stringify(tags),
       now,
       now
     );
     return getSnippet(db, id);
   }

   function getSnippet(db, id) {
     const row = db.prepare('SELECT * FROM snippets WHERE id = ?').get(id);
     return row ? rowToSnippet(row) : null;
   }

   function updateSnippet(db, id, input) {
     const existing = getSnippet(db, id);
     if (!existing) return null;
     const tags = Array.isArray(input.tags) ? input.tags.map(String) : existing.tags;
     const title = input.title !== undefined ? String(input.title) : existing.title;
     const language = input.language !== undefined ? String(input.language) : existing.language;
     const body = input.body !== undefined ? String(input.body) : existing.body;
     const now = new Date().toISOString();
     db.prepare(
       'UPDATE snippets SET title = ?, language = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?'
     ).run(title, language, body, JSON.stringify(tags), now, id);
     return getSnippet(db, id);
   }

   function deleteSnippet(db, id) {
     const result = db.prepare('DELETE FROM snippets WHERE id = ?').run(id);
     return result.changes > 0;
   }

   function listSnippets(db, query) {
     const rows = db.prepare('SELECT * FROM snippets ORDER BY updated_at DESC, id DESC').all();
     const snippets = rows.map(rowToSnippet);
     if (!query) return snippets;
     const q = String(query).toLowerCase();
     return snippets.filter(
       (s) =>
         s.title.toLowerCase().includes(q) ||
         s.body.toLowerCase().includes(q) ||
         s.tags.some((t) => t.toLowerCase().includes(q))
     );
   }

   module.exports = {
     openDb,
     createSnippet,
     getSnippet,
     updateSnippet,
     deleteSnippet,
     listSnippets,
   };
   ```
Touches:  `src/db.js`
Check:    `node -e "const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('src/db.js')).digest('hex');if(h!=='de44be22a0289be633bc5446620ab0fe3fa8f0e77ef7492c6bb736397708f5a7'){console.error('sha256 mismatch');process.exit(1);}" && node --test test/db.test.js && test "$(git status --porcelain -uall | awk '{print $2}' | sort)" = "src/db.js"`
          — exits 0 when met — Now: unmet (`src/db.js` does not exist;
          `node --test test/db.test.js` fails with `Cannot find module
          '../src/db.js'`).
Depends:  none
Not:      Do not edit `test/db.test.js`. Do not create `src/server.js` or
          any file under `public/`.

### U3: Write the client logic
Serves:   D1, D6, D8
Level:    L1:ui-logic
Produces: `public/app.js`
Given:    `test/app.test.js` (already in the repo, do not edit it) is the
          contract this file must satisfy. No other file is read;
          `public/app.js` is new. It must define, and export via
          `module.exports` when `module` exists (Node) while still running
          standalone in a browser (`typeof module === 'undefined'`):
          `start(win)`, `formatTagsForEditing(tags)`,
          `parseTagsFromText(text)`, `matchesQuery(snippet, query)`. `win`
          carries `.document` (with `getElementById`), `.fetch`, and
          `.navigator`. It must read these element ids from `win.document`
          (which `public/index.html`, produced later, will provide):
          `create-form`, `create-title`, `create-language`, `create-body`,
          `create-tags`, `create-error`, `search-input`, `snippet-list`, and
          per snippet id `s`: `card-s`, `body-s`, `error-s`,
          `edit-title-s`, `edit-language-s`, `edit-body-s`, `edit-tags-s`.
          Buttons carry `data-action` (`copy`|`edit`|`cancel`|`delete`|`save`)
          and `data-id`.
Do:
1. Create `public/app.js` with exactly this content:
   ```js
   'use strict';

   function formatTagsForEditing(tags) {
     return (tags || []).join('\n');
   }

   function parseTagsFromText(text) {
     return String(text || '')
       .split('\n')
       .map((line) => line.trim())
       .filter((line) => line.length > 0);
   }

   function escapeHtml(value) {
     return String(value)
       .replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;')
       .replace(/"/g, '&quot;');
   }

   function matchesQuery(snippet, query) {
     const q = String(query || '').toLowerCase();
     if (!q) return true;
     return (
       snippet.title.toLowerCase().includes(q) ||
       snippet.body.toLowerCase().includes(q) ||
       snippet.tags.some((t) => t.toLowerCase().includes(q))
     );
   }

   function renderViewCard(snippet) {
     return (
       '<div class="snippet-card" id="card-' + snippet.id + '">' +
       '<h3>' + escapeHtml(snippet.title) + '</h3>' +
       '<div class="meta">' + escapeHtml(snippet.language) + ' &middot; ' + escapeHtml(snippet.tags.join(', ')) + '</div>' +
       '<pre id="body-' + snippet.id + '">' + escapeHtml(snippet.body) + '</pre>' +
       '<div class="error" id="error-' + snippet.id + '" hidden></div>' +
       '<button type="button" data-action="copy" data-id="' + snippet.id + '">Copy</button>' +
       '<button type="button" data-action="edit" data-id="' + snippet.id + '">Edit</button>' +
       '<button type="button" data-action="delete" data-id="' + snippet.id + '">Delete</button>' +
       '</div>'
     );
   }

   function renderEditCard(snippet) {
     return (
       '<div class="snippet-card" id="card-' + snippet.id + '">' +
       '<input id="edit-title-' + snippet.id + '" value="' + escapeHtml(snippet.title) + '" />' +
       '<input id="edit-language-' + snippet.id + '" value="' + escapeHtml(snippet.language) + '" />' +
       '<textarea id="edit-body-' + snippet.id + '">' + escapeHtml(snippet.body) + '</textarea>' +
       '<textarea id="edit-tags-' + snippet.id + '">' + escapeHtml(formatTagsForEditing(snippet.tags)) + '</textarea>' +
       '<div class="error" id="error-' + snippet.id + '" hidden></div>' +
       '<button type="button" data-action="save" data-id="' + snippet.id + '">Save</button>' +
       '<button type="button" data-action="cancel" data-id="' + snippet.id + '">Cancel</button>' +
       '</div>'
     );
   }

   function renderList(listEl, snippets, editingId) {
     listEl.innerHTML = snippets
       .map((s) => (editingId === s.id ? renderEditCard(s) : renderViewCard(s)))
       .join('');
   }

   function showCardError(doc, id, message) {
     const el = doc.getElementById('error-' + id);
     if (el) {
       el.textContent = message;
       el.hidden = false;
     }
   }

   function start(win) {
     const doc = win.document;
     const fetchFn = win.fetch;
     const state = { snippets: [], editingId: null, query: '' };

     const listEl = doc.getElementById('snippet-list');
     const searchEl = doc.getElementById('search-input');
     const createForm = doc.getElementById('create-form');
     const createError = doc.getElementById('create-error');

     function visible() {
       return state.snippets.filter((s) => matchesQuery(s, state.query));
     }

     function render() {
       renderList(listEl, visible(), state.editingId);
     }

     async function loadSnippets() {
       const res = await fetchFn('/api/snippets');
       state.snippets = await res.json();
       render();
     }

     async function handleCreateSubmit(event) {
       if (event && event.preventDefault) event.preventDefault();
       createError.hidden = true;
       const payload = {
         title: doc.getElementById('create-title').value,
         language: doc.getElementById('create-language').value,
         body: doc.getElementById('create-body').value,
         tags: parseTagsFromText(doc.getElementById('create-tags').value),
       };
       const res = await fetchFn('/api/snippets', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(payload),
       });
       if (!res.ok) {
         createError.textContent = 'Could not save snippet. Please try again.';
         createError.hidden = false;
         return;
       }
       doc.getElementById('create-title').value = '';
       doc.getElementById('create-language').value = '';
       doc.getElementById('create-body').value = '';
       doc.getElementById('create-tags').value = '';
       await loadSnippets();
     }

     async function handleListClick(event) {
       const target = event && event.target;
       const action = target && target.dataset ? target.dataset.action : undefined;
       const id = target && target.dataset ? target.dataset.id : undefined;
       if (!action || !id) return;

       if (action === 'copy') {
         const snippet = state.snippets.find((s) => s.id === id);
         if (snippet && win.navigator && win.navigator.clipboard) {
           await win.navigator.clipboard.writeText(snippet.body);
         }
         return;
       }

       if (action === 'edit') {
         state.editingId = id;
         render();
         return;
       }

       if (action === 'cancel') {
         state.editingId = null;
         render();
         return;
       }

       if (action === 'delete') {
         const res = await fetchFn('/api/snippets/' + id, { method: 'DELETE' });
         if (res.ok) {
           await loadSnippets();
         }
         return;
       }

       if (action === 'save') {
         const payload = {
           title: doc.getElementById('edit-title-' + id).value,
           language: doc.getElementById('edit-language-' + id).value,
           body: doc.getElementById('edit-body-' + id).value,
           tags: parseTagsFromText(doc.getElementById('edit-tags-' + id).value),
         };
         const res = await fetchFn('/api/snippets/' + id, {
           method: 'PUT',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(payload),
         });
         if (!res.ok) {
           showCardError(doc, id, 'Could not save changes. Please try again.');
           return;
         }
         const updated = await res.json();
         const index = state.snippets.findIndex((s) => s.id === id);
         if (index !== -1) state.snippets[index] = updated;
         state.editingId = null;
         render();
         return;
       }
     }

     function handleSearchInput(event) {
       state.query = event.target.value;
       render();
     }

     createForm.addEventListener('submit', handleCreateSubmit);
     listEl.addEventListener('click', handleListClick);
     searchEl.addEventListener('input', handleSearchInput);

     loadSnippets();

     return { render, loadSnippets, state };
   }

   if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
     module.exports = { start, formatTagsForEditing, parseTagsFromText, matchesQuery };
   } else if (typeof window !== 'undefined') {
     start(window);
   }
   ```
Touches:  `public/app.js`
Check:    `node -e "const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('public/app.js')).digest('hex');if(h!=='0a27d55f9829758e9a390c2749b239f10731a5bf17b61c5c23089395372f1d71'){console.error('sha256 mismatch');process.exit(1);}" && node --test test/app.test.js && test "$(git status --porcelain -uall | awk '{print $2}' | sort)" = "public/app.js"`
          — exits 0 when met — Now: unmet (`public/app.js` does not
          exist; `node --test test/app.test.js` fails with `Cannot find
          module '../public/app.js'`).
Depends:  none
Not:      Do not edit `test/app.test.js`. Do not create `public/index.html`
          or `public/styles.css`, and do not create or edit `src/server.js`.

### U4: Write the HTTP API and static file server
Serves:   D2, D3, D4, D5, D7, D8
Level:    L1:api
Produces: `src/server.js`
Given:    the exported functions of `src/db.js` (owning location:
          `src/db.js`, produced by U2): `openDb(dbPath)`,
          `createSnippet(db, input)`, `getSnippet(db, id)`,
          `updateSnippet(db, id, input)`, `deleteSnippet(db, id)`,
          `listSnippets(db, query)`. `test/server.test.js` (already in the
          repo, do not edit it) is the contract this file must satisfy.
          Default port `3000` and db path `snippets.db` next to `src/`, per
          PROBLEM.md's Condition.
Do:
1. Create `src/server.js` with exactly this content:
   ```js
   'use strict';

   const http = require('node:http');
   const path = require('node:path');
   const fs = require('node:fs');
   const db = require('./db.js');

   const STATIC_DIR = path.join(__dirname, '..', 'public');
   const MIME_TYPES = {
     '.html': 'text/html; charset=utf-8',
     '.js': 'text/javascript; charset=utf-8',
     '.css': 'text/css; charset=utf-8',
   };
   const MAX_BODY_BYTES = 1e6;

   function readJsonBody(req) {
     return new Promise((resolve, reject) => {
       let data = '';
       let settled = false;
       req.on('data', (chunk) => {
         data += chunk;
         if (data.length > MAX_BODY_BYTES && !settled) {
           settled = true;
           reject(new Error('payload too large'));
           req.destroy();
         }
       });
       req.on('end', () => {
         if (settled) return;
         settled = true;
         if (!data) {
           resolve({});
           return;
         }
         try {
           resolve(JSON.parse(data));
         } catch {
           reject(new Error('invalid json'));
         }
       });
       req.on('error', (err) => {
         if (settled) return;
         settled = true;
         reject(err);
       });
     });
   }

   function sendJson(res, status, body) {
     const payload = JSON.stringify(body);
     res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
     res.end(payload);
   }

   function serveStatic(res, pathname) {
     const rel = pathname === '/' ? '/index.html' : pathname;
     const safeSuffix = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
     const filePath = path.join(STATIC_DIR, safeSuffix);
     if (!filePath.startsWith(STATIC_DIR)) {
       res.writeHead(403, { 'Content-Type': 'text/plain' });
       res.end('Forbidden');
       return;
     }
     fs.readFile(filePath, (err, data) => {
       if (err) {
         res.writeHead(404, { 'Content-Type': 'text/plain' });
         res.end('Not found');
         return;
       }
       const ext = path.extname(filePath);
       res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
       res.end(data);
     });
   }

   async function handleApi(req, res, method, id, parsed, database) {
     if (method === 'GET' && !id) {
       const q = parsed.searchParams.get('q') || '';
       sendJson(res, 200, db.listSnippets(database, q));
       return;
     }
     if (method === 'POST' && !id) {
       let body;
       try {
         body = await readJsonBody(req);
       } catch {
         sendJson(res, 400, { error: 'invalid json body' });
         return;
       }
       const created = db.createSnippet(database, body || {});
       sendJson(res, 201, created);
       return;
     }
     if (method === 'GET' && id) {
       const found = db.getSnippet(database, id);
       if (!found) {
         sendJson(res, 404, { error: 'not found' });
         return;
       }
       sendJson(res, 200, found);
       return;
     }
     if (method === 'PUT' && id) {
       let body;
       try {
         body = await readJsonBody(req);
       } catch {
         sendJson(res, 400, { error: 'invalid json body' });
         return;
       }
       const updated = db.updateSnippet(database, id, body || {});
       if (!updated) {
         sendJson(res, 404, { error: 'not found' });
         return;
       }
       sendJson(res, 200, updated);
       return;
     }
     if (method === 'DELETE' && id) {
       const ok = db.deleteSnippet(database, id);
       if (!ok) {
         sendJson(res, 404, { error: 'not found' });
         return;
       }
       sendJson(res, 200, { ok: true });
       return;
     }
     sendJson(res, 405, { error: 'method not allowed' });
   }

   async function handleRequest(req, res, database) {
     let parsed;
     try {
       parsed = new URL(req.url, 'http://localhost');
     } catch {
       sendJson(res, 400, { error: 'bad request' });
       return;
     }

     const pathname = parsed.pathname;
     const method = req.method || 'GET';
     const apiMatch = pathname.match(/^\/api\/snippets\/?([^/]*)$/);

     if (apiMatch) {
       const id = apiMatch[1] ? decodeURIComponent(apiMatch[1]) : '';
       await handleApi(req, res, method, id, parsed, database);
       return;
     }

     if (method === 'GET' || method === 'HEAD') {
       serveStatic(res, pathname);
       return;
     }

     sendJson(res, 404, { error: 'not found' });
   }

   function createServer(dbPath) {
     const database = db.openDb(dbPath);

     const server = http.createServer((req, res) => {
       handleRequest(req, res, database).catch(() => {
         if (!res.headersSent) {
           sendJson(res, 500, { error: 'internal error' });
         } else {
           res.end();
         }
       });
     });

     server.on('close', () => {
       try {
         database.close();
       } catch {
         // already closed
       }
     });

     return server;
   }

   if (require.main === module) {
     const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
     const DB_PATH = process.env.SNIPPET_DB_PATH || path.join(__dirname, '..', 'snippets.db');
     const server = createServer(DB_PATH);
     server.listen(PORT, () => {
       console.log(`Snippet Vault listening on http://localhost:${PORT}`);
     });
   }

   module.exports = { createServer };
   ```
Touches:  `src/server.js`
Check:    `node -e "const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('src/server.js')).digest('hex');if(h!=='56a71512c2bd0bf2348206aa7897088e396fa86e2e82f7179df4636887532d55'){console.error('sha256 mismatch');process.exit(1);}" && node --test test/server.test.js && test "$(git status --porcelain -uall | awk '{print $2}' | sort)" = "src/server.js"`
          — exits 0 when met — Now: unmet (`src/server.js` does not
          exist; `node --test test/server.test.js` fails with `Cannot find
          module '../src/server.js'`).
Depends:  U2
Not:      Do not edit `src/db.js` or `test/server.test.js`. Do not create
          any file under `public/`.

### U5: Write the page shell
Serves:   D1, D2, D6
Level:    L1:ui-shell
Produces: `public/index.html`
Given:    the element ids `public/app.js` (produced by U3) reads, listed
          verbatim in U3's Given above. `test/index-html.test.js` (already
          in the repo, do not edit it) is the contract this file must
          satisfy. No other file is read.
Do:
1. Create `public/index.html` with exactly this content:
   ```html
   <!doctype html>
   <html lang="en">
   <head>
   <meta charset="utf-8" />
   <meta name="viewport" content="width=device-width, initial-scale=1" />
   <title>Snippet Vault</title>
   <link rel="stylesheet" href="/styles.css" />
   </head>
   <body>
   <h1>Snippet Vault</h1>

   <form id="create-form">
     <input id="create-title" placeholder="Title" required />
     <input id="create-language" placeholder="Language" required />
     <textarea id="create-body" placeholder="Snippet body" required></textarea>
     <textarea id="create-tags" placeholder="One tag per line"></textarea>
     <button type="submit">Save snippet</button>
     <div id="create-error" class="error" hidden></div>
   </form>

   <input id="search-input" type="search" placeholder="Search snippets..." />

   <div id="snippet-list"></div>

   <script src="/app.js"></script>
   </body>
   </html>
   ```
Touches:  `public/index.html`
Check:    `node -e "const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('public/index.html')).digest('hex');if(h!=='2df02bdd9fbe292cc0383aa48a2940a18bd4cd6de69380035986ae7dca1f36ce'){console.error('sha256 mismatch');process.exit(1);}" && node --test test/index-html.test.js && test "$(git status --porcelain -uall | awk '{print $2}' | sort)" = "public/index.html"`
          — exits 0 when met — Now: unmet (`public/index.html`
          does not exist; the test's `GET /` returns 404, not 200).
Depends:  U4
Not:      Do not create `public/styles.css`. Do not edit `public/app.js` or
          `src/server.js`.

### U6: Write the stylesheet
Serves:   D1, D6
Level:    L1:ui-shell
Produces: `public/styles.css`
Given:    nothing beyond "cosmetic only; must not reference or require any
          element id or JS behavior not already in `public/app.js` or
          `public/index.html`." `test/static-assets.test.js` (already in
          the repo, do not edit it) is the contract this file must satisfy.
Do:
1. Create `public/styles.css` with exactly this content:
   ```css
   body {
     font-family: system-ui, sans-serif;
     max-width: 720px;
     margin: 2rem auto;
     padding: 0 1rem;
   }

   #create-form,
   .snippet-card {
     border: 1px solid #ccc;
     border-radius: 6px;
     padding: 1rem;
     margin-bottom: 1rem;
   }

   #create-form input,
   #create-form textarea,
   .snippet-card textarea,
   .snippet-card input {
     display: block;
     width: 100%;
     margin-bottom: 0.5rem;
     box-sizing: border-box;
   }

   .meta {
     color: #666;
     font-size: 0.85rem;
     margin-bottom: 0.5rem;
   }

   .error {
     color: #b00020;
     margin: 0.5rem 0;
   }

   pre {
     white-space: pre-wrap;
     background: #f5f5f5;
     padding: 0.5rem;
     border-radius: 4px;
   }
   ```
Touches:  `public/styles.css`
Check:    `node -e "const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('public/styles.css')).digest('hex');if(h!=='487a23673bc479d29fc1d602d37908a1b4b54d25ee8a852bd6560ec2ec8cfe52'){console.error('sha256 mismatch');process.exit(1);}" && node --test test/static-assets.test.js && test "$(git status --porcelain -uall | awk '{print $2}' | sort)" = "public/styles.css"`
          — exits 0 when met — Now: unmet (`public/styles.css` does not
          exist; the test's `GET /styles.css` returns 404, not 200).
Depends:  U3, U4
Not:      Do not create `public/index.html`. Do not edit `public/app.js` or
          `src/server.js`.

## Order

U1, U2, U3 in parallel (disjoint Touches) → U4 (needs U2) → U5 (needs U4),
U6 (needs U3, U4) in parallel (disjoint Touches: `public/index.html` vs
`public/styles.css`).

## Trace

- D1 → U1, U2, U3, U4, U5, U6 → step 5
- D2 → U1, U4, U5 → step 1
- D3 → U2, U4 → step 2
- D4 → U2, U4 → step 3
- D5 → U2, U4 → step 4
- D6 → U3, U5, U6 → step 6
- D7 → U4 → step 7
- D8 → U2, U3, U4 → step 8

## Still open
<!-- L only, filled at look back. -->

```json plan
{
  "levels": [
    { "id": "L1:tooling", "check": "npm ci exits 0" },
    { "id": "L1:data", "check": "node --test test/db.test.js green" },
    { "id": "L1:ui-logic", "check": "node --test test/app.test.js green" },
    { "id": "L1:api", "check": "node --test test/server.test.js green" },
    { "id": "L1:ui-shell", "check": "node --test test/index-html.test.js test/static-assets.test.js green" }
  ],
  "units": [
    { "id": "U1", "title": "Scaffold the project's tooling", "serves": ["D2"], "level": "L1:tooling",
      "produces": "package.json, package-lock.json", "touches": ["package.json", "package-lock.json"],
      "check": "node -e \"const c=require('crypto'),f=require('fs');const want={'package.json':'6f178f3bffff1b9078cbdb60c406ffeeb9700f5d839dc88ece1e550eb90aa520','package-lock.json':'0a5f8a388e7560b79b62c3ee759b93eab3fc3499b63a87d6cfb93e013bb51fb0'};for(const p of Object.keys(want)){const got=c.createHash('sha256').update(f.readFileSync(p)).digest('hex');if(got!==want[p]){console.error(p,'sha256 mismatch');process.exit(1);}}\" && npm ci && test \"$(git status --porcelain -uall | awk '{print $2}' | sort)\" = \"$(printf '%s\\n' package-lock.json package.json | sort)\"", "depends": [] },
    { "id": "U2", "title": "Write the SQLite data layer", "serves": ["D3", "D4", "D5", "D8"], "level": "L1:data",
      "produces": "src/db.js", "touches": ["src/db.js"],
      "check": "node -e \"const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('src/db.js')).digest('hex');if(h!=='de44be22a0289be633bc5446620ab0fe3fa8f0e77ef7492c6bb736397708f5a7'){console.error('sha256 mismatch');process.exit(1);}\" && node --test test/db.test.js && test \"$(git status --porcelain -uall | awk '{print $2}' | sort)\" = \"src/db.js\"", "depends": [] },
    { "id": "U3", "title": "Write the client logic", "serves": ["D1", "D6", "D8"], "level": "L1:ui-logic",
      "produces": "public/app.js", "touches": ["public/app.js"],
      "check": "node -e \"const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('public/app.js')).digest('hex');if(h!=='0a27d55f9829758e9a390c2749b239f10731a5bf17b61c5c23089395372f1d71'){console.error('sha256 mismatch');process.exit(1);}\" && node --test test/app.test.js && test \"$(git status --porcelain -uall | awk '{print $2}' | sort)\" = \"public/app.js\"", "depends": [] },
    { "id": "U4", "title": "Write the HTTP API and static file server", "serves": ["D2", "D3", "D4", "D5", "D7", "D8"], "level": "L1:api",
      "produces": "src/server.js", "touches": ["src/server.js"],
      "check": "node -e \"const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('src/server.js')).digest('hex');if(h!=='56a71512c2bd0bf2348206aa7897088e396fa86e2e82f7179df4636887532d55'){console.error('sha256 mismatch');process.exit(1);}\" && node --test test/server.test.js && test \"$(git status --porcelain -uall | awk '{print $2}' | sort)\" = \"src/server.js\"", "depends": ["U2"] },
    { "id": "U5", "title": "Write the page shell", "serves": ["D1", "D2", "D6"], "level": "L1:ui-shell",
      "produces": "public/index.html", "touches": ["public/index.html"],
      "check": "node -e \"const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('public/index.html')).digest('hex');if(h!=='2df02bdd9fbe292cc0383aa48a2940a18bd4cd6de69380035986ae7dca1f36ce'){console.error('sha256 mismatch');process.exit(1);}\" && node --test test/index-html.test.js && test \"$(git status --porcelain -uall | awk '{print $2}' | sort)\" = \"public/index.html\"", "depends": ["U4"] },
    { "id": "U6", "title": "Write the stylesheet", "serves": ["D1", "D6"], "level": "L1:ui-shell",
      "produces": "public/styles.css", "touches": ["public/styles.css"],
      "check": "node -e \"const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('public/styles.css')).digest('hex');if(h!=='487a23673bc479d29fc1d602d37908a1b4b54d25ee8a852bd6560ec2ec8cfe52'){console.error('sha256 mismatch');process.exit(1);}\" && node --test test/static-assets.test.js && test \"$(git status --porcelain -uall | awk '{print $2}' | sort)\" = \"public/styles.css\"", "depends": ["U3", "U4"] }
  ],
  "outer": [
    { "step": 1, "d": "D2" },
    { "step": 2, "d": "D3" },
    { "step": 3, "d": "D4" },
    { "step": 4, "d": "D5" },
    { "step": 5, "d": "D1" },
    { "step": 6, "d": "D6" },
    { "step": 7, "d": "D7" },
    { "step": 8, "d": "D8" }
  ],
  "trace": {
    "D1": ["U1", "U2", "U3", "U4", "U5", "U6"],
    "D2": ["U1", "U4", "U5"],
    "D3": ["U2", "U4"],
    "D4": ["U2", "U4"],
    "D5": ["U2", "U4"],
    "D6": ["U3", "U5", "U6"],
    "D7": ["U4"],
    "D8": ["U2", "U3", "U4"]
  }
}
```
