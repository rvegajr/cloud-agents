# Plan: Snippet Vault

## Approach

Build bottom-up in strict layers — tooling, then persistence, then transport,
then presentation, then documentation — so each layer's correctness is
provable in isolation before the next layer is stacked on it. This is the
"walking skeleton" method: get a data store proven correct on disk, wrap it in
a thin HTTP transport proven correct against that store, then attach the
thinnest possible static UI, so no unit's test depends on a unit above it.

Every line of source code in every unit below was written and verified by
this solver, in a scratch clone, before this plan was written: `npm ci`,
`npm run lint`, `npm run typecheck`, `npm run build`, and `npm test` all
passed; a real `npm start` answered on port 3000; the full Example flow
(create, search substring, restart, persistence) and the exact `GET //`
reproduction from Lesson L-2026-09-19-01 were run against a live process
with `curl`. The units below hand over that verified content verbatim — the
Hand's job is to place each file at its path and run the given commands, not
to invent logic.

Related problem this borrows from: a minimal CRUD microservice with a
bundled static frontend, solved the same way every time — data layer, then
routes, then page.

Deliberately not attempting:
- Syntax highlighting, GitHub gist import, keyboard-only navigation, JSON
  export/import — explicitly deferred in PROBLEM.md's "Not this."
- A frontend framework or bundler — one static HTML page and one vanilla
  `app.js`, per the "dependency-light" shape.
- A custom logger/error-type module in the style `AGENTS.md`'s generic
  template gestures at (`src/logger.ts`, `src/errors.ts`): PROBLEM.md already
  established that template is unfilled boilerplate describing files that do
  not exist, not a convention this project has adopted. `console.log` /
  `console.error` are used directly; no done-check requires otherwise.
- A native SQLite binding (`better-sqlite3`). This solver verified the
  built-in `node:sqlite` module (`DatabaseSync`) works with no flag and no
  warning on the Node version installed in this exact environment (v26.7.0),
  and typechecks cleanly against `@types/node@^22.10.0`. Using it removes
  native-module compilation from the one-command install entirely — the
  built app has **zero runtime npm dependencies**.

## Shape

`L2` — the whole app. Its check is the Outer test below, run against a fresh
clone, matching `QWEN.md`'s own gate (adopted verbatim, not reinvented, per
Lesson L-2026-09-18-03).

`L1` groups, each with a check, each realized by exactly one unit in this
plan:

| Group | Unit | Check |
| --- | --- | --- |
| `L1:tooling` | U1 | `npm ci` succeeds; `tsc`, `eslint`, `tsx` binaries exist |
| `L1:data` | U2 | `test/db.test.ts` green |
| `L1:api` | U3 | `test/http.test.ts` + `test/http-safety.test.ts` green |
| `L1:ui` | U4 | `test/ui.test.ts` green |
| `L1:docs` | U5 | `README.md` documents the run/API contract |

## Outer test

A stranger, against a fresh clone of this repo:

1. **(D2)** `rm -rf /tmp/sv-clone && git clone . /tmp/sv-clone && cd /tmp/sv-clone && npm ci && (npm start &)`, then poll
   `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` every second
   for up to 30s. It reaches `200` with no account, login, or outbound network
   call.
2. **(D3)** `curl -X POST localhost:3000/api/snippets -H 'Content-Type: application/json' -d '{"title":"t","language":"jq","body":"b","tags":["jq"]}'`
   returns 201 with an `id`; `GET /api/snippets/<id>` returns it; `PUT` with a
   changed body returns 200 with the change; `DELETE` returns 200; a
   subsequent `GET` returns 404.
3. **(D4)** Create a snippet titled "Extract ids from array", body
   `jq ".[].id" file.json`, tags `jq shell`. `GET /api/snippets?q=id`,
   `?q=jq`, and `?q=extract` each include it; `?q=zzz-nomatch-zzz` does not.
4. **(D5)** `ls /tmp/sv-clone/snippets.db` finds the file. Kill the server
   (`kill $(lsof -ti :3000)`), confirm `curl` now fails to connect, run
   `(npm start &)` again in the same directory, poll for `200` as in step 1,
   then `GET /api/snippets/<id>` from step 2/3 still returns the snippet.
5. **(D1)** In a browser at `http://localhost:3000/`: paste a jq one-liner
   into the body field, title it "Extract ids from array", tag it `jq shell`,
   click Save. Reload the page. Type `ids` into the search box and watch the
   snippet appear in the results before finishing typing (no submit, no full
   page reload).
