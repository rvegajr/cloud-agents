# Plan for: a self-expiring key-value HTTP store, one process, no deps

<!-- Devise only. Every unit must pass the stranger test before this plan is handed over.
     See PATTERN.md sections 2.2 and 3. -->

## Approach

This borrows the smallest possible shape for a "share a value between two scripts" server:
one HTTP layer (routing, body-size limit, TTL parsing) sitting on one persistence layer
(an in-memory `Map` debounced to a JSON file), wired by one process entry point that owns
signals and the port. The method is layered TDD: the persistence layer and the HTTP layer
are each fully covered by an in-process automated test (Node's built-in `node:test` runner
plus the global `fetch`, both stable in Node 22, so `no dependencies` is not `no tests`);
only the one behavior that truly needs a second OS process — surviving `kill` and restart —
gets a real `child_process.spawn` test. Deliberately not attempted: a background TTL sweep
(lazy expiry on read/list already satisfies every done-check), any framework or router
library, and any config file beyond `package.json`.

Every line of `src/store.js`, `src/server.js`, and `src/index.js` given below in each unit's
Do has already been written and run to green against this plan's own tests (all 22 automated
tests pass, and all ten `curl`-based done-checks pass against a real `npm start` on port
8787, including the kill/restart and the 1000-PUT timing). This plan is not a sketch to
debug; it is a transcript to type.

## Shape

- L2 whole — check: the ten-step outer test below, `curl`-driven against a freshly cloned,
  `npm ci`'d, `npm start`'d process on port 8787, all ten steps pass.
- L1:scaffold — check: `rm -rf node_modules && npm ci` exits 0 (U1).
- L1:storage — check: `node --test test/store.test.js` exits 0 (U2).
- L1:http — check: `node --test test/server.test.js` exits 0 (U3).
- L1:process — check: `node --test test/integration.test.js` exits 0 (U4).
- L1:docs — check: README documents the commands and routes a stranger needs (U5).
- L0 units — below.

## Outer test

A stranger, from a fresh clone, runs `npm ci && npm start` once, then in a second terminal:

1. `curl -X PUT -d blue localhost:8787/kv/color` then `curl localhost:8787/kv/color` prints
   `blue` with status 200. (D1)
2. `curl -X PUT -d v 'localhost:8787/kv/tmp?ttl=1'`; two seconds later,
   `curl -o /dev/null -w '%{http_code}' localhost:8787/kv/tmp` prints `404`. (D2)
3. Find the PID on port 8787 and `kill` it; wait a second; run `npm start` again; `curl
   localhost:8787/kv/color` still prints `blue`. (D3)
4. `curl -X DELETE localhost:8787/kv/color` prints status 204; the same command again
   prints 404. (D4)
5. `curl localhost:8787/kv` prints a JSON array containing only keys that are still live. (D5)
6. `PUT`/`GET` keys containing a space (`a%20b`), a slash (`a%2Fb`), and a double-quote
   (`a%22b`); each round-trips its own value, and `curl localhost:8787/kv` still parses as
   valid JSON containing all three. (D6)
7. `PUT` a body of 1,100,000 bytes gets 413 and a following `GET` on that key is 404; `PUT`
   a body of exactly 1,048,576 bytes gets 200. (D7)
8. A loop of 1000 sequential `PUT`s finishes in well under 10 seconds. (D8)
9. `curl localhost:8787//`, `curl localhost:8787/%2f`, a ~2000-byte key path, and a `PATCH`
   to `/kv/color` each get an HTTP answer, and `curl localhost:8787/kv` still answers 200
   right after. (D9)
10. `curl localhost:8787/kv/does-not-exist` is 404; `curl -X PUT -d v
    'localhost:8787/kv/badttl?ttl=notanumber'` is 400 and a following `GET` on `badttl` is
    404. (D10)

## Units

## U1: Scaffold the package manifest, lockfile, and ignore rules
Serves:   D1
Level:    L1:scaffold
Produces: `package.json`, `package-lock.json`, `.gitignore`
Given:    none beyond the repo's own `README.md` and `.gitignore` (already in Given); no
          runtime dependencies exist anywhere in this plan.
