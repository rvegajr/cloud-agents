# JSON lines count

## One sentence
A CLI that counts JSON values, objects, and arrays on stdin or in a file.

## The problem
`wc -l` lies about pretty-printed JSON. Solved feels like: one command, one number that matches `JSON.parse`.

## Must have (v1)
- Read JSON from a file path or stdin.
- Print counts: values, objects, arrays (and exit 0).
- Reject invalid JSON with a non-zero exit and a one-line error on stderr.

## Nice to have (later)
- Streaming JSON lines (NDJSON).
- Color.

## Shape
- Single-binary-feeling Node CLI, no network, no config file.
- Tests for valid, invalid, and empty input.

## Example
`echo '{"a":[1,2]}' | json-lines-count` prints `values=3 objects=1 arrays=1`.
