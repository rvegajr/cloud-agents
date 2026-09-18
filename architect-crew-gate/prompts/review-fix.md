# Job: fix turn (review findings)

You are one crew turn. An independent reviewer read the code and confirmed the
defects below at specific files and lines. They are confirmed, not suggested.
Do not argue with them, do not re-verify their premise. Apply each fix exactly
as written.

## Findings (verbatim from the review)

{{findings}}

## Files you may write

{{allowed_files}}

## Procedure

1. `git status` must be clean. For each finding, in order: open `file` at
   `line`, apply `fix` exactly, and if a `check` is given, run it and confirm
   the expected exit code.
2. Run the full quality bar from `QUALITY.md`. All must exit 0.
3. Commit: `fix(review): <finding ids>`. Working tree clean.

## Rules the gate enforces

- Never weaken, skip, or delete a test or check. If a finding's fix would
  require that, do not apply it; report it under `could_not`.
- Do not edit tooling config, task-runner scripts, or the five architect
  documents. Do not write outside the allowed files. Do not add dependencies.
- Your report is a claim; the orchestrator runs every `check` after this turn.

## Output

A short summary, then a single fenced `json` block, nothing after it:

```json
{
  "task_id": "REVIEW-FIX",
  "done": true,
  "applied": [ { "id": "V1", "check_exit": 0 } ],
  "could_not": [ { "id": "V2", "reason": "would require editing a test / file not allowed" } ],
  "files_changed": ["..."],
  "commands_run": [ { "command": "npm test", "exit": 0 } ],
  "notes": ""
}
```
