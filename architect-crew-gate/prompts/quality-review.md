# Quality review: blind rubric

You are scoring a candidate implementation you have never seen, built by a
team you know nothing about. You do not know which tool or model produced it
and you must not guess; the repository name and any tool names have been
removed on purpose. Score what is in front of you.

## The job the candidate was given

{{job}}

## Hygiene facts recorded before anonymisation (score these under "structure")

{{hygiene}}

## Probes you must run before scoring

Run them in this order in this directory, on ephemeral ports. Do not edit any
file. Stop any server you start.

1. Install with the documented command (`npm ci`, `uv sync`, …). Note whether
   the README's command works as written.
2. Run the documented test command. Record pass/fail counts.
3. Run the lint and typecheck commands if the project defines them.
4. Start the application as the README says, on a spare port. Exercise every
   core flow the job describes: create, list, search, update, delete, or the
   CLI's documented invocations. Try one malformed input per route (wrong type,
   missing field, non-numeric id) and one unknown route.
5. Read the README as a stranger: could you run this from a clean clone with
   only what it says?

## Criteria and anchors (score each 1–5)

**correctness** — against the job as stated.
1 does not run · 2 runs, a core flow is missing or wrong · 3 core flows work,
notable gaps · 4 all flows work, minor issues · 5 nothing to fix.

**security** — injection, escaping, limits.
1 string-built SQL or unescaped user HTML · 2 a real hole you demonstrated ·
3 parameterised and escaped, but a boundary missed (attribute, copy, URL) ·
4 sound, one minor gap · 5 no surface you could find.

**validation** — input validation and error handling.
1 crashes on bad input · 2 500s where a 400 belongs, HTML where JSON belongs ·
3 mostly right, inconsistent · 4 consistent envelope, right codes, one miss ·
5 every route, every case.

**tests** — what is asserted, not how many.
1 no tests or tests that cannot fail · 2 tests assert "does not throw" or mock
the thing under test · 3 real assertions, gaps in negative cases · 4 behaviour
covered, negatives covered, isolated · 5 a suite you would keep.

**structure** — idiom, dependency injection, interface segregation, hygiene.
1 tool junk or build output tracked, or config bent to pass · 2 import-time
side effects, a singleton that blocks testing · 3 workable, some duplication
or dead code · 4 injected, small interfaces, clean tree · 5 exemplary.

**ux** — faithfulness to the described flows.
1 flows missing · 2 flows present but broken states · 3 works, rough edges ·
4 works, feedback and empty states handled · 5 nothing a user would notice.

**readme** — accuracy from a clean clone.
1 wrong or missing · 2 a documented command fails · 3 works with a step you
had to guess · 4 works as written · 5 works as written and says what it is.

## Rules

- Every score cites at least one `file:line` or a command you ran and what it
  printed. No evidence, no score above 2.
- `total` is the sum of the seven scores; compute it, do not estimate it.
- `verdict` is `do-not-merge` if security or correctness is 1 or 2;
  `merge-with-followup` if any criterion is 3 or there are blocking issues;
  else `merge`.

## Output

A short summary, then a single fenced `json` block, nothing after it:

```json
{
  "scores": {
    "correctness": { "score": 4, "evidence": ["src/app.js:12 …", "curl POST -> 201"] },
    "security":    { "score": 4, "evidence": ["…"] },
    "validation":  { "score": 3, "evidence": ["…"] },
    "tests":       { "score": 4, "evidence": ["…"] },
    "structure":   { "score": 4, "evidence": ["…"] },
    "ux":          { "score": 4, "evidence": ["…"] },
    "readme":      { "score": 5, "evidence": ["…"] }
  },
  "total": 28,
  "blocking_issues": ["…"],
  "verdict": "merge-with-followup"
}
```
