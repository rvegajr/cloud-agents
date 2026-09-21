# Problem: jsoncount — a CLI that counts values, objects and arrays in a JSON document

## Given

- The repo `rvegajr/polya-live-json-count`, current commit `f1f598a`, contains only
  `README.md` (one line: `# polya-live-json-count`) and `.gitignore`. No `package.json`,
  no source, no tests exist yet — this is a from-scratch build.
- `.gitignore` (repo root, current commit) already excludes `node_modules/`, `dist/`,
  `build/`, `coverage/`, `*.db*`, `*.sqlite*`, `.env`, and `.polya/`.
- The request text itself (given above; no `templates/REQUEST.md` file is present in this
  repo to drift from).
- `ideas/ready/farm-json-lines.md`, named in "What you already know," is not present in
  this repo. It is described as saying nothing about empty stdin, stderr shape, or nesting,
  so it adds nothing this problem's own text doesn't already state; not read further.
- Target runtime: Node 22 or newer, macOS and Linux. A stranger installs with `npm ci`
  and then works with no network.
- *(immovable)* The command name is `jsoncount`: it must be both the package's `bin` entry
  and the `npm run` script name, because a Makefile outside this repo already invokes it
  by that name.

## Unknown

A Node CLI package, installable with `npm ci` from a fresh clone, exposing a `jsoncount`
executable (via `package.json` `bin`) and an `npm run jsoncount` script, that:
- reads one JSON document from a named file argument, or from stdin when no file argument
  is given;
- on valid JSON, recursively counts three things — object nodes (`{...}`), array nodes
  (`[...]`), and scalar leaf values (string/number/boolean/null) — and prints exactly one
  line to stdout holding only those three numbers, each with a label, in a shape a `awk`
  split on whitespace can read;
- on invalid JSON (including empty stdin), prints exactly one line to stderr, prints
  nothing to stdout, and exits non-zero;
- has zero runtime dependencies beyond Node's own core modules, and does no streaming,
  NDJSON handling, coloring, or config-file reading;
- runs a 50 MB pretty-printed input to completion in a few seconds.

## Condition

- Counting is recursive and whitespace-insensitive: a pretty-printed document and its
  minified equivalent (same values, different formatting) must produce byte-identical
  stdout.
- "Value" means a scalar leaf (string, number, `true`, `false`, `null`); an object or
  array node is counted under its own label, not also as a value.
- Any input `JSON.parse` would reject — including a truncated/malformed file and empty
  stdin — is an error: non-zero exit, exactly one stderr line, empty stdout. Never a
  zero-count success line.
- The package's declared `engines.node` minimum must be a version under which the code
  actually runs unflagged (per L-2026-09-19-02 — stabilization/flag history matters, not
  just first appearance).
- The `bin`/script name `jsoncount` cannot change.

## Restated

`jsoncount` is a zero-dependency Node CLI that reads one JSON document — a named file or
stdin — and prints exactly one stdout line reporting three counts: object nodes, array
nodes, and scalar values, counted recursively through nesting. Formatting must not affect
the result: pretty-printed and minified copies of the same document produce identical
output. Wrong looks like: quietly succeeding on text `JSON.parse` rejects, missing values
or objects nested inside arrays, or taking more than a few seconds (or dying) on a 50 MB
pretty-printed file. The requester judges it by running `npm ci` then
`printf '{"a":[1,2,{"b":null}]}' | npx jsoncount`, by diffing pretty vs. minified output,
and by feeding it `broken.json` and empty stdin and checking both fail loudly — non-zero
exit, one stderr line, nothing on stdout — instead of returning a line of zeros.

## Done-checks

- D1: The walkthrough command, run verbatim, prints one stdout line whose three numbers
  correctly count the nested example (2 objects, 1 array, 3 values). — Check:
  `out=$(printf '{"a":[1,2,{"b":null}]}' | npx jsoncount); [ "$(printf '%s\n' "$out" | wc -l)" -eq 1 ] && [ "$(printf '%s' "$out" | grep -oE '[0-9]+' | sort -n | tr '\n' ' ')" = "1 2 3 " ]` — Now: unmet
- D2: A pretty-printed file and a minified copy of the same document produce identical
  stdout. — Check:
  `p=$(printf '{\n  "a": [\n    1,\n    2,\n    {\n      "b": null\n    }\n  ]\n}' | npx jsoncount); m=$(printf '{"a":[1,2,{"b":null}]}' | npx jsoncount); [ "$p" = "$m" ]` — Now: unmet
