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
| `examples/kitchen-sink.md` | A leaking sink, cause unknown at the start; you are both Solver and Hand; one page, one afternoon | written |
| `examples/house.md` | A house, every stage, with a human crew as the Hand | written |
| `examples/site-inspection.md` | Find as many bugs as possible in a site; kind: answer; the deliverable is a report, and Understand refuses "all" | written |
| `ARTICLE.md` | Where it comes from and why it is a fresh loop, with sources | written |
| `ROADMAP.md` | Built, known limitations, not built, measurement | written |
| `templates/` | `PROBLEM.md`, `PLAN.md`, `LOOKBACK.md`, `ONE-PAGE.md` | written |
| `prompts/` | The five turns: `understand`, `devise`, `carry-out`, `verify`, `look-back` | written, render-tested |
| `LESSONS.md` | The ledger, seeded with three process lessons | written |
| `src/plan.ts` | Parsers for the three artifacts; `validateUnits`, the mechanical half of the stranger test; `contractOf` for the borrowed gate | built |
| `src/lessons.ts` | The ledger store: select by tags, append, confirm; the prior-lessons note | built |
| `src/io.ts` | `makePolyaIO`: architect-crew-gate's repo I/O with the gate reading PROBLEM.md's quality bar | built |
| `src/polya-loop.ts` | The loop: understand → devise → gated units → look back (a, b, c, d); LOOKBACK.md written from evidence; a unit or done-check that names a page gets a browser for that turn | built |
| `src/*.test.ts` | Parsers, validator, ledger, prompt render/classify/route, the loop with a faked Hand and Solver, end to end on a real bare origin with the real gate | 58 tests, passing |

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

**With this kit**:

```bash
npm run build-app -- --loop polya --engine hybrid --idea "<problem>" --repo <url>      # Max: Solver; local: Hand, Verifier
npm run build-app -- --loop polya --engine local  --idea-file ideas/x.md --create-repo my-app
npm run build-app -- --resume cc-…                                                    # restarts at the stage that stopped
npm test && npx tsc --noEmit
```

Env: `POLYA_LESSONS_FILE` (the ledger; default `polya-craft/LESSONS.md`),
`LOCAL_GATE*` (the borrowed gate), `HYBRID_QA_FALLBACK` (the Verifier's
fallback tier), `QA_BROWSER` (Playwright for any turn that names a page, on
by default), `--max-units` (default 8).

## Layout rules

Everything about the pattern lives here. It imports
`../architect-crew-gate/src/quality-gate.ts`, `io.ts`, and two helpers from
`blueprint-loop.ts` and `blueprint.ts` as utilities and never edits them.
`src/lib/routing.ts` knows the five prompts' H1 lines so it can route each
to a tier; `src/lib/engine-local.ts` treats Understand and Devise as
architect turns and Look back as a read-only reviewer; `src/lib/build-app.ts`
wires `--loop polya`. That is the whole coupling.