6. **(D6)** On that same rendered result, click Copy, then paste into another
   application (a terminal, a text editor). The pasted text matches the
   snippet's body character for character.
7. **(D7)** `curl localhost:3000//`, `curl localhost:3000/api/snippets/%2f`,
   `curl "localhost:3000/$(python3 -c 'print("a"*2000)')"`, and
   `curl -X PATCH localhost:3000/api/snippets` each return some HTTP status
   (the process does not exit); a following plain
   `curl -o /dev/null -w '%{http_code}' localhost:3000/api/snippets` still
   returns `200`.
8. **(D8)** `npm run lint && npm run typecheck && npm test && npm run build`
   all exit 0; `git ls-files | grep -E '(^|/)(\.qwen/|\.aider|dist/|build/|coverage/|node_modules/|[^/]*\.db$|\.env$)'`
   prints nothing.

## Units

### U1: Scaffold the project's tooling
Serves:   D2, D8
Level:    L1:tooling
Produces: `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`
Given:    nothing prior exists; this is a greenfield repo with only
          `AGENTS.md`, `QWEN.md`, `README.md`, `.gitignore`, and `test/`.
Do:
1. Create `package.json` with exactly this content:
   ```json
   {
     "name": "snippet-vault",
     "version": "1.0.0",
     "private": true,
     "type": "module",
     "engines": {
       "node": ">=22.5.0"
     },
     "scripts": {
       "dev": "tsx watch src/main.ts",
       "typecheck": "tsc --noEmit",
       "lint": "eslint src test",
       "build": "tsc -p tsconfig.json",
       "prestart": "npm run build",
       "start": "node dist/main.js",
       "test": "tsx --test test/db.test.ts test/http.test.ts test/http-safety.test.ts test/ui.test.ts"
     },
     "devDependencies": {
       "@eslint/js": "^9.11.0",
       "@types/node": "^22.10.0",
       "eslint": "^9.11.0",
       "tsx": "^4.19.0",
       "typescript": "^5.6.2",
       "typescript-eslint": "^8.7.0"
     }
   }
   ```
2. Create `tsconfig.json` with exactly this content:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "NodeNext",
       "moduleResolution": "NodeNext",
       "lib": ["ES2022"],
       "outDir": "dist",
       "rootDir": "src",
       "strict": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "forceConsistentCasingInFileNames": true,
       "resolveJsonModule": true,
       "declaration": false,
       "sourceMap": false
     },
     "include": ["src"]
   }
   ```
3. Create `eslint.config.mjs` with exactly this content:
   ```js
   // @ts-check
   import js from '@eslint/js';
   import tseslint from 'typescript-eslint';

   export default tseslint.config(
     js.configs.recommended,
     ...tseslint.configs.recommended,
     {
       ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'public/**'],
     },
     {
       languageOptions: {
         parserOptions: {
           ecmaVersion: 2022,
           sourceType: 'module',
         },
       },
     }
   );
   ```
4. Run `npm install` (this generates `package-lock.json` and `node_modules/`).
5. Run `npm ci` and confirm it exits 0.
6. Run `git add package.json package-lock.json tsconfig.json eslint.config.mjs && git commit -m "feat: add project tooling (typescript, eslint, tsx)"`.
Touches:  `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `node_modules/` (generated, gitignored)
Check:    `npm ci && test -x node_modules/.bin/tsc && test -x node_modules/.bin/eslint && test -x node_modules/.bin/tsx` — Now: unmet (no `package.json` exists).
Depends:  none
Not:      Do not create anything under `src/`, `public/`, or `test/`. Do not
          add dependencies beyond those listed above. Do not edit
          `.gitignore`, `AGENTS.md`, `QWEN.md`, `README.md`, or `PROBLEM.md`.

### U2: Build the SQLite-backed snippet store
Serves:   D5
Level:    L1:data
Produces: `src/db.ts`
Given:    the module must export exactly this shape (this solver verified
          the full implementation below satisfies it and typechecks under
          the `tsconfig.json` from U1):
          ```ts
          export interface Snippet {
            id: string;
            title: string;
            language: string;
            body: string;
            tags: string[];
            createdAt: string;
            updatedAt: string;
          }

          export interface SnippetInput {
            title: string;
            language: string;
            body: string;
            tags: string[];
          }

          export class SnippetStore {
            constructor(dbPath: string);
            create(input: SnippetInput): Snippet;
            get(id: string): Snippet | undefined;
            update(id: string, input: SnippetInput): Snippet | undefined;
            delete(id: string): boolean;
            list(query: string): Snippet[];
            close(): void;
          }
          ```
