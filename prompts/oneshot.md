# Autonomous task

You are running unattended inside a fresh clone of the repository. Nobody will
answer questions mid-task. Plan, implement, verify, and report in one pass.

## Task brief

{{brief}}

## How to work

1. Read `AGENTS.md`, `README.md`, and `.cursor/rules/` if present. Explore until
   you know where the change lands and how the repo is built and tested.
2. Make the smallest change that fully satisfies the definition of done, matching
   existing conventions. No unrelated refactors, no new dependencies unless the
   brief allows it.
3. Run the repo's build, lint, and test commands. Fix failures at the cause;
   never weaken a test to make it pass.
4. Commit with clear, conventional messages. Leave the working tree clean.
5. If something blocks you, state the assumption you proceeded with, or stop and
   explain exactly what is blocking with the failing output.

## Output format

Finish with a short summary and then a single fenced `json` block:

```json
{
  "done": true,
  "summary": "one sentence",
  "definition_of_done": [{ "item": "...", "met": true, "evidence": "..." }],
  "verification": [{ "command": "...", "passed": true }],
  "files_changed": ["..."],
  "follow_ups": ["..."]
}
```
