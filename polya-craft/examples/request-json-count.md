# Request: a CLI that counts the values, objects and arrays in a JSON document

<!-- templates/REQUEST.md filled in. This is the request behind the first live run that measured
     whether the requester's own lines reach the done-checks (2026-09-20, polya-live-json-count). -->

## Why
`wc -l` lies about pretty-printed JSON, and `jq` is not on every box I touch. Solved feels
like: one command, one line of numbers, the same numbers whether the file is minified or
pretty-printed, and a loud failure when the file is not JSON.

## I will judge it by
- I pipe a pretty-printed file and a minified copy of it and get identical numbers.
- `jsoncount broken.json` exits non-zero, prints exactly one line on stderr, and prints nothing on stdout.
- Empty stdin is an error with a non-zero exit, not a line of zeros.
- The line on stdout is only the three numbers with their labels, so `awk` can read it.

## Wrong looks like
- A file `JSON.parse` rejects still gets a count and exit 0.
- Nested values are missed: `{"a":[1,2,{"b":null}]}` must count the inner object and both scalars.
- A 50 MB pretty-printed file makes the process take more than a few seconds, or dies.

## Must not change
- The command is `jsoncount`, as the package `bin` and the `npm run` script name; a Makefile elsewhere already calls it.

## Not this
- No NDJSON, no streaming, no color, no config file, no dependencies beyond Node's own modules.

## Where it lives, who uses it
Node 22 or newer, macOS and Linux. A stranger runs it from a fresh clone with `npm ci` and no
network after that. They have never seen this repo and will not read anything but the README.

## The one walk-through
I run `npm ci`, then `printf '{"a":[1,2,{"b":null}]}' | npx jsoncount` and see one line with
three labelled numbers. I run `npx jsoncount big.json` on a 50 MB pretty-printed file and it
finishes in a few seconds with the same shape of line.

## What you already know
- `ideas/ready/farm-json-lines.md` is the feature-only version of this request; it says nothing
  about empty stdin, stderr shape, or nesting.
