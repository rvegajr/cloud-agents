# cloud-agents

<!-- agent-playbook -->
Kit for efficient generation. Factory commands live in this repo.

## Door

- `bc-…` → `npm run build-app -- --resume bc-…`
- Existing product → Slack `@CloudAgents` (bot stays Cursor). Never farm a new repo for it.
- New independent idea → `ideas/ready/*.md` then `npm run build-farm`, or `npm run build-app -- --engine hybrid`

## Meters

- Farm and Slack: `composer-2.5`, Fast off (`selectModel()`). `FARM_MAX_USD` caps a wave.
- Hybrid: Max plans, `LOCAL_MODEL` types, `MAX_UTILIZATION_CEILING=0.85`, never extra usage.
- Do not export `ANTHROPIC_API_KEY`. Empty `SLACK_CLAUDE_USER_IDS`.
- Resume failed farm jobs. Do not re-farm. Do not raise concurrency until a wave is `complete`.

## Close

Last lines of every job are COST. Cursor billed and Claude Max stay on separate meters — never one combined dollar figure. `npm run cost-board`. Do not end a report without it.

- Cursor (farm, Slack, Composer): the invoice (`chargedCents`).
- Claude Code / Max / hybrid: Claude API-eq, not a Cursor charge. Track it anyway.
- Missing usage: `COST this run: unknown`.
