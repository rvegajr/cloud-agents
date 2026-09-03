# Loop intervention: no progress detected

The driver noticed that `{{milestone_id}}` has now been reported incomplete
{{stall_count}} turns in a row. Something is stuck. Before doing anything else:

1. Run `git status` and `git log --oneline -10`. State plainly what has and has
   not been committed for this milestone.
2. Re-read the milestone's acceptance items in `ROADMAP.md`. For each one, run
   the check and record pass/fail with the actual output.
3. Decide, in one sentence, which of these is true:
   - **(a)** The milestone is too large. Split it into two in `ROADMAP.md`
     (`{{milestone_id}}a`, `{{milestone_id}}b`), keep the completed items in the
     first, mark it done if it genuinely passes, and commit.
   - **(b)** An acceptance item is wrong or impossible as written (e.g. tests a
     feature `SPEC.md` lists as a non-goal). Rewrite the item to what SPEC.md
     actually requires, note why, and continue.
   - **(c)** You are genuinely blocked. Set Status to `[!] blocked` with the exact
     human action required, commit, and stop.
   - **(d)** It was closer to done than reported. Finish it now.
4. Act on your decision. Commit. Working tree must be clean.

Then produce the same JSON report as a normal iteration:

```json
{
  "milestone_id": "{{milestone_id}}",
  "milestone_title": "...",
  "completed": false,
  "remaining": 0,
  "blocked": false,
  "blocked_reason": null,
  "verification": [{ "command": "...", "passed": true }],
  "commits": ["..."]
}
```