- D3: `jsoncount broken.json` on malformed JSON exits non-zero, prints exactly one line
  on stderr, and prints nothing on stdout. — Check:
  `d=$(mktemp -d) && (cd "$d" && printf '{"a":' > broken.json && npx jsoncount broken.json >out.txt 2>err.txt; c=$?; [ $c -ne 0 ] && [ ! -s out.txt ] && [ "$(wc -l < err.txt)" -eq 1 ])` — Now: unmet
- D4: Empty stdin is an error — non-zero exit, no stdout line of zeros. — Check:
  `printf '' | npx jsoncount >out.txt 2>err.txt; c=$?; [ $c -ne 0 ] && [ ! -s out.txt ]` — Now: unmet
- D5: A ~50 MB pretty-printed JSON array is counted correctly within a few seconds and
  without crashing. — Check:
  `node -e "process.stdout.write(JSON.stringify(Array.from({length:1200000},()=> 'x'.repeat(40)), null, 2))" > big.json && ls -la big.json && t0=$(date +%s); npx jsoncount big.json >out.txt; c=$?; t1=$(date +%s); [ $c -eq 0 ] && [ $((t1-t0)) -le 8 ] && [ "$(wc -l < out.txt)" -eq 1 ]` — Now: unmet
- D6: Malformed CLI usage — a nonexistent file argument, or an unknown flag — exits
  non-zero with a stderr message and never crashes with an unhandled-exception stack
  trace. — Check:
  `npx jsoncount /no/such/file.json </dev/null >o1.txt 2>e1.txt; c1=$?; npx jsoncount --bogus-flag </dev/null >o2.txt 2>e2.txt; c2=$?; [ $c1 -ne 0 ] && [ -s e1.txt ] && [ $c2 -ne 0 ] && [ -s e2.txt ]` — Now: unmet
- D7: The package installs and runs correctly under the exact minimum Node version its
  own `engines.node` declares (actually executed under that version, not merely satisfied
  by whatever Node the build machine happens to run). — Check:
  `v=$(node -p "require('./package.json').engines.node.replace(/[^0-9.]/g,'')") && docker run --rm -v "$PWD":/app -w /app node:${v}-slim sh -c 'npm ci >/dev/null 2>&1 && out=$(printf "%s" "{\"a\":[1,2,{\"b\":null}]}" | npx jsoncount) && echo "$out" | grep -oE "[0-9]+" | sort -n | tr "\n" " " | grep -qx "1 2 3 "'` — Now: unmet
- D8: `README.md` alone (with no other guidance) documents the install and usage steps
  needed to reproduce the walkthrough. — Check:
  `grep -q "npm ci" README.md && grep -qi "jsoncount" README.md && grep -qiE "printf|stdin" README.md` — Now: unmet

## Not this

- No NDJSON support, no streaming parser, no colored output, no config file.
- No runtime dependencies beyond Node's own core modules.
- No change to the `jsoncount` bin/script name.

## Quality bar

The repo has no `package.json`, `Makefile`, or `pyproject.toml` yet (confirmed by listing
the fresh clone), so no `test`/`lint`/`typecheck`/`start` command can be read off an
existing file. Two commands are named directly by the materials rather than invented:
`npm ci`, from the requester's own walkthrough, and `npm test`, the standard companion to
the `npm run jsoncount` script `Must not change` already requires — the same `scripts`
block in `package.json` this build must create either way. `npm test` is the command the
build's own automated suite (exercising D1–D6 and D8) runs under; no `lint`/`typecheck`/
`start` is named anywhere in the materials, so none is added.

| Command | Purpose |
|---|---|
| `npm ci` | install from a fresh clone, as named in the requester's own walkthrough |
| `npm test` | run the automated suite exercising D1–D6 and D8 (D7 needs Docker, run separately) |

## Lessons consulted

- L-2026-09-18-01: not applicable because — this Understand turn writes no plan or unit
  Givens; applies when a later devise turn would otherwise paste file content instead of
  naming the file.
- L-2026-09-18-02: not applicable because — this problem is not split into sub-plans (see
  Split: none), so there is no cross-sub-problem D to track in a Trace.
- L-2026-09-18-03: not applicable because — the repo has no existing check, CI job, or
  inspection to adopt; it is a bare scaffold (README + .gitignore only).
- L-2026-09-19-01: applied as D6, adapted from HTTP paths to CLI arguments — a nonexistent
  file and an unknown flag must be answered with a clean error, never a crash.
- L-2026-09-19-02: applied as D7 — `engines.node` must name the version where the code
  actually runs unflagged, verified by installing that exact version, not trusted from
  whatever Node the build machine happens to run.
- L-2026-09-19-03: not applicable because — no plan or unit Do/Check text is written in
  this turn; applies when a later devise turn gives a unit's Do file content verbatim.
