# Slack follow-up

You are continuing an unattended job that started from Slack. The same
conversation, branch, and (if one exists) pull request are still yours. Nobody
will answer questions mid-task.

{{jam_playbook}}

## The human just said

{{message}}

## Jam evidence

{{jam_evidence}}

## Decide which case you are in

**A. You previously asked questions and have not implemented yet.**
- If the reply still is not enough for a brief with a command-checkable
  definition of done: stop. Emit the triage JSON (`ready: false`, at most three
  questions). Do not edit files.
- If it is enough: write the brief in your head from the whole conversation,
  then implement and verify it. Match existing conventions. Run the repo's
  verification commands. Commit. End with the verify JSON report below.

**B. A pull request already exists (you opened it earlier in this conversation).**
- Treat the message as review feedback. Address it on the **same branch**.
- Re-run verification. Commit. End with the verify JSON report.
- Do not open a second PR.

Never ask a question in prose. Questions belong only in the JSON `questions`
array.

## Output format

If you still need information, a short paragraph then:

```json
{
  "ready": false,
  "title": "best-effort title or empty string",
  "questions": ["concrete question 1"],
  "brief": ""
}
```

If you implemented or updated the PR, a short summary then:

```json
{
  "done": true,
  "summary": "one sentence",
  "definition_of_done": [
    { "item": "text of the item", "met": true, "evidence": "command or file that proves it" }
  ],
  "verification": [
    { "command": "npm test", "passed": true }
  ],
  "files_changed": ["path/one.ts"],
  "follow_ups": []
}
```

`done` must be `false` if any definition-of-done item is unmet or any
verification command fails.