Do:
1. Create `src/db.ts` with exactly this content:
   ```ts
   import { DatabaseSync } from 'node:sqlite';
   import crypto from 'node:crypto';

   export interface Snippet {
     id: string;
     title: string;
     language: string;
     body: string;
     tags: string[];
     createdAt: string;
     updatedAt: string;
   }

   export interface SnippetInput {
     title: string;
     language: string;
     body: string;
     tags: string[];
   }

   interface SnippetRow {
     [key: string]: string;
     id: string;
     title: string;
     language: string;
     body: string;
     tags: string;
     tags_search: string;
     created_at: string;
     updated_at: string;
   }

   function rowToSnippet(row: SnippetRow): Snippet {
     return {
       id: row.id,
       title: row.title,
       language: row.language,
       body: row.body,
       tags: JSON.parse(row.tags) as string[],
       createdAt: row.created_at,
       updatedAt: row.updated_at,
     };
   }

   export class SnippetStore {
     private db: DatabaseSync;

     constructor(dbPath: string) {
       this.db = new DatabaseSync(dbPath);
       this.db.exec(`
         CREATE TABLE IF NOT EXISTS snippets (
           id TEXT PRIMARY KEY,
           title TEXT NOT NULL,
           language TEXT NOT NULL DEFAULT '',
           body TEXT NOT NULL,
           tags TEXT NOT NULL DEFAULT '[]',
           tags_search TEXT NOT NULL DEFAULT '',
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
       `);
     }

     create(input: SnippetInput): Snippet {
       const now = new Date().toISOString();
       const row: SnippetRow = {
         id: crypto.randomUUID(),
         title: input.title,
         language: input.language,
         body: input.body,
         tags: JSON.stringify(input.tags),
         tags_search: input.tags.join(' ').toLowerCase(),
         created_at: now,
         updated_at: now,
       };
       this.db
         .prepare(
           `INSERT INTO snippets (id, title, language, body, tags, tags_search, created_at, updated_at)
            VALUES (@id, @title, @language, @body, @tags, @tags_search, @created_at, @updated_at)`
         )
         .run(row);
       return rowToSnippet(row);
     }

     get(id: string): Snippet | undefined {
       const row = this.db.prepare('SELECT * FROM snippets WHERE id = ?').get(id) as unknown as SnippetRow | undefined;
       return row ? rowToSnippet(row) : undefined;
     }

     update(id: string, input: SnippetInput): Snippet | undefined {
       const existing = this.get(id);
       if (!existing) return undefined;
       const now = new Date().toISOString();
       const row: SnippetRow = {
         id,
         title: input.title,
         language: input.language,
         body: input.body,
         tags: JSON.stringify(input.tags),
         tags_search: input.tags.join(' ').toLowerCase(),
         created_at: existing.createdAt,
         updated_at: now,
       };
       this.db
         .prepare(
           `UPDATE snippets SET title=@title, language=@language, body=@body, tags=@tags,
            tags_search=@tags_search, updated_at=@updated_at WHERE id=@id`
         )
         .run({
           id: row.id,
           title: row.title,
           language: row.language,
           body: row.body,
           tags: row.tags,
           tags_search: row.tags_search,
           updated_at: row.updated_at,
         });
       return rowToSnippet(row);
     }

     delete(id: string): boolean {
       const result = this.db.prepare('DELETE FROM snippets WHERE id = ?').run(id);
       return Number(result.changes) > 0;
     }

     list(query: string): Snippet[] {
       let rows: SnippetRow[];
       if (query.trim() !== '') {
         const needle = `%${query.toLowerCase()}%`;
         rows = this.db
           .prepare(
             `SELECT * FROM snippets
              WHERE lower(title) LIKE ? OR lower(body) LIKE ? OR tags_search LIKE ?
              ORDER BY updated_at DESC`
           )
           .all(needle, needle, needle) as unknown as SnippetRow[];
       } else {
         rows = this.db.prepare('SELECT * FROM snippets ORDER BY updated_at DESC').all() as unknown as SnippetRow[];
       }
       return rows.map(rowToSnippet);
     }

     close(): void {
       this.db.close();
     }
   }
   ```
2. Run `npx tsc --noEmit` and confirm it exits 0.
3. Run `npx tsx --test test/db.test.ts` and confirm the summary line reads
   `pass 1` and `fail 0`.
4. Run `git add src/db.ts && git commit -m "feat: add SQLite-backed snippet store"`.
Touches:  `src/db.ts`
Check:    `npx tsx --test test/db.test.ts` exits 0 with 1 pass, 0 fail — Now:
          unmet (`src/db.ts` does not exist; the test's import fails).
Depends:  U1
Not:      Do not edit `test/db.test.ts` or any file outside `src/db.ts`. Do
          not add a runtime dependency (`node:sqlite` is built into Node;
          no package install is needed for this unit).

### U3: Build the HTTP server and JSON API
Serves:   D2, D3, D4, D7
Level:    L1:api
Produces: `src/server.ts`, `src/main.ts`
Given:    `src/db.ts` exports `SnippetStore` as specified in U2. This unit
          must export exactly:
          ```ts
          export function createServer(dbPath: string): import('node:http').Server;
          ```
          `src/main.ts` has no exported contract; it is the process entry
          point, reading `PORT` (default `3000`) and `SNIPPET_DB_PATH`
          (default `<cwd>/snippets.db`) from the environment.
Do:
1. Create `src/server.ts` with exactly this content:
   ```ts
   import http from 'node:http';
   import fs from 'node:fs';
   import path from 'node:path';
   import { URLSearchParams } from 'node:url';
   import { SnippetStore } from './db.js';

   const PUBLIC_DIR = path.join(process.cwd(), 'public');

   const STATIC_FILES: Record<string, { file: string; type: string }> = {
     '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
     '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
     '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
     '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
   };

   function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
     const payload = JSON.stringify(body);
     res.writeHead(status, {
       'Content-Type': 'application/json; charset=utf-8',
       'Content-Length': Buffer.byteLength(payload),
     });
     res.end(payload);
   }

   function readBody(req: http.IncomingMessage): Promise<string> {
     return new Promise((resolve, reject) => {
       let data = '';
       req.on('data', (chunk: Buffer) => {
         data += chunk;
         if (data.length > 1_000_000) {
           reject(new Error('payload too large'));
           req.destroy();
         }
       });
       req.on('end', () => resolve(data));
       req.on('error', reject);
     });
   }

   function parseTags(value: unknown): string[] {
     if (!Array.isArray(value)) return [];
     return value
       .filter((t): t is string => typeof t === 'string')
       .map((t) => t.trim())
       .filter((t) => t.length > 0);
   }

   function safeDecode(segment: string): string {
     try {
       return decodeURIComponent(segment);
     } catch {
       return segment;
     }
   }

   export function createServer(dbPath: string): http.Server {
     const store = new SnippetStore(dbPath);

     const server = http.createServer((req, res) => {
       handleRequest(req, res, store).catch((err: unknown) => {
         console.error('request handler error:', err);
         if (!res.headersSent) {
           sendJson(res, 500, { error: 'internal error' });
         } else {
           res.end();
         }
       });
     });

     server.on('clientError', (_err, socket) => {
       if (socket.writable) {
         socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
       }
     });

     return server;
   }

   async function handleRequest(
     req: http.IncomingMessage,
     res: http.ServerResponse,
     store: SnippetStore
   ): Promise<void> {
     const rawUrl = req.url ?? '/';
     const questionMark = rawUrl.indexOf('?');
     const rawPath = questionMark === -1 ? rawUrl : rawUrl.slice(0, questionMark);
     const rawQuery = questionMark === -1 ? '' : rawUrl.slice(questionMark + 1);
     const pathname = safeDecode(rawPath) || '/';
     const query = new URLSearchParams(rawQuery);
     const method = req.method ?? 'GET';

     if (method === 'GET' && pathname in STATIC_FILES) {
       serveStatic(res, STATIC_FILES[pathname]);
       return;
     }

     if (pathname === '/api/snippets') {
       if (method === 'GET') {
         const q = query.get('q') ?? '';
         sendJson(res, 200, store.list(q));
         return;
       }
       if (method === 'POST') {
         await handleCreate(req, res, store);
         return;
       }
       sendJson(res, 405, { error: 'method not allowed' });
       return;
     }

     if (pathname.startsWith('/api/snippets/')) {
       const id = pathname.slice('/api/snippets/'.length);
       if (id === '' || id.includes('/')) {
         sendJson(res, 404, { error: 'not found' });
         return;
       }
       if (method === 'GET') {
         const snippet = store.get(id);
         if (!snippet) {
           sendJson(res, 404, { error: 'not found' });
           return;
         }
         sendJson(res, 200, snippet);
         return;
       }
       if (method === 'PUT') {
         await handleUpdate(req, res, store, id);
         return;
       }
       if (method === 'DELETE') {
         const deleted = store.delete(id);
         if (!deleted) {
           sendJson(res, 404, { error: 'not found' });
           return;
         }
         sendJson(res, 200, { ok: true });
         return;
       }
       sendJson(res, 405, { error: 'method not allowed' });
       return;
     }

     sendJson(res, 404, { error: 'not found' });
   }

   function serveStatic(res: http.ServerResponse, entry: { file: string; type: string }): void {
     const filePath = path.join(PUBLIC_DIR, entry.file);
     fs.readFile(filePath, (err, data) => {
       if (err) {
         sendJson(res, 500, { error: 'internal error' });
         return;
       }
       res.writeHead(200, { 'Content-Type': entry.type, 'Content-Length': data.length });
       res.end(data);
     });
   }

   async function handleCreate(req: http.IncomingMessage, res: http.ServerResponse, store: SnippetStore): Promise<void> {
     let parsed: Record<string, unknown>;
     try {
       const raw = await readBody(req);
       parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
     } catch {
       sendJson(res, 400, { error: 'invalid json' });
       return;
     }
     const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
     const body = typeof parsed.body === 'string' ? parsed.body : '';
     if (!title || !body) {
       sendJson(res, 400, { error: 'title and body are required' });
       return;
     }
     const language = typeof parsed.language === 'string' ? parsed.language.trim() : '';
     const tags = parseTags(parsed.tags);
     const snippet = store.create({ title, language, body, tags });
     sendJson(res, 201, snippet);
   }

   async function handleUpdate(
     req: http.IncomingMessage,
     res: http.ServerResponse,
     store: SnippetStore,
     id: string
   ): Promise<void> {
     let parsed: Record<string, unknown>;
     try {
       const raw = await readBody(req);
       parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
     } catch {
       sendJson(res, 400, { error: 'invalid json' });
       return;
     }
     const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
     const body = typeof parsed.body === 'string' ? parsed.body : '';
     if (!title || !body) {
       sendJson(res, 400, { error: 'title and body are required' });
       return;
     }
     const language = typeof parsed.language === 'string' ? parsed.language.trim() : '';
     const tags = parseTags(parsed.tags);
     const snippet = store.update(id, { title, language, body, tags });
     if (!snippet) {
       sendJson(res, 404, { error: 'not found' });
       return;
     }
     sendJson(res, 200, snippet);
   }
   ```
2. Create `src/main.ts` with exactly this content:
   ```ts
   import path from 'node:path';
   import { createServer } from './server.js';

   const port = Number(process.env.PORT ?? 3000);
   const dbPath = process.env.SNIPPET_DB_PATH ?? path.join(process.cwd(), 'snippets.db');

   const server = createServer(dbPath);
   server.listen(port, () => {
     console.log(`Snippet Vault listening on http://localhost:${port}`);
   });

   process.on('uncaughtException', (err) => {
     console.error('uncaught exception:', err);
   });
   process.on('unhandledRejection', (err) => {
     console.error('unhandled rejection:', err);
   });
   ```
3. Run `npx tsc --noEmit` and confirm it exits 0.
4. Run `npx eslint src test` and confirm it exits 0.
5. Run `npx tsx --test test/http.test.ts test/http-safety.test.ts` and
   confirm the summary line reads `pass 3` and `fail 0`.
6. Run `git add src/server.ts src/main.ts && git commit -m "feat: add HTTP API and static file server"`.
Touches:  `src/server.ts`, `src/main.ts`
Check:    `npx tsx --test test/http.test.ts test/http-safety.test.ts` exits 0
          with 3 pass, 0 fail — Now: unmet (`src/server.ts` does not exist).
Depends:  U2
Not:      Do not edit `src/db.ts`, any file under `test/`, or `package.json`.
          Do not add a web framework (Express, Fastify, etc.) — the plain
          `node:http` module is the whole transport layer.

### U4: Build the static single-page UI
Serves:   D1, D6
Level:    L1:ui
Produces: `public/index.html`, `public/app.js`, `public/styles.css`
Given:    `src/server.ts` (from U3) serves `public/index.html` at `/`,
          `public/app.js` at `/app.js`, and `public/styles.css` at
          `/styles.css`. The page must contain an element with
          `id="search-box"` and a `<script src="/app.js">` tag; `app.js`
          must call `navigator.clipboard.writeText(...)` from a Copy button
          and attach an `'input'` listener to the element it holds as
          `els.search`.
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
     <main>
       <h1>Snippet Vault</h1>
       <section class="editor">
         <input id="field-title" type="text" placeholder="Title" />
         <input id="field-language" type="text" placeholder="Language (e.g. jq, bash, sql)" />
         <textarea id="field-body" placeholder="Paste the snippet body here"></textarea>
         <input id="field-tags" type="text" placeholder="Tags, space separated (e.g. jq shell)" />
         <div class="editor-actions">
           <button id="btn-save" type="button">Save</button>
           <button id="btn-cancel" type="button" hidden>Cancel edit</button>
         </div>
       </section>
       <section class="search">
         <input id="search-box" type="text" placeholder="Search title, body, or tags..." autocomplete="off" />
       </section>
       <section id="results" class="results" aria-live="polite"></section>
     </main>
     <script src="/app.js"></script>
   </body>
   </html>
   ```
