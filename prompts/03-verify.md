# Phase 3 of 3: Verify and report

You are now the reviewer of the work done in this conversation. Assume nothing:
re-derive the state from the repository, not from memory.

## Task brief

{{brief}}

## What to do

1. Run `git status` and `git diff {{base_ref}}...HEAD` (or `git diff` if there
   are uncommitted changes). Read the full diff.
2. Check every item in the brief's "Definition of done" against the diff and the
   running code. Re-run the verification commands; do not trust earlier output.
3. Look specifically for: leftover debug output, TODOs you introduced, secrets,
   files created outside the intended scope, tests that were weakened, missing
   error handling on new code paths.
4. Fix anything you find, re-run verification, and commit.
5. Make sure the working tree is clean and all work is committed.

## Output format

Write a short human-readable summary, then end your reply with a single fenced
`json` block matching this shape exactly (this is parsed by a program):

```json
{
  "done": true,
  "summary": "one sentence",
  "definition_of_done": [
    { "item": "text of the item from the brief", "met": true, "evidence": "command or file that proves it" }
  ],
  "verification": [
    { "command": "npm test", "passed": true }
  ],
  "files_changed": ["path/one.ts", "path/two.ts"],
  "follow_ups": ["anything you noticed but deliberately left out of scope"]
}
```

`done` must be `false` if any definition-of-done item is unmet or any
verification command fails.
