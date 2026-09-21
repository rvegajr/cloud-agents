# Request: jsoncount must not crash on a deeply nested document

<!-- kind: repair, on rvegajr/polya-live-json-count at claude/f9a3cb48. The reviewer's medium finding from R3. -->

## Why
`lib/count.js` recurses once per nesting level. A valid document nested a few thousand
levels deep passes `JSON.parse` and then kills the process with a raw `RangeError` stack
trace on stderr, which breaks the one-line-stderr contract the tool promises.

## I will judge it by
- `python3 -c 'print("["*100000 + "]"*100000)' | npx jsoncount` prints the counts and exits 0, or prints exactly one line on stderr and exits non-zero; never a stack trace.
- Every existing test still passes unchanged.
- The 50 MB flat document is still counted in a few seconds.

## Wrong looks like
- A depth cap that silently truncates the count and exits 0.
- A rewrite that changes the numbers for any document the current tests cover.

## Must not change
- `test/cli.test.js`
- `bin/cli.js` (the CLI contract lives there; the fix is in the counting engine)

## Not this
- No dependencies. No worker threads.

## Where it lives, who uses it
Node 22 or newer, macOS and Linux, a stranger from a fresh clone after `npm ci`.

## The one walk-through
I run `npm ci`, then `python3 -c 'print("["*100000 + "]"*100000)' | npx jsoncount` and see one line of counts.