2. Create `public/app.js` with exactly this content:
   ```js
   const state = { editingId: null };

   const els = {
     title: document.getElementById('field-title'),
     language: document.getElementById('field-language'),
     body: document.getElementById('field-body'),
     tags: document.getElementById('field-tags'),
     save: document.getElementById('btn-save'),
     cancel: document.getElementById('btn-cancel'),
     search: document.getElementById('search-box'),
     results: document.getElementById('results'),
   };

   function debounce(fn, delay) {
     let timer;
     return (...args) => {
       clearTimeout(timer);
       timer = setTimeout(() => fn(...args), delay);
     };
   }

   async function fetchSnippets(query) {
     const url = query ? `/api/snippets?q=${encodeURIComponent(query)}` : '/api/snippets';
     const res = await fetch(url);
     return res.json();
   }

   function renderResults(snippets) {
     els.results.innerHTML = '';
     for (const snippet of snippets) {
       const card = document.createElement('article');
       card.className = 'snippet-card';

       const heading = document.createElement('h2');
       heading.textContent = snippet.title;
       card.appendChild(heading);

       const meta = document.createElement('p');
       meta.className = 'snippet-meta';
       meta.textContent = `${snippet.language || 'plain'} · ${snippet.tags.join(' ')}`;
       card.appendChild(meta);

       const pre = document.createElement('pre');
       pre.textContent = snippet.body;
       card.appendChild(pre);

       const actions = document.createElement('div');
       actions.className = 'snippet-actions';

       const copyBtn = document.createElement('button');
       copyBtn.type = 'button';
       copyBtn.className = 'btn-copy';
       copyBtn.textContent = 'Copy';
       copyBtn.addEventListener('click', async () => {
         await navigator.clipboard.writeText(snippet.body);
         copyBtn.textContent = 'Copied!';
         setTimeout(() => {
           copyBtn.textContent = 'Copy';
         }, 1200);
       });
       actions.appendChild(copyBtn);

       const editBtn = document.createElement('button');
       editBtn.type = 'button';
       editBtn.textContent = 'Edit';
       editBtn.addEventListener('click', () => startEdit(snippet));
       actions.appendChild(editBtn);

       const deleteBtn = document.createElement('button');
       deleteBtn.type = 'button';
       deleteBtn.textContent = 'Delete';
       deleteBtn.addEventListener('click', () => deleteSnippet(snippet.id));
       actions.appendChild(deleteBtn);

       card.appendChild(actions);
       els.results.appendChild(card);
     }
   }

   async function refresh() {
     const snippets = await fetchSnippets(els.search.value.trim());
     renderResults(snippets);
   }

   function startEdit(snippet) {
     state.editingId = snippet.id;
     els.title.value = snippet.title;
     els.language.value = snippet.language;
     els.body.value = snippet.body;
     els.tags.value = snippet.tags.join(' ');
     els.cancel.hidden = false;
   }

   function resetEditor() {
     state.editingId = null;
     els.title.value = '';
     els.language.value = '';
     els.body.value = '';
     els.tags.value = '';
     els.cancel.hidden = true;
   }

   async function saveSnippet() {
     const payload = {
       title: els.title.value.trim(),
       language: els.language.value.trim(),
       body: els.body.value,
       tags: els.tags.value.split(' ').map((t) => t.trim()).filter(Boolean),
     };
     if (!payload.title || !payload.body) return;
     const url = state.editingId ? `/api/snippets/${state.editingId}` : '/api/snippets';
     const method = state.editingId ? 'PUT' : 'POST';
     await fetch(url, {
       method,
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify(payload),
     });
     resetEditor();
     await refresh();
   }

   async function deleteSnippet(id) {
     await fetch(`/api/snippets/${id}`, { method: 'DELETE' });
     await refresh();
   }

   els.save.addEventListener('click', saveSnippet);
   els.cancel.addEventListener('click', resetEditor);
   els.search.addEventListener('input', debounce(refresh, 150));

   refresh();
   ```
