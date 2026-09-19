# polya-craft

A strong model understands the problem and plans it into units a stranger
could carry out. A cheap or local model carries them out, one per fresh
session. Checks decide done, never the one who did the work. Look back
writes what it learned into a ledger the next problem reads first. Pólya's
four steps, for any problem: a bug, a product, a proposal, a house.

| File | What it is | Status |
| --- | --- | --- |
| `WALKTHROUGH.md` | The pattern by hand: two chat windows and a terminal, on a grant proposal and a one-line bug | written |
| `THEORY.md` | Two pages an AI can act on: the claim, the four moves, the contract, the rules, operating instructions | written |
| `PATTERN.md` | The specification: roles, artifacts with templates, the workable-unit contract and the stranger test, stages, the ledger, mechanical checks, mapping to architect-crew-gate | written |
| `examples/house.md` | A house, every stage, with a human crew as the Hand | written |
| `ARTICLE.md` | Where it comes from and why it is a fresh loop, with sources | written |
| `ROADMAP.md` | Built, known limitations, not built, measurement | written |
| `templates/` | `PROBLEM.md`, `PLAN.md`, `LOOKBACK.md`, `ONE-PAGE.md` | written |
| `prompts/` | The five turns: `understand`, `devise`, `carry-out`, `verify`, `look-back` | written, render-tested |
| `LESSONS.md` | The ledger, seeded with three process lessons | written |
| `src/` | The loop, plan-lint, ledger, borrowed gate wiring; `--loop polya` | not built |

## Read in this order

0. `WALKTHROUGH.md` — do it once by hand; twenty minutes on a small problem.
1. `THEORY.md` — two pages; enough to use the pattern with any AI today.
2. `PATTERN.md` section 0, then section 3 (the contract), then section 1a
   for how a repair or a house fits.
3. `examples/house.md` when you doubt it is more than a build pipeline.

## Use it

**With any AI, right now** — give it `THEORY.md` and the problem. Its last
two sections are the instructions.

**By hand, any two models** — `WALKTHROUGH.md`.

**With this kit** — not yet. `PATTERN.md` section 9 has the intended
commands; `ROADMAP.md` has the modules.

## Layout rules

Everything about the pattern lives here. It imports
`../architect-crew-gate/src/quality-gate.ts` and `io.ts` as utilities and
never edits them. `src/lib/routing.ts` will know the five prompts' H1 lines
so it can route each to a tier; that is the only coupling.
