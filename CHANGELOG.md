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

### Added

- **COST close on every job.** The last lines of `build-app`, farm jobs, and
  Slack threads are this-run dollars, this-project total, today, last 7 days,
  and a monthly outlook if that pace holds. Append-only `.runs/cost-ledger.jsonl`;
  `npm run cost-board` prints the day/project board. Meters are **AI-agnostic**
  (`cursor:billed`, `claude:api-eq`, `local:local`, or any future provider slug)
  and are never summed into one number. A meter with no spend is omitted, not
  printed as `$0.00`. `COST running` logs as spend arrives. The board harvests
  cents already stored in `.runs/` farm manifests, Claude records, and build
  `chargedCents` — Slack dated json never stored usage, so those jobs stay out
  until a live close writes the ledger. A job still closes with COST when usage
  is unknown.
- **Cursor farm (`npm run build-farm`).** One markdown file per app under
  `--ideas-dir`; a concurrency pool of Cursor Cloud Agents (Fast off); a
  `FARM_MAX_USD` cap; `.runs/farm-*.json` as the review board. Always
  `ENGINE=cursor`. After `gh repo create`, the kit grants the Cursor GitHub App
  (All repositories inherit; Selected repositories get a PUT) and will not boot
  a VM if the grant fails. `src/lib/farm.ts`, `src/10-build-farm.ts`. The
  one-idea loop lives in `src/lib/build-app.ts` so the existing
  `npm run build-app` CLI and the farm share it. First 3-wide probe (17 Sep
  2026, `ideas/ready`, concurrency 3): three VMs CREATING together;
  [farm-json-lines #1](https://github.com/rvegajr/farm-json-lines/pull/1),
  [farm-slugify #1](https://github.com/rvegajr/farm-slugify/pull/1); iso-week
  had no PR. Charged **$1.00**. All three later `run-failed` mid-loop (resume
  `bc-…`). A classic `gh` token cannot list GitHub App installations; All
  repositories still inherited. Do not raise concurrency until a wave
  finishes `complete`.
- **Hybrid and local engines** (`--engine hybrid|local`, `ENGINE=`). Same
  three sends, same `cc-` records and `claude/…` branches as the Claude engine,
  but the implement and verify turns run on a local Ollama model driven by
  qwen-code (or aider) inside the clone, and Claude Max is spent on the plan
  only, plus one rescue turn when the local verifier does not report done.
  `src/lib/engine-local.ts`. The planning prompt gains an "Executor profile"
  section so Max writes plans a memoryless local model can follow verbatim;
  the local model gets the last three turn outputs replayed as context.
- **Max usage ceiling.** `makeClaudeSend` now reports every `rate_limit_event`
  (including the per-window `unifiedWindows` utilization the CLI sends) and the
  handles record it to `.runs/max-usage.json`. Hybrid routing
  reads it before each Claude turn and, at or above `MAX_UTILIZATION_CEILING`
  (default 85%), diverts the turn to `LOCAL_PLANNER_MODEL` or stops
  (`HYBRID_OVER_CEILING`). Extra usage is never bought. `src/lib/routing.ts`.
- `npm run max-usage` prints the 5-hour and 7-day Max windows and records the
  sample for routing, for one trivial Max turn. `tools/max-usage.mts`.
- `npm run pipeline -- --engine claude|hybrid|local` runs the plan/implement/
  verify CLI on a local clone; it was Cursor-only.
- Doctor phase A gains a `local` group: Ollama reachable, `LOCAL_MODEL` pulled,
  runner on PATH, and the last Max usage sample.
- New env: `OLLAMA_HOST`, `LOCAL_MODEL`, `LOCAL_PLANNER_MODEL`, `LOCAL_RUNNER`,
  `LOCAL_TURN_TIMEOUT_MIN`, `MAX_UTILIZATION_CEILING`, `HYBRID_OVER_CEILING`,
  `HYBRID_PLAN`, `HYBRID_IMPLEMENT`, `HYBRID_VERIFY`, `HYBRID_RESCUE`.

### Changed

- **Composer Fast is off.** Every `Agent.create` / `Agent.prompt` now sends
  `params: [{ id: "fast", value: "false" }]` so Composer 2.5 (and Grok) use
  the regular rate card. Cursor's product default is Fast.

### Added

- **Claude Max engine (`ENGINE=claude`).** `src/lib/engine-claude.ts` clones the
  repo, runs `@anthropic-ai/claude-agent-sdk` `query()`, refuses
  `ANTHROPIC_API_KEY`, and stops on Max `credits_required` instead of buying
  extra usage. `npm run build-app -- --engine claude`. Slack uses Max only for
  `SLACK_CLAUDE_USER_IDS`; everyone else stays on Cursor. A `bc-…` Slack thread
  stays on Cursor even if the mentioner is allowlisted. `npm run doctor` runs
  `claude auth status` and fails unless `apiKeySource` is `none`.

- **Snippet-vault A/B (17 September 2026).** Same idea file, both engines
  `complete` in 6 iterations. Cursor composer-2.5 Fast off: **$1.20**, 13.5 min,
  [sv-cursor #1](https://github.com/rvegajr/sv-cursor/pull/1). Claude Max Sonnet:
  **$6.65** API-equivalent, 16.2 min, [sv-claude #1](https://github.com/rvegajr/sv-claude/pull/1).
  Write-up: `ARTICLE-CLAUDE-MAX-RESULTS.md`. Slack stays on Cursor.

- **Jobs HTTP API on the Slack process.** `GET /health`, `GET /v1/projects`,
  `POST /v1/jobs` (same mention CLI, Slack progress), `POST /v1/mentions`
  (Dispatcher posts `@CloudAgents …`). Slack does not fire `app_mention` for
  bot-authored mentions, so allowlisted `SLACK_DRIVER_BOT_IDS` posts are
  handled on the `message` event. Bearer `JOBS_API_TOKEN`. Slack's own user
  token cannot mention this app; a second app from
  `slack-dispatcher-manifest.json` can, when its `B…` id is in
  `SLACK_DRIVER_BOT_IDS`.

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