- L-2026-09-19-04: not applicable because — `jsoncount` has no format-into-a-field /
  parse-back-on-save edit path; it only reads and counts.
- L-2026-09-19-05: not applicable because — there is no browser page, DOM, or `fetch`-based
  `start()` wiring here; this is a Node CLI reading stdin/a file.
- L-2026-09-19-08: applied as D1 and D8 — both use the exact commands the requester named
  (`npm ci`, `npx jsoncount`, the literal `printf` pipe), not a sibling command.
- L-2026-09-19-09 (storage/journal-file variant): not applicable because — `jsoncount` is
  stateless; it writes nothing to disk, so no `*.db`/journal ignore-rule gap can arise.
- L-2026-09-19-09 (repair-unit-Check variant, text truncated in the ledger extract): not
  applicable because — this is a `build` problem from a blank scaffold, not a repair of an
  existing bug with a missing reproduction test.
- L-2026-09-19-10: not applicable because — no D here names a browser-only capability
  (clipboard, drag-drop); `jsoncount` is a stdin/file-reading CLI with no browser surface
  for a headless verifier to fall short on.
- L-2026-09-20-01: not applicable because — no units or Touches exist yet; this Understand
  turn writes no plan. Applies when the next devise turn assigns file ownership, and again
  if any later Hand turn's files get reverted twice for the same Touches violation.
- L-2026-09-20-02: applied as D7 — D7's Check is its own self-contained command (Docker,
  pinned Node version, the nested-example assertion), not text borrowed from D1 or any
  other D's evidence; a later verify turn must record D7-specific run output, not reuse
  another check's observation.
- L-2026-09-20-03: applied as D7 — D7's Check actually executes under the exact pinned
  `engines.node` minimum via Docker (`node:${v}-slim`), rather than accepting that the
  build machine's ambient Node merely satisfies the declared range.

## Oracle

- O1: adopted as D3, D6 — bad JSON input and bad CLI arguments are both refused with a
  clear error and change nothing (no output file, no partial stdout).
- O2: dismissed — `jsoncount` has no stored list or search UI; there is no "empty state"
  or "no matches" concept, only a single parse-and-count per run.
- O3: dismissed — the only "action" is parse-and-count; its failure mode is already the
  loud stderr/exit-code contract in D3 and D4, not a separate save/copy/request path.
- O4: adopted as D6 (unknown flag, nonexistent file) and D4 (empty stdin); the path-syntax
  parts of O4 (`//`, `%2f`, a 2 KB path, a wrong HTTP method) do not apply — this is a CLI
  with no HTTP surface.
- O5: dismissed — `jsoncount` stores nothing; there is no state to survive a restart.
- O6: adopted as D7.
- O7: adopted as D1 and D8 — both run the exact commands the requester says they will
  type.
- O8: adopted as D8.

## Request

- J1: adopted as D2.
- J2: adopted as D3.
- J3: adopted as D4.
- J4: adopted as D1.
- W1: adopted as D3 (same contract: a rejected-by-`JSON.parse` file must not exit 0).
- W2: adopted as D1 (the nested example is the walkthrough itself).
- W3: adopted as D5.
- M1: immovable — `package.json` `bin.jsoncount` and an `npm run jsoncount` script; an
  external Makefile (outside this repo) already calls it by that name. No done-check
  needs it moved.

## Split

None — this is a single build small enough for one plan; all D1–D8 fit within it.