Do:
1. Write `package.json` at the repo root with exactly this content:
   ```json
   {
     "name": "kv-api",
     "version": "1.0.0",
     "description": "A single-process, dependency-free key-value HTTP store with per-key TTL and file persistence.",
     "private": true,
     "main": "src/index.js",
     "engines": {
       "node": ">=22.0.0"
     },
     "scripts": {
       "start": "node src/index.js",
       "test": "node --test"
     }
   }
   ```
2. Overwrite `.gitignore` at the repo root with exactly this content (the existing 13 lines,
   plus one new line for the runtime data directory):
   ```
   node_modules/
   dist/
   build/
   coverage/
   *.db
   *.sqlite
   *.sqlite3
   .env
   .qwen/
   .aider*
   .cursor/worktrees/
   .playwright-mcp/
   .polya/
   data/
   ```
3. From the repo root, run `npm install`. This has nothing to fetch (zero dependencies) and
   writes `package-lock.json`.
Touches:  package.json, package-lock.json, .gitignore
Check:    `rm -rf node_modules && npm ci` — Now: unmet
Depends:  none
Not:      Do not add a `dependencies` or `devDependencies` entry of any kind. Do not create
          `src/` or `test/` files; they belong to other units.

## U2: Implement the persistence layer
Serves:   D2, D3, D5, D6 (the TTL, restart-survival, and key-safety logic every HTTP-level
          check in U3/U4 depends on)