3. Create `public/styles.css` with exactly this content:
   ```css
   :root { font-family: system-ui, sans-serif; }
   body { margin: 0; background: #0f172a; color: #e2e8f0; }
   main { max-width: 720px; margin: 0 auto; padding: 24px 16px; }
   h1 { font-size: 1.5rem; }
   .editor, .search { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
   input, textarea, button { font: inherit; padding: 8px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: inherit; }
   textarea { min-height: 100px; font-family: ui-monospace, monospace; }
   .editor-actions { display: flex; gap: 8px; }
   button { cursor: pointer; background: #334155; }
   button:hover { background: #475569; }
   .results { display: flex; flex-direction: column; gap: 12px; }
   .snippet-card { border: 1px solid #334155; border-radius: 8px; padding: 12px; }
   .snippet-card pre { white-space: pre-wrap; word-break: break-word; background: #0b1220; padding: 8px; border-radius: 6px; }
   .snippet-meta { color: #94a3b8; font-size: 0.85rem; }
   .snippet-actions { display: flex; gap: 8px; margin-top: 8px; }
   ```
4. Run `npx tsx --test test/ui.test.ts` and confirm the summary line reads
   `pass 1` and `fail 0`.
5. Run `git add public/index.html public/app.js public/styles.css && git commit -m "feat: add the snippet vault UI"`.
Touches:  `public/index.html`, `public/app.js`, `public/styles.css`
Check:    `npx tsx --test test/ui.test.ts` exits 0 with 1 pass, 0 fail — Now:
          unmet (`public/index.html` does not exist; `GET /` returns 500).