```json problem
{ "kind": "build", "size": "M",
  "done": [
    { "id": "D1", "text": "Walkthrough command counts the nested example correctly (2 objects, 1 array, 3 values) in one labelled stdout line.", "check": "out=$(printf '{\"a\":[1,2,{\"b\":null}]}' | npx jsoncount); [ \"$(printf '%s\\n' \"$out\" | wc -l)\" -eq 1 ] && [ \"$(printf '%s' \"$out\" | grep -oE '[0-9]+' | sort -n | tr '\\n' ' ')\" = \"1 2 3 \" ]", "outer": true, "now": "unmet" },
    { "id": "D2", "text": "Pretty-printed and minified copies of the same document produce identical stdout.", "check": "p=$(printf '{\\n  \"a\": [\\n    1,\\n    2,\\n    {\\n      \"b\": null\\n    }\\n  ]\\n}' | npx jsoncount); m=$(printf '{\"a\":[1,2,{\"b\":null}]}' | npx jsoncount); [ \"$p\" = \"$m\" ]", "outer": true, "now": "unmet" },
    { "id": "D3", "text": "jsoncount broken.json exits non-zero, prints exactly one stderr line, prints nothing on stdout.", "check": "d=$(mktemp -d) && (cd \"$d\" && printf '{\"a\":' > broken.json && npx jsoncount broken.json >out.txt 2>err.txt; c=$?; [ $c -ne 0 ] && [ ! -s out.txt ] && [ \"$(wc -l < err.txt)\" -eq 1 ])", "outer": true, "now": "unmet" },
    { "id": "D4", "text": "Empty stdin is an error: non-zero exit, no zero-count stdout line.", "check": "printf '' | npx jsoncount >out.txt 2>err.txt; c=$?; [ $c -ne 0 ] && [ ! -s out.txt ]", "outer": true, "now": "unmet" },
    { "id": "D5", "text": "A ~50 MB pretty-printed JSON file is counted correctly within a few seconds and without crashing.", "check": "node -e \"process.stdout.write(JSON.stringify(Array.from({length:1200000},()=> 'x'.repeat(40)), null, 2))\" > big.json && t0=$(date +%s); npx jsoncount big.json >out.txt; c=$?; t1=$(date +%s); [ $c -eq 0 ] && [ $((t1-t0)) -le 8 ] && [ \"$(wc -l < out.txt)\" -eq 1 ]", "outer": true, "now": "unmet" },
    { "id": "D6", "text": "A nonexistent file argument or an unknown flag exits non-zero with a stderr message, never an unhandled-exception crash.", "check": "npx jsoncount /no/such/file.json </dev/null >o1.txt 2>e1.txt; c1=$?; npx jsoncount --bogus-flag </dev/null >o2.txt 2>e2.txt; c2=$?; [ $c1 -ne 0 ] && [ -s e1.txt ] && [ $c2 -ne 0 ] && [ -s e2.txt ]", "outer": true, "now": "unmet" },
    { "id": "D7", "text": "The package installs and runs correctly under the exact minimum Node version its own engines.node declares, actually executed under that version via Docker.", "check": "v=$(node -p \"require('./package.json').engines.node.replace(/[^0-9.]/g,'')\") && docker run --rm -v \"$PWD\":/app -w /app node:${v}-slim sh -c 'npm ci >/dev/null 2>&1 && out=$(printf \"%s\" \"{\\\"a\\\":[1,2,{\\\"b\\\":null}]}\" | npx jsoncount) && echo \"$out\" | grep -oE \"[0-9]+\" | sort -n | tr \"\\n\" \" \" | grep -qx \"1 2 3 \"'", "outer": true, "now": "unmet" },
    { "id": "D8", "text": "README.md alone documents the install and usage steps needed to reproduce the walkthrough.", "check": "grep -q \"npm ci\" README.md && grep -qi \"jsoncount\" README.md && grep -qiE \"printf|stdin\" README.md", "outer": true, "now": "unmet" }
  ],
  "lessons": [
    { "id": "L-2026-09-18-01", "disposition": "not applicable — no plan/unit Givens written this turn" },
    { "id": "L-2026-09-18-02", "disposition": "not applicable — no sub-plan split" },
    { "id": "L-2026-09-18-03", "disposition": "not applicable — repo has no existing check to adopt" },
    { "id": "L-2026-09-19-01", "disposition": "applied as D6, adapted to CLI args (no HTTP surface)" },
    { "id": "L-2026-09-19-02", "disposition": "applied as D7" },
    { "id": "L-2026-09-19-03", "disposition": "not applicable — no unit Do/Check text written this turn" },
    { "id": "L-2026-09-19-04", "disposition": "not applicable — no format/parse round-trip edit path" },
    { "id": "L-2026-09-19-05", "disposition": "not applicable — no browser page or fetch-based start()" },
    { "id": "L-2026-09-19-08", "disposition": "applied as D1 and D8" },
    { "id": "L-2026-09-19-09-storage", "disposition": "not applicable — jsoncount is stateless, writes nothing to disk" },
    { "id": "L-2026-09-19-09-repair", "disposition": "not applicable — this is a build, not a repair with a missing reproduction test" },
    { "id": "L-2026-09-19-10", "disposition": "not applicable — no D names a browser-only capability; jsoncount has no browser surface" },
    { "id": "L-2026-09-20-01", "disposition": "not applicable — no units/Touches exist yet this turn; applies at devise/carry-out" },
    { "id": "L-2026-09-20-02", "disposition": "applied as D7 — its Check is self-contained, not reused evidence from another D" },
    { "id": "L-2026-09-20-03", "disposition": "applied as D7 — actually executes under the pinned engines.node minimum via Docker" }
  ],
  "split": [],
  "bar": [
    { "command": "npm ci", "purpose": "install from a fresh clone, per the requester's walkthrough" },
    { "command": "npm test", "purpose": "run the automated suite exercising D1-D6 and D8 (D7 needs Docker, run separately)" }
  ]
}
```