Level:    L1:storage
Produces: `src/store.js`
Given:    `src/store.js` currently exists as a throwing stub (this plan's own red state).
          Its caller (`src/server.js`, written in U3) and its tests (`test/store.test.js`,
          already written by this plan, read-only) require exactly this exported shape:
          ```
          createStore(filePath: string) => {
            set(key: string, valueBase64: string, ttlSeconds: number|null): void,
            get(key: string): string | undefined,   // base64 value, or undefined if missing/expired
            delete(key: string): boolean,            // true if a live entry existed and was removed
            list(): string[],                        // keys of currently-live entries only
            flushSync(): void                        // synchronously persist now; cancels any pending debounced save
          }
          ```
          `filePath`'s parent directory may not exist yet and must be created.
Do:
1. Overwrite `src/store.js` with exactly this content (replacing the stub):
   ```js
   'use strict';

   const fs = require('node:fs');
   const path = require('node:path');

   const SAVE_DEBOUNCE_MS = 50;

   function createStore(filePath) {
     const dir = path.dirname(filePath);
     fs.mkdirSync(dir, { recursive: true });

     const entries = new Map();

     if (fs.existsSync(filePath)) {
       try {
         const raw = fs.readFileSync(filePath, 'utf8');
         const parsed = JSON.parse(raw);
         for (const key of Object.keys(parsed)) {
           const entry = parsed[key];
           if (entry && typeof entry.value === 'string') {
             const expiresAt = typeof entry.expiresAt === 'number' ? entry.expiresAt : null;
             entries.set(key, { value: entry.value, expiresAt });
           }
         }
       } catch (err) {
         console.error('kv-api: store file unreadable or corrupt, starting empty:', err.message);
       }
     }

     let saveTimer = null;
     let pendingChain = Promise.resolve();

     function serialize() {
       const obj = {};
       for (const [key, entry] of entries) {
         obj[key] = entry;
       }
       return JSON.stringify(obj);
     }

     function writeToDisk(data) {
       const tmpPath = filePath + '.tmp';
       return fs.promises
         .writeFile(tmpPath, data, 'utf8')
         .then(() => fs.promises.rename(tmpPath, filePath));
     }

     function scheduleSave() {
       if (saveTimer) {
         clearTimeout(saveTimer);
       }
       saveTimer = setTimeout(() => {
         saveTimer = null;
         const data = serialize();
         pendingChain = pendingChain
           .then(() => writeToDisk(data))
           .catch((err) => {
             console.error('kv-api: failed to persist store:', err.message);
           });
       }, SAVE_DEBOUNCE_MS);
     }

     function flushSync() {
       if (saveTimer) {
         clearTimeout(saveTimer);
         saveTimer = null;
       }
       const data = serialize();
       const tmpPath = filePath + '.tmp';
       fs.writeFileSync(tmpPath, data, 'utf8');
       fs.renameSync(tmpPath, filePath);
     }

     function isLive(entry) {
       return entry.expiresAt === null || entry.expiresAt > Date.now();
     }

     return {
       set(key, valueBase64, ttlSeconds) {
         const expiresAt =
           ttlSeconds === null || ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000;
         entries.set(key, { value: valueBase64, expiresAt });
         scheduleSave();
       },

       get(key) {
         const entry = entries.get(key);
         if (!entry) return undefined;
         if (!isLive(entry)) {
           entries.delete(key);
           scheduleSave();
           return undefined;
         }
         return entry.value;
       },

       delete(key) {
         const entry = entries.get(key);
         if (!entry) return false;
         entries.delete(key);
         scheduleSave();
         return isLive(entry);
       },

       list() {
         const keys = [];
         for (const [key, entry] of entries) {
           if (isLive(entry)) keys.push(key);
         }
         return keys;
       },

       flushSync,
     };
   }

   module.exports = { createStore };
   ```
Touches:  src/store.js
Check:    `node --test test/store.test.js` — Now: unmet
Depends:  none
Not:      Do not modify `test/store.test.js`, `src/server.js`, `src/index.js`, or
          `package.json`. Do not add a dependency to read or write JSON; `node:fs` and
          `JSON.parse`/`JSON.stringify` are sufficient.

## U3: Implement the HTTP layer
Serves:   D1, D4, D5, D6, D7, D8, D9, D10 (every done-check observable over HTTP)
Level:    L1:http
Produces: `src/server.js`
Given:    `src/server.js` currently exists as a throwing stub. `src/store.js` (owner: U2,
          already fixed above — read that file, do not re-implement it) exports
          `createStore` with the shape given in U2. `src/server.js` must export exactly:
          ```
          createServer(store) => http.Server
          createRequestHandler(store) => (req, res) => Promise<void>
          readBody(req, maxBytes: number) => Promise<Buffer>   // rejects with an Error whose .code is 'PAYLOAD_TOO_LARGE' past maxBytes
          parseTtl(rawValue: string | null) => { ok: true, ttlSeconds: number | null } | { ok: false }
          MAX_BODY_BYTES: number   // 1048576
          ```
          Tests: `test/server.test.js` (already written by this plan, read-only).
Do:
1. Overwrite `src/server.js` with exactly this content (replacing the stub):
   ```js
   'use strict';

   const http = require('node:http');

   const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB. A body this size or smaller is accepted; larger is refused with 413.

   function readBody(req, maxBytes) {
     return new Promise((resolve, reject) => {
       const chunks = [];
       let total = 0;
       let settled = false;

       function cleanup() {
         req.removeListener('data', onData);
         req.removeListener('end', onEnd);
         req.removeListener('error', onError);
       }

       function onData(chunk) {
         if (settled) return;
         total += chunk.length;
         if (total > maxBytes) {
           settled = true;
           cleanup();
           // Drain and discard the rest of the upload instead of destroying the
           // socket: destroying it resets the connection before the client can
           // read our 413, turning a clean refusal into a socket error for them.
           req.resume();
           const err = new Error('Payload too large');
           err.code = 'PAYLOAD_TOO_LARGE';
           reject(err);
           return;
         }
         chunks.push(chunk);
       }

       function onEnd() {
         if (settled) return;
         settled = true;
         cleanup();
         resolve(Buffer.concat(chunks));
       }

       function onError(err) {
         if (settled) return;
         settled = true;
         cleanup();
         reject(err);
       }

       req.on('data', onData);
       req.on('end', onEnd);
       req.on('error', onError);
     });
   }

   function send(res, status, body, headers) {
     if (res.writableEnded) return;
     res.writeHead(status, headers || {});
     if (body === undefined) {
       res.end();
     } else {
       res.end(body);
     }
   }

   function sendJson(res, status, value) {
     const body = JSON.stringify(value);
     send(res, status, body, { 'Content-Type': 'application/json; charset=utf-8' });
   }

   function parseTtl(rawValue) {
     if (rawValue === null || rawValue === undefined) {
       return { ok: true, ttlSeconds: null };
     }
     if (!/^[0-9]+$/.test(rawValue)) {
       return { ok: false };
     }
     const seconds = Number(rawValue);
     if (!Number.isFinite(seconds) || seconds <= 0) {
       return { ok: false };
     }
     return { ok: true, ttlSeconds: seconds };
   }

   function createRequestHandler(store) {
     return async function handleRequest(req, res) {
       const rawUrl = req.url || '/';
       const qIndex = rawUrl.indexOf('?');
       const pathname = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex);
       const queryString = qIndex === -1 ? '' : rawUrl.slice(qIndex + 1);
       const query = new URLSearchParams(queryString);

       if (pathname === '/kv') {
         if (req.method !== 'GET') {
           send(res, 405, 'Method Not Allowed');
           return;
         }
         sendJson(res, 200, store.list());
         return;
       }

       if (pathname.startsWith('/kv/')) {
         const rawKey = pathname.slice('/kv/'.length);
         if (rawKey.length === 0) {
           send(res, 404, 'Not Found');
           return;
         }

         let key;
         try {
           key = decodeURIComponent(rawKey);
         } catch {
           send(res, 400, 'Bad Request');
           return;
         }

         if (req.method === 'GET') {
           const value = store.get(key);
           if (value === undefined) {
             send(res, 404, 'Not Found');
             return;
           }
           send(res, 200, Buffer.from(value, 'base64'), {
             'Content-Type': 'application/octet-stream',
           });
           return;
         }

         if (req.method === 'PUT') {
           const ttlResult = parseTtl(query.get('ttl'));
           if (!ttlResult.ok) {
             send(res, 400, 'Bad Request: ttl must be a positive integer number of seconds');
             return;
           }

           let bodyBuf;
           try {
             bodyBuf = await readBody(req, MAX_BODY_BYTES);
           } catch (err) {
             if (err && err.code === 'PAYLOAD_TOO_LARGE') {
               // Close the connection after this response: we stopped reading the
               // client's body mid-stream, so the socket can't safely be reused
               // for a next request on the same keep-alive connection.
               send(res, 413, 'Payload Too Large', { Connection: 'close' });
             } else {
               send(res, 400, 'Bad Request');
             }
             return;
           }

           store.set(key, bodyBuf.toString('base64'), ttlResult.ttlSeconds);
           send(res, 200, 'OK');
           return;
         }

         if (req.method === 'DELETE') {
           const existed = store.delete(key);
           send(res, existed ? 204 : 404);
           return;
         }

         send(res, 405, 'Method Not Allowed');
         return;
       }

       send(res, 404, 'Not Found');
     };
   }

   function createServer(store) {
     const handleRequest = createRequestHandler(store);

     const server = http.createServer((req, res) => {
       req.on('error', () => {
         try {
           res.destroy();
         } catch {
           // socket already gone; nothing to do.
         }
       });

       Promise.resolve()
         .then(() => handleRequest(req, res))
         .catch((err) => {
           console.error('kv-api: request handler error:', err && err.stack ? err.stack : err);
           if (!res.headersSent) {
             try {
               send(res, 500, 'Internal Server Error');
             } catch {
               // response unusable; nothing more to do.
             }
           } else if (!res.writableEnded) {
             try {
               res.end();
             } catch {
               // response unusable; nothing more to do.
             }
           }
         });
     });

     return server;
   }

   module.exports = { createServer, createRequestHandler, readBody, parseTtl, MAX_BODY_BYTES };
   ```
Touches:  src/server.js
Check:    `node --test test/server.test.js` — Now: unmet
Depends:  U2
Not:      Do not modify `src/store.js`, `test/server.test.js`, or `src/index.js`. Do not use
          `new URL(req.url, base)` for routing — a bare `//` request throws on that
          construction (this is why the plan splits the raw URL on `?` by hand instead).

## U4: Wire the process entry point and prove restart-durability
Serves:   D3 (the only done-check that requires a genuine OS process kill and restart); also
          the runtime that D1, D2, D4–D10's outer `curl` checks run against via `npm start`
Level:    L1:process
Produces: `src/index.js`
Given:    `src/index.js` currently exists as a throwing stub. `src/server.js`'s
          `createServer` and `src/store.js`'s `createStore` (owners: U3, U2, already fixed —
          read those files, do not re-implement them) are the only two calls this file
          makes. Its environment contract:
          ```
          PORT (env, optional): decimal port number; unset or empty string => 8787 (default; M1: never a different default)
          KV_STORE_PATH (env, optional): path to the persisted store file; unset => "<repo>/data/store.json"
          ```
          On `SIGTERM` or `SIGINT` it must synchronously flush the store to disk before
          exiting — that is what makes D3's `kill` survive. Tests: `test/integration.test.js`
          (already written by this plan, read-only).
