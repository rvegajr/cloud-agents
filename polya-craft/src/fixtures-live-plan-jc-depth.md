# Plan for: jsoncount must not crash on a deeply nested JSON document

<!-- Devise only. Every unit must pass the stranger test before this plan is handed over.
     See PATTERN.md sections 2.2 and 3. -->

## Approach

The method is the standard fix for "recursion blows the native call stack on a deep but
valid tree": replace the recursive walk with an iterative one that keeps its own
worklist on the heap (a plain JS array used as a stack) instead of the JS engine's call
stack. This is the same family of fix as converting a recursive tree-walk or quicksort
to an explicit-stack version — depth becomes bounded by available memory, not by V8's
fixed native stack frame budget. Verified directly in this checkout before writing this
plan: the rewritten function counts a 1,000,000-level-deep array correctly in ~72 ms,
counts every existing test's document unchanged (`npm test`: `pass 11`, `fail 0`), and
still counts a flat ~46 MB / 1.4M-item array in ~1 s.

Deliberately not attempted:
- No chunked/async traversal (`setImmediate` slicing, generators) — a plain array-backed
  stack is already fast enough (D4) and simpler; chunking would only be needed if the
  synchronous walk itself were too slow, which it is not.
- No depth cap or truncation — forbidden outright (W1); the fix removes the coupling
  between nesting depth and stack limits instead of papering over it.
- No change to `JSON.parse` or the parsing step — `JSON.parse` already handles a
  100,000-deep document today (confirmed in `Given`); only the post-parse counting walk
  in `lib/count.js` is broken.
- No dependencies, no worker threads (Not this).
- No new persisted test file added to `test/count.test.js` or elsewhere. `L-2026-09-19-09`
  (repair/carry-out variant) suggested widening test coverage with a new regression
  test, and `test/count.test.js` is not immovable — but `PROBLEM.md`'s own `D3` Check
  greps the `node --test` summary for the exact string `pass 11`. Any new test file (or
  new test case) that `node --test` discovers changes that summary to `pass 12` and
  would fail `D3` even though every original assertion still passes. Since `PROBLEM.md`
  is not edited in this turn, the plan keeps both test files byte-for-byte untouched and
  relies on `D1` and `D2` — both already standalone, stranger-runnable commands that do
  not depend on any file in the suite — as the deep-nesting regression evidence. This is
  flagged again in this plan's output `notes`.

## Shape

- L2 whole — check: the Outer test below (all of D1, D2, D3, D4 pass together against
  the same fixed `lib/count.js`).
- L1:fix — check: adopted verbatim from `PROBLEM.md`'s own D1–D4 Check commands (no
  parallel check written, per L-2026-09-18-03); closed by U1 alone.
- L0 units — U1.

## Outer test

1. From a fresh clone, run `npm ci`, then `npm test`. Expect the summary lines
   `ℹ pass 11` and `ℹ fail 0`, process exit 0. (D3)
2. Run `python3 -c 'print("["*100000 + "]"*100000)' | npx jsoncount`. Expect stdout
   `objects: 0 arrays: 100000 values: 0` on one line, exit 0, and nothing on stderr.
   (D1)
3. Run
   `node -e "const {countJSON}=require('./lib/count'); const s='['.repeat(100000)+']'.repeat(100000); const p=JSON.parse(s); const c=countJSON(p); console.log(c); process.exit((c.arrays===100000 && c.objects===0 && c.values===0)?0:1)"`.
   Expect it to print `{ objects: 0, arrays: 100000, values: 0 }` and exit 0 — no
   `RangeError`, no stack trace. (D2)
4. Run
   `node -e "process.stdout.write(JSON.stringify(Array.from({length:1400000},()=>String.fromCharCode(120).repeat(30))))" > /tmp/jc_big.json`,
   then `time npx jsoncount /tmp/jc_big.json`. Expect one stdout line containing
   `values: 1400000`, exit 0, finishing in a few seconds (well under 8s). (D4)

## Units

## U1: Rewrite countNode as an iterative, explicit-stack traversal
Serves:   D1 D2 D3 D4
Level:    L1:fix
Produces: `lib/count.js`
Given:    `lib/count.js`'s current exported signatures, which must not change:
```js
function countNode(node, counts) // returns counts; counts = {objects, arrays, values}
function countJSON(parsed)       // returns countNode(parsed, {objects:0, arrays:0, values:0})
module.exports = { countJSON, countNode };
```
`bin/cli.js` *(immovable, M2, read-only context — do not open to edit)* calls only
`countJSON(parsed)` and expects it to either return `{objects, arrays, values}` or throw
something its own `JSON.parse` try/catch does not wrap — so `countJSON` must not throw
for any input that parsed successfully; it must always return.
Do:
1. Open `lib/count.js`.
2. Replace the entire contents of the file with exactly:
```js
'use strict';

function countNode(node, counts) {
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      counts.arrays += 1;
      for (const item of current) {
        stack.push(item);
      }
    } else if (current !== null && typeof current === 'object') {
      counts.objects += 1;
      for (const key of Object.keys(current)) {
        stack.push(current[key]);
      }
    } else {
      counts.values += 1;
    }
  }
  return counts;
}

function countJSON(parsed) {
  return countNode(parsed, { objects: 0, arrays: 0, values: 0 });
}

module.exports = { countJSON, countNode };
```
3. Save the file. It must contain nothing else — no added helper functions, no added
   requires, no depth-limit constant.