Depends:  U3
Not:      Do not edit `src/*.ts` or any file under `test/`. Do not add a CSS
          framework, a JS bundler, or a CDN `<script>` tag — `app.js` is
          loaded as-is, with no build step.

### U5: Document install, run, and API usage
Serves:   D1, D8
Level:    L1:docs
Produces: `README.md`
Given:    the finished command surface from U1 (`npm ci`, `npm run dev`,
          `npm start`, `npm run lint`, `npm run typecheck`, `npm test`,
          `npm run build`) and the finished API surface from U3
          (`/api/snippets`, methods GET/POST/PUT/DELETE, fields `title`,
          `language`, `body`, `tags`).
Do:
1. Overwrite `README.md` with exactly this content:
   ```markdown
   # Snippet Vault

   A local-first web app for saving, tagging, and instantly searching code
   snippets. Everything runs on your own machine: no accounts, no network
   calls, no server to manage beyond the one process you start yourself.

   ## Run it

   Requires Node.js 22.5 or later (for the built-in `node:sqlite` module).

   ```
   npm ci
   npm run dev
   ```

   Then open http://localhost:3000/ in a browser. `npm run dev` restarts on
   file changes. For a production-style run, use `npm start` instead (it
   builds the TypeScript once via `npm run build`, then runs the compiled
   server).

   The port defaults to 3000; override it with `PORT=4000 npm start`. Data is
   stored in a SQLite file at `snippets.db` in the project directory;
   override its location with `SNIPPET_DB_PATH=/path/to/file.db`.

   ## Use it

   1. Fill in a title, language, body, and space-separated tags, then click
      Save.
   2. Type in the search box; results update as you type, matching any
      substring of the title, body, or tags.
   3. Click Copy on any result to put its body on the clipboard.
   4. Click Edit or Delete on a result to change or remove it.

   ## API

   All routes are under `/api/snippets` and speak JSON.

   | Method | Path                  | Body                                         | Response                |
   | ------ | --------------------- | --------------------------------------------- | ------------------------ |
   | GET    | `/api/snippets?q=...` | —                                             | array of snippets        |
   | POST   | `/api/snippets`       | `{ title, language, body, tags: string[] }`   | created snippet, 201     |
   | GET    | `/api/snippets/:id`   | —                                             | snippet, or 404          |
   | PUT    | `/api/snippets/:id`   | `{ title, language, body, tags: string[] }`   | updated snippet, or 404  |
   | DELETE | `/api/snippets/:id`   | —                                             | `{ ok: true }`, or 404   |

   `title` and `body` are required and must be non-empty strings; `language`
   defaults to `''`; `tags` defaults to `[]`.

   ## Development

   | Purpose   | Command              |
   | --------- | --------------------- |
   | Install   | `npm ci`              |
   | Lint      | `npm run lint`        |
   | Typecheck | `npm run typecheck`   |
   | Test      | `npm test`            |
   | Build     | `npm run build`       |
   | Start     | `npm start`           |
   ```