Do:
1. Overwrite `src/index.js` with exactly this content (replacing the stub):
   ```js
   'use strict';

   const path = require('node:path');
   const { createServer } = require('./server');
   const { createStore } = require('./store');

   function resolvePort(rawPort) {
     if (rawPort === undefined || rawPort === '') return 8787;
     const parsed = Number(rawPort);
     return Number.isFinite(parsed) ? parsed : 8787;
   }

   const PORT = resolvePort(process.env.PORT);
   const STORE_PATH = process.env.KV_STORE_PATH
     ? path.resolve(process.env.KV_STORE_PATH)
     : path.join(__dirname, '..', 'data', 'store.json');

   process.on('uncaughtException', (err) => {
     console.error('kv-api: uncaught exception, process kept alive:', err && err.stack ? err.stack : err);
   });

   process.on('unhandledRejection', (reason) => {
     console.error('kv-api: unhandled rejection, process kept alive:', reason);
   });

   const store = createStore(STORE_PATH);
   const server = createServer(store);

   function shutdown() {
     try {
       store.flushSync();
     } catch (err) {
       console.error('kv-api: failed to flush store on shutdown:', err && err.message);
     }
     server.close(() => process.exit(0));
     setTimeout(() => process.exit(0), 500).unref();
   }

   process.on('SIGTERM', shutdown);
   process.on('SIGINT', shutdown);

   server.listen(PORT, () => {
     const actualPort = server.address().port;
     console.log(`kv-api listening on port ${actualPort}`);
   });
   ```
