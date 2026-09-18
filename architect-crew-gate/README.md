# architect-crew-gate

A frontier model writes the standard and the blueprint. A cheap model does the
work one task at a time. A deterministic gate inspects every task. A scripted QA
pass and one independent review certify. It applies to any job — build, change,
repair, maintain — and to any stack.

| File | What it is | Status |
| --- | --- | --- |
| `THEORY.md` | The claim, five principles, the shape, and operating instructions for an AI or a person given a job. Self-contained: point a model at it and it can act | written |
| `PATTERN.md` | The specification: roles, artifacts with templates, stages with contracts, the gate, routing, job kinds with worked examples, measurement, checklists | written |
| `ARTICLE.md` | Why it exists (the 19/35 vs 29/35 review) and the names it is composed from, with sources | written |
| `ROADMAP.md` | What is built, what is designed, in what order | written |
| `prompts/` | The seven turns: `requirements`, `blueprint`, `task`, `qa`, `qa-fix`, `review`, `review-fix` | written, render-tested |
| `templates/` | Fill-in copies of the five artifacts: `REQUIREMENTS.md`, `QUALITY.md`, `DESIGN.md`, `TASKS.md`, `QA.md` | written |
| `src/quality-gate.ts` | The gate: ownership, quality bar from `QUALITY.md`, hygiene, tamper, clean-start, vacuous-suite | built |
| `src/blueprint.ts` | Parsers for the five artifacts, traceability, design excerpts | built |
| `src/blueprint-loop.ts` | The loop: requirements → blueprint → gated tasks → finish gate → QA → review | built |
| `src/io.ts` | The loop's real I/O over a git checkout | built |
| `src/quality-review.ts` | Blind rubric scoring (`npm run quality-review`) | built |
| `prompts/quality-review.md` | The seven-criterion rubric with anchors | written |
| `src/*.test.ts` | Unit, integration (real git/npm on fixtures), end-to-end (real bare origin, faked crew, faked model) | 50 tests, passing |

## Read in this order

0. `THEORY.md` — two pages; enough to use the pattern with any AI today.
1. `ARTICLE.md` if you want to know why (ten minutes).
2. `PATTERN.md` section 0 (one page), then section 1a for how a repair or an
   upgrade fits, then section 2 for the artifacts.
3. `prompts/requirements.md` — it is the first thing an architect model sees.

## Use it

**With any AI, right now** — give it `THEORY.md` and the job. Its last two
sections are the instructions.

**By hand, any two models** — `PATTERN.md` section 6, "By hand". Paste the
prompts in order; run the gate's commands yourself.

**With this kit**:

```bash
# the whole loop on a job (hybrid: Max for requirements, blueprint, review; local crew and QA)
npm run build-app -- --loop blueprint --engine hybrid --idea "<job>" --repo <url> [--ref main]
npm run build-app -- --loop blueprint --engine local  --idea-file ideas/x.md --create-repo my-app   # no Max at all
npm run build-app -- --resume cc-…                     # restarts at the stage that stopped

# blind scoring
npm run quality-review -- --job-file ideas/x.md <repo-url[@ref] | path>... --repeat 2 [--dry-run]

npm test && npx tsc --noEmit
```

Env: `BUILD_LOOP=blueprint` makes it the default; `LOCAL_GATE*`, `HYBRID_QA`,
`HYBRID_REVIEW`, `LOCAL_PLANNER_MODEL` (the local architect/QA/reviewer when a
stage is diverted off Max), `QA_BROWSER` (Playwright MCP for the QA analyst,
on by default) in `.env.example`.

## Layout rules

Everything about the pattern lives here. The one exception is the hook that
calls the gate from `src/lib/engine-local.ts` (`runLocalGated`), which is engine
code and stays with the engine. `src/lib/routing.ts` knows the prompts' headers
so it can route them to a tier.
