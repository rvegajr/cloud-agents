# Best value is still Composer, Fast off

## 22 September 2026. What GPT-5.6 Sol, Opus 5.5, and Grok 4.7 would have cost on the snippet-vault we already measured, and what to run instead

No new cloud agents were started for this. The workload is the 17 September
Cursor run in [ARTICLE-CLAUDE-MAX-RESULTS.md](ARTICLE-CLAUDE-MAX-RESULTS.md):
**5,281,013 tokens**, **$1.20 charged** (`chargedCents` 120.25), Composer 2.5,
Fast off, six milestones, finish gate green.

That invoice only fits the Composer card ($0.50 input, $0.20 cache read, $2.50
output per million) if the mix is about **97% cache read, 2% fresh input, 1%
output**. A coding agent is mostly cache. The same mix on the 22 September list
rates:

| Model | Same 5.28M tokens | vs $1.20 | Pool |
| --- | --- | --- | --- |
| Composer 2.5, Fast off | **$1.20** measured ($1.21 fitted) | 1× | Cursor Models |
| Opus 5.5 | **$2.50** | 2.1× | Other Models |
| Grok 4.7 | **$3.09** | 2.6× | Cursor Models |
| GPT-5.6 Sol | **$3.53** | 2.9× | Other Models |
| Grok 4.7 Fast | $6.18 | 5.1× | Cursor Models |
| GPT-5.6 Sol Fast | $7.06 | 5.9× | Other Models |

Rates per million tokens, input / cache read / output: Opus 5.5 $4 / $0.20 / $20;
Grok 4.7 $2 / $0.50 / $6 (Fast $4 / $1 / $12); GPT-5.6 Sol promo $4 / $0.40 / $20
through 21 November 2026 (Fast is 2×). Sources: Cursor models pricing, Anthropic
Opus 5.5, xAI Grok 4.7. Cache writes are not in the mix, so a live loop can land
higher. Opus looks close to Composer only because its cache reads are also $0.20.
Fresh input and output are 8×.

GPT-5.6 Sol and Opus 5.5 draw from **Other Models**. That is the pool that billed
$789 on-demand in July 2026 while included Composer and Grok sat unused. Grok 4.7
and Composer stay on the Cursor Models pool. Do not make Sol or Opus the farm
default.

## Quality

Published coding scores are not one leaderboard. Do not subtract them.

| Model | CursorBench 4.0 | Terminal-Bench 4.0 | Who published it |
| --- | --- | --- | --- |
| Opus 5.5 | 57.8% | 66.4% | Anthropic, max effort, 22 Sep 2026 |
| GPT-5.6 Sol | 41.7% | 37.3% | Anthropic’s table, OpenAI’s figure |
| Grok 4.7 extra high | 46.3% | 38.0% (Grok Build) | xAI’s own chart |
| Grok 4.7 low | 33.1% | — | xAI: $1.58/task vs $6.01 at extra high |
| Composer 2.5 | — | — | No public score. The vault finished green. |

Anthropic also says that at this level the benchmark gap overstates the
difference they see in their own work. xAI’s effort ladder is the practical
Grok bill: extra high is 3.8× low for 13 points on their chart.

What this kit actually scored, blind, on the same snippet-vault idea
(`polya-craft/ROADMAP.md`):

| Build | Solver | Median /35 | Money |
| --- | --- | --- | --- |
| R1a / R1b | Sonnet + oracle checklist | **32 / 32** | about $12 API-eq |
| polya-live-sv-opus | Opus, max effort | 31–34 | **$35.78** API-eq |
| polya-live-sv-fable | Fable 5.1, max effort | 34 | $31.51 API-eq |
| sv-cursor | Composer 2.5, Fast off | not scored | **$1.20** billed |
| sv-claude | Claude Max, Sonnet | not scored | $6.65 API-eq |

The expensive solver did not beat the cheap one once the cheap one had a
checklist. GPT-5.6 Sol, Opus 5.5, and Grok 4.7 have not been run on this kit.

## What to run

1. **Farm, Slack, and ordinary apps:** Composer 2.5, Fast off. That is the best
   value measured here.
2. **A quality miss:** add the checklist (the polya oracle) on the cheap solver
   before buying a frontier model.
3. **A job the checklist still fails:** Opus 5.5 is the best of the three
   frontier cards (highest published scores, lowest fitted bill). It is an
   Other Models charge. Use it on purpose. Grok 4.7 only if the work must stay
   inside the Cursor pool; leave it off Fast and off extra-high unless the task
   earns the tokens. Do not default to GPT-5.6 Sol.

## Where the money already went

`npm run cost-board` on 22 September 2026, six days with jobs. Meters stay
separate.

- Claude API-eq **$348.60**
- Cursor billed **$4.39**
- If that pace holds: Claude API-eq $1,743 and Cursor billed $66 this month

The single largest project on the board is `polya-live-sv-opus` at $35.78
API-eq. The Cursor vault that shipped is $1.20.