2. Run `grep -q "npm start" README.md && grep -q "npm run dev" README.md && grep -q "/api/snippets" README.md && grep -q "3000" README.md && echo OK`
   and confirm it prints `OK`.
3. Run `npm run lint && npm run typecheck && npm test && npm run build` and
   confirm every command exits 0.
4. Run `git ls-files | grep -E '(^|/)(\.qwen/|\.aider|dist/|build/|coverage/|node_modules/|[^/]*\.db$|\.env$)'`
   and confirm it prints nothing.
5. Run `git add README.md && git commit -m "docs: document install, run, and API usage"`.
Touches:  `README.md`
Check:    `grep -q "npm start" README.md && grep -q "npm run dev" README.md && grep -q "/api/snippets" README.md && grep -q "3000" README.md`
          exits 0 — Now: unmet (current `README.md` is one line: the repo
          title only).
Depends:  U4
Not:      Do not edit `SPEC.md`, `ROADMAP.md`, or any other protected file
          named in `QWEN.md` (none currently exist — do not create them
          either). Do not edit anything under `src/`, `public/`, or `test/`.

## Order and Trace

Strictly sequential: `U1 → U2 → U3 → U4 → U5`. Each unit's Touches are
disjoint from every other unit's (no file is written by two units), and each
depends on the previous purely because its code imports or serves what the
previous unit produced — there is no parallel branch to schedule.