4. Do not create, edit, delete, or rename any other file in the repository.
Touches:  `lib/count.js`
Check:
```bash
set -e
bash -c 'o=$(mktemp); e=$(mktemp); python3 -c "print(\"[\"*100000 + \"]\"*100000)" | npx jsoncount >"$o" 2>"$e"; c=$?; ok=1; if [ $c -eq 0 ]; then grep -qx "objects: 0 arrays: 100000 values: 0" "$o" && [ ! -s "$e" ] && ok=0; else [ "$(wc -l < "$e")" -eq 1 ] && ! grep -qE "at Object|at Module|\.js:[0-9]+:[0-9]+" "$e" && ok=0; fi; rm -f "$o" "$e"; exit $ok'
node -e "const {countJSON}=require('./lib/count'); const s='['.repeat(100000)+']'.repeat(100000); const p=JSON.parse(s); const c=countJSON(p); process.exit((c.arrays===100000 && c.objects===0 && c.values===0)?0:1)"
bash -c 'out=$(npm test 2>&1); echo "$out" | grep -q "pass 11" && echo "$out" | grep -q "fail 0"'
bash -c 'node -e "process.stdout.write(JSON.stringify(Array.from({length:1400000},()=>String.fromCharCode(120).repeat(30))))" > /tmp/jc_big.json && t0=$(date +%s); npx jsoncount /tmp/jc_big.json >/tmp/jc_big.out; c=$?; t1=$(date +%s); [ $c -eq 0 ] && [ $((t1-t0)) -le 8 ] && [ "$(wc -l < /tmp/jc_big.out)" -eq 1 ] && grep -q "values: 1400000" /tmp/jc_big.out'
```
Exit 0 means all four of D1–D4 hold. Verified now, against the unmodified repo, this
exits 1 (the first sub-check, D1, fails: today's CLI prints a 17-line stack trace, not
one line). — Now: unmet
Depends:  none
Not:      `bin/cli.js`, `test/cli.test.js`, `test/count.test.js`, `package.json`,
`package-lock.json`, `README.md` — none of these are opened or changed. No depth cap,
no truncation, no dependency, no worker thread, no change to the two exported function
names or their argument/return shapes.

## Order

U1 (only unit; nothing runs before or after it).

## Trace

- D1 → U1 → outer step 2
- D2 → U1 → outer step 3
- D3 → U1 → outer step 1
- D4 → U1 → outer step 4

## Still open

<!-- L only, filled at look back. -->

```json plan
{ "levels": [ { "id": "L1:fix", "check": "D1-D4 Check commands from PROBLEM.md, adopted verbatim; see U1's Check" } ],
  "units": [
    { "id": "U1", "title": "Rewrite countNode as an iterative, explicit-stack traversal", "serves": ["D1", "D2", "D3", "D4"], "level": "L1:fix",
      "produces": "lib/count.js", "touches": ["lib/count.js"],
      "check": "set -e\nbash -c 'o=$(mktemp); e=$(mktemp); python3 -c \"print(\\\"[\\\"*100000 + \\\"]\\\"*100000)\" | npx jsoncount >\"$o\" 2>\"$e\"; c=$?; ok=1; if [ $c -eq 0 ]; then grep -qx \"objects: 0 arrays: 100000 values: 0\" \"$o\" && [ ! -s \"$e\" ] && ok=0; else [ \"$(wc -l < \"$e\")\" -eq 1 ] && ! grep -qE \"at Object|at Module|\\.js:[0-9]+:[0-9]+\" \"$e\" && ok=0; fi; rm -f \"$o\" \"$e\"; exit $ok'\nnode -e \"const {countJSON}=require('./lib/count'); const s='['.repeat(100000)+']'.repeat(100000); const p=JSON.parse(s); const c=countJSON(p); process.exit((c.arrays===100000 && c.objects===0 && c.values===0)?0:1)\"\nbash -c 'out=$(npm test 2>&1); echo \"$out\" | grep -q \"pass 11\" && echo \"$out\" | grep -q \"fail 0\"'\nbash -c 'node -e \"process.stdout.write(JSON.stringify(Array.from({length:1400000},()=>String.fromCharCode(120).repeat(30))))\" > /tmp/jc_big.json && t0=$(date +%s); npx jsoncount /tmp/jc_big.json >/tmp/jc_big.out; c=$?; t1=$(date +%s); [ $c -eq 0 ] && [ $((t1-t0)) -le 8 ] && [ \"$(wc -l < /tmp/jc_big.out)\" -eq 1 ] && grep -q \"values: 1400000\" /tmp/jc_big.out'",
      "depends": [] }
  ],
  "outer": [ { "step": 1, "d": "D3" }, { "step": 2, "d": "D1" }, { "step": 3, "d": "D2" }, { "step": 4, "d": "D4" } ],
  "trace": { "D1": ["U1"], "D2": ["U1"], "D3": ["U1"], "D4": ["U1"] } }
```
