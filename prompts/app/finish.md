# Build an app from an idea: final verification

The loop believes every milestone in `ROADMAP.md` is done. You are the release
gate. Assume nothing; verify from a clean state.

## The idea

{{idea}}

## Procedure

1. `git status` must be clean. `git log --oneline` should show one or more commits
   per milestone. Note anything odd.
2. **Fresh-clone simulation.** In a temporary directory, clone the repo from the
   local checkout (`git clone . /tmp/verify`), then follow **only** the README's
   run instructions. If the README is missing a step, fix the README, not your
   memory.
3. Run the full quality bar from `SPEC.md` in the fresh clone.
4. Start the application and exercise **every core user flow** listed in
   `SPEC.md`, via curl, a test client, or the browser tool, and record what you
   observed for each.
5. Review `SPEC.md` Non-goals: confirm nothing was built that belongs there, and
   nothing listed in Core user flows is missing.
6. Fix anything you find, re-verify, commit. Update `ROADMAP.md` statuses if any
   were wrong.
7. Make sure the README has: what it is, how to install, how to run, how to test,
   and a short "known gaps" section if any exist.

## Output

Finish with a short human-readable summary, then a single fenced `json` block:

```json
{
  "complete": true,
  "summary": "one sentence",
  "user_flows": [{ "flow": "text from SPEC.md", "verified": true, "evidence": "what you ran and saw" }],
  "quality_bar": [{ "command": "npm test", "passed": true }],
  "how_to_run": ["git clone ...", "npm ci", "npm run dev"],
  "known_gaps": ["anything a user would notice is missing or rough"]
}
```

`complete` must be `false` if any user flow is unverified or any quality-bar
command fails.
