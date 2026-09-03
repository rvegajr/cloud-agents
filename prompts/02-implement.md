# Phase 2 of 3: Implement

Execute the plan from the previous message. The brief is repeated below so you do
not have to scroll.

## Task brief

{{brief}}

## Rules

- Follow the plan. If reality differs from the plan (a file is not where you
  expected, an API changed), adapt and note the deviation in your final report.
- Match the repository's existing conventions: language version, formatting,
  naming, error handling, test style. Read neighbouring files before writing new ones.
- Keep the change surgical. No drive-by refactors, no unrelated formatting churn,
  no new dependencies unless the brief allows it.
- No narrating comments. Comments only for non-obvious intent or constraints.
- Run the verification commands from the plan. If they fail, fix the cause and
  re-run. Do not weaken tests to make them pass.
- Commit as you reach stable checkpoints with clear, conventional commit messages.

## Definition of done

Every item in the brief's "Definition of done" is satisfied and the verification
commands exit 0. If you cannot reach that state, stop and report exactly what is
blocking, with the failing command output.

## Output format

End your reply with:

### Changes
Bullet list of files changed and why.

### Verification run
Each command and its result (pass/fail with the relevant output line).

### Deviations from plan
Bullets, or "None".