| D | Units | Outer step |
| --- | --- | --- |
| D1 | U3 (serves the static route), U4 (the UI itself), U5 (documents the flow) | 5 |
| D2 | U1 (the `start`/`prestart` scripts), U3 (`main.ts` listens) | 1 |
| D3 | U2 (the store), U3 (the routes) | 2 |
| D4 | U2 (the `list` query), U3 (the routes) | 3 |
| D5 | U2 (`SnippetStore` persistence to a real file) | 4 |
| D6 | U4 (the Copy button) | 6 |
| D7 | U3 (`safeDecode`, `clientError`, the catch-all handler) | 7 |
| D8 | U1 (introduces lint/typecheck/build/test), U5 (documents and re-confirms the whole gate) | 8 |

```json plan
{
  "units": [
    { "id": "U1", "title": "Scaffold the project's tooling", "serves": ["D2", "D8"], "level": "L1:tooling", "depends": [] },
    { "id": "U2", "title": "Build the SQLite-backed snippet store", "serves": ["D5"], "level": "L1:data", "depends": ["U1"] },
    { "id": "U3", "title": "Build the HTTP server and JSON API", "serves": ["D2", "D3", "D4", "D7"], "level": "L1:api", "depends": ["U2"] },
    { "id": "U4", "title": "Build the static single-page UI", "serves": ["D1", "D6"], "level": "L1:ui", "depends": ["U3"] },
    { "id": "U5", "title": "Document install, run, and API usage", "serves": ["D1", "D8"], "level": "L1:docs", "depends": ["U4"] }
  ],
  "order": ["U1", "U2", "U3", "U4", "U5"],
  "trace": {
    "D1": { "units": ["U3", "U4", "U5"], "outer_step": 5 },
    "D2": { "units": ["U1", "U3"], "outer_step": 1 },
    "D3": { "units": ["U2", "U3"], "outer_step": 2 },
    "D4": { "units": ["U2", "U3"], "outer_step": 3 },
    "D5": { "units": ["U2"], "outer_step": 4 },
    "D6": { "units": ["U4"], "outer_step": 6 },
    "D7": { "units": ["U3"], "outer_step": 7 },
    "D8": { "units": ["U1", "U5"], "outer_step": 8 }
  }
}
```
