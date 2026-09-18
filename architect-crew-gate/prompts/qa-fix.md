# Job: fix turn (QA defects)

You are one crew turn. An independent quality analyst executed the acceptance
scenarios from a fresh clone and observed the defects below. They are observed
facts, not opinions. Do not argue with them, do not re-verify their premise,
do not look for reasons they might be wrong. Fix each one.

## Defects (verbatim from the QA report)

{{defects}}

## Files you may write

{{allowed_files}}

## Procedure

1. `git status` must be clean. For each defect, read `where` and the requirement
   it traces to in `REQUIREMENTS.md`; open the relevant test in `test/` to see
   the behaviour the architect specified.
2. Fix the cause inside the allowed files. If the fix needs a file not listed,
   say which in `notes` and stop.
3. Run the full quality bar from `QUALITY.md`. All must exit 0.
4. Re-run the scenario's `When` yourself if you can from this tree (start on a
   spare port). Confirm `Then` holds.
5. Commit: `fix(qa): <defect ids>`. Working tree clean.

## Rules the gate enforces

- Do not edit any test, tooling config, task-runner script, or the five
  architect documents. A defect whose only fix is a test change is reported in
  `notes`, not fixed.
- Do not write outside the allowed files. Do not add dependencies.
- Your report is a claim; QA runs again after this turn.

## Output

A short summary, then a single fenced `json` block, nothing after it:

```json
{
  "task_id": "QA-FIX",
  "done": true,
  "fixed": [ { "id": "Q3", "change": "one sentence" } ],
  "could_not": [ { "id": "Q5", "reason": "needs file X / test looks wrong" } ],
  "files_changed": ["..."],
  "commands_run": [ { "command": "npm test", "exit": 0 } ],
  "notes": ""
}
```
