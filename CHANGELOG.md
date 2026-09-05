# Changelog

Notable changes to this kit. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org/spec/v2.0.0.html).

Releases are annotated git tags (`v0.2.0`). To cut one: move the `Unreleased`
section below under a new heading, then

```bash
npm version minor -m "release: v%s"   # bump package.json, commit, tag
git push --follow-tags
npm run deploy                        # stamp the commit, then ship
```

## [Unreleased]

## [0.2.0] — 2026-09-05

The bot lost its ability to deploy and gained the ability to say what it is.

### Removed

- **The `deploy` command, and every credential behind it.** `@<bot> <project>
  deploy` is gone, along with `src/lib/slack-deploy.ts`, `SLACK_DEPLOYS`,
  `SLACK_DEPLOYERS`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `RAILWAY_TOKEN`, and
  `RAILWAY_API_TOKEN`. A merged pull request is now the only way to ship: it
  leaves a diff, a reviewer, and a revert, none of which a chat message does.
  The reasoning is `ARTICLE-SLACK.md` step 6½.

  Deploy *status* still lands in the channel, unchanged — that has always come
  from Vercel for Slack and Railway's own webhooks, neither of which involves
  this process (`IMPLEMENTATION-GUIDE.md` phase F).

  **Upgrading:** delete those six variables from `.env` and from your host.
  `npm run doctor` warns while any of them are still set. Nothing else in the
  mention CLI changed.

### Added

- **Version reporting.** `src/lib/version.ts` resolves the running build from
  `BUILD_INFO`, then `version.json`, then live `git describe`, then
  `package.json`, and reports which source it used — so a local checkout cannot
  pass itself off as a deployed build. The bot prints it as its first log line
  and answers `@<bot> version` with the detail.
- **`npm run stamp` and `npm run deploy`.** `stamp` writes `version.json` and the
  `BUILD_INFO` pair; `deploy` sets that variable on the linked Railway service
  (with `--skip-deploys`, so it does not queue a second build) and then runs
  `railway up`. The stamp has to travel as a variable because `railway up`
  honours `.gitignore` and a built image has no `.git`.
- **`CHANGELOG.md`** and a documented release flow (`ARTICLE-SLACK.md` step 8½).
- A doctor check in phase E that compares the stamp against `HEAD`, which catches
  the deploy that looked fine and shipped last week's code.

### Changed

- Doctor phases are now **A–G**. The old phase F (deploy targets) is gone;
  notifications moved G→F and Jam/ready-for-review moved H→G.
- `package.json` is `0.2.0`, and `version.json` is gitignored.

## [0.1.0] — 2026-09-04

First public version: the kit as described in `ARTICLE.md` and
`ARTICLE-SLACK.md`.

### Added

- Numbered scripts over the Cursor SDK: login, local smoke test, cloud one-shot,
  the plan → implement → verify pipeline, resume, status, and the idea-to-app
  build loop.
- A Slack front door (`npm run slack`): Bolt in Socket Mode, the mention-as-CLI
  parser, project routing by channel name, jam.dev evidence fetched into the
  prompt, a triage turn allowed to ask questions, and the `agent: bc-…` line that
  makes a thread resumable.
- `target-repo-kit/`: `AGENTS.md`, an always-apply autonomous-agent rule, and
  `.cursor/hooks.json` with a shell guard that blocks force-push, pushes to
  `main`/`master`/`develop`, deploys, and `--no-verify`.
- `GITHUB_TOKEN` support for flipping a verified PR out of draft, with the
  classic-PAT requirement documented.
- `IMPLEMENTATION-GUIDE.md` and `npm run doctor`: a phase-by-phase runbook an AI
  agent can execute, and a read-only preflight that proves every credential,
  scope, and grant, with the fix for each gap.
