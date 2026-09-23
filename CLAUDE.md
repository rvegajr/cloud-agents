# cloud-agents

<!-- agent-playbook -->
Kit for efficient generation. Factory commands live in this repo.

## Door

- `bc-…` → `npm run build-app -- --resume bc-…`
- Existing product → Slack `@CloudAgents` (bot stays Cursor). Never farm a new repo for it.
- New independent idea → `ideas/ready/*.md` then `npm run build-farm`, or `npm run build-app -- --engine hybrid`

## Meters

- Farm and Slack: `composer-2.5`, Fast off (`selectModel()`). Best value on the measured vault ($1.20). Do not default to GPT-5.6 Sol, Opus 5.5, or Grok Fast. `ARTICLE-FRONTIER-VALUE.md`. `FARM_MAX_USD` caps a wave.
- Hybrid: Max plans, `LOCAL_MODEL` types, `MAX_UTILIZATION_CEILING=0.85`, never extra usage.
- Do not export `ANTHROPIC_API_KEY`. Empty `SLACK_CLAUDE_USER_IDS`.
- Resume failed farm jobs. Do not re-farm. Do not raise concurrency until a wave is `complete`.

## Close

Last lines of every job are COST. Every AI provider is its own meter — never one combined dollar. Log running cost as spend arrives. `npm run cost-board`. Do not end a report without it.

- Record whichever engine is running. Do not fold an unknown AI into Cursor.
- Only print meters that have spend — no `$0.00` padding.
- Missing usage: `COST this run: unknown`.