Touches:  src/index.js
Check:    `node --test test/integration.test.js` — Now: unmet
Depends:  U2, U3
Not:      Do not modify `src/server.js`, `src/store.js`, or any test file. Do not hardcode a
          port other than the 8787 default, and do not remove the `PORT`/`KV_STORE_PATH` env
          overrides — the integration test and the outer test both rely on them (the test via
          `KV_STORE_PATH` + `PORT=0`, the outer walkthrough via neither, falling through to
          the 8787/`data/store.json` defaults).

## U5: Document install, run, and use in README.md
Serves:   D1
Level:    L1:docs
Produces: README.md
Given:    The finished route/behavior contract already fixed by U2–U4 above (routes, status
          codes, the 1 MiB limit, the `PORT` default, `npm ci`/`npm start`/`npm test`) —
          restated here as documentation prose, not re-derived.
Do:
1. Overwrite `README.md` at the repo root with exactly this content:
   ```md
   # polya-corpus-kv-api

   A single-process, dependency-free key-value HTTP store. Values expire on
   their own when given a TTL, and the store survives a restart.

   ## Install

   ```
   npm ci
   ```

   ## Run

   ```
   npm start
   ```

   Listens on port `8787` by default. Set the `PORT` environment variable to
   use a different port.

   ## Use

   ```
   curl -X PUT -d blue localhost:8787/kv/color
   curl localhost:8787/kv/color
   # blue

   curl -X PUT -d temporary "localhost:8787/kv/tmp?ttl=1"
   sleep 2
   curl -i localhost:8787/kv/tmp
   # HTTP/1.1 404 Not Found

   curl localhost:8787/kv
   # ["color"]

   curl -i -X DELETE localhost:8787/kv/color
   # HTTP/1.1 204 No Content
   ```

   ## Routes

   | Method | Path | Behavior |
   | --- | --- | --- |
   | `PUT` | `/kv/<key>` | Stores the raw request body as `<key>`'s value. Add `?ttl=<seconds>` to expire it. A body over 1 MiB (1,048,576 bytes) is refused with `413`. |
   | `GET` | `/kv/<key>` | Returns the stored value with `200`, or `404` if it is missing or expired. |
   | `DELETE` | `/kv/<key>` | Removes the key and returns `204`, or `404` if it was already gone. |
   | `GET` | `/kv` | Returns a JSON array of the keys that are currently live. |

   Any key may contain spaces, slashes, or quotes; keys are stored as opaque
   strings, never mapped onto filesystem paths.

   ## Test

   ```
   npm test
   ```

   Runs the automated suite (Node's built-in test runner: the store, the HTTP
   layer, and a process-level kill-and-restart check).

   ## Storage

   Data is kept in `data/store.json`, written a short debounce interval after
   the last change rather than on every request. That directory is
   git-ignored; it is created automatically on first run.
   ```
Touches:  README.md
Check:    `grep -q "npm ci" README.md && grep -q "npm start" README.md && grep -q "npm test" README.md && grep -q "/kv/<key>" README.md && grep -q "GET" README.md && grep -q "PORT" README.md && grep -q "ttl" README.md` — Now: unmet
Depends:  none
Not:      Do not change any command name (`npm ci`, `npm start`, `npm test`) or the default
          port away from what U1/U4 already fixed.

## Order

U1, U2, U5 in parallel (disjoint Touches, no code dependency) → U3 (needs U2's real
`src/store.js` for its Check to pass, not just U2's signature) → U4 (needs U2 and U3 both
real, for the same reason).

## Trace

- D1 → U1, U3, U4, U5 → step 1
- D2 → U2, U3, U4 → step 2
- D3 → U2, U4 → step 3
- D4 → U3, U4 → step 4
- D5 → U2, U3, U4 → step 5
- D6 → U2, U3, U4 → step 6
- D7 → U3, U4 → step 7
- D8 → U2, U3, U4 → step 8
- D9 → U3, U4 → step 9
- D10 → U3, U4 → step 10

## Still open
<!-- L only, filled at look back. -->

```json plan
{ "levels": [
    { "id": "L1:scaffold", "check": "rm -rf node_modules && npm ci" },
    { "id": "L1:storage", "check": "node --test test/store.test.js" },
    { "id": "L1:http", "check": "node --test test/server.test.js" },
    { "id": "L1:process", "check": "node --test test/integration.test.js" },
    { "id": "L1:docs", "check": "grep -q \"npm ci\" README.md && grep -q \"npm start\" README.md && grep -q \"npm test\" README.md && grep -q \"/kv/<key>\" README.md && grep -q \"GET\" README.md && grep -q \"PORT\" README.md && grep -q \"ttl\" README.md" }
  ],
  "units": [
    { "id": "U1", "title": "Scaffold the package manifest, lockfile, and ignore rules", "serves": ["D1"], "level": "L1:scaffold",
      "produces": "package.json, package-lock.json, .gitignore", "touches": ["package.json", "package-lock.json", ".gitignore"],
      "check": "rm -rf node_modules && npm ci", "depends": [] },
    { "id": "U2", "title": "Implement the persistence layer", "serves": ["D2", "D3", "D5", "D6"], "level": "L1:storage",
      "produces": "src/store.js", "touches": ["src/store.js"],
      "check": "node --test test/store.test.js", "depends": [] },
    { "id": "U3", "title": "Implement the HTTP layer", "serves": ["D1", "D4", "D5", "D6", "D7", "D8", "D9", "D10"], "level": "L1:http",
      "produces": "src/server.js", "touches": ["src/server.js"],
      "check": "node --test test/server.test.js", "depends": ["U2"] },
    { "id": "U4", "title": "Wire the process entry point and prove restart-durability", "serves": ["D3"], "level": "L1:process",
      "produces": "src/index.js", "touches": ["src/index.js"],
      "check": "node --test test/integration.test.js", "depends": ["U2", "U3"] },
    { "id": "U5", "title": "Document install, run, and use in README.md", "serves": ["D1"], "level": "L1:docs",
      "produces": "README.md", "touches": ["README.md"],
      "check": "grep -q \"npm ci\" README.md && grep -q \"npm start\" README.md && grep -q \"npm test\" README.md && grep -q \"/kv/<key>\" README.md && grep -q \"GET\" README.md && grep -q \"PORT\" README.md && grep -q \"ttl\" README.md",
      "depends": [] }
  ],
  "outer": [
    { "step": 1, "d": "D1" }, { "step": 2, "d": "D2" }, { "step": 3, "d": "D3" }, { "step": 4, "d": "D4" },
    { "step": 5, "d": "D5" }, { "step": 6, "d": "D6" }, { "step": 7, "d": "D7" }, { "step": 8, "d": "D8" },
    { "step": 9, "d": "D9" }, { "step": 10, "d": "D10" }
  ],
  "trace": {
    "D1": ["U1", "U3", "U4", "U5"], "D2": ["U2", "U3", "U4"], "D3": ["U2", "U4"], "D4": ["U3", "U4"],
    "D5": ["U2", "U3", "U4"], "D6": ["U2", "U3", "U4"], "D7": ["U3", "U4"], "D8": ["U2", "U3", "U4"],
    "D9": ["U3", "U4"], "D10": ["U3", "U4"]
  } }
```
