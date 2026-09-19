# Tools research: what fits each part of the loop

*2026-09-19, during R0. Three researchers, one per group of parts, each told
to reject anything that only half fits. The load-bearing local claims were
checked on this machine: `@anthropic-ai/claude-agent-sdk` 0.3.273 has
`outputFormat: {type: 'json_schema'}` and returns `structured_output`;
qwen-code 0.19.3 has `--json-schema`, `--max-session-turns`,
`--max-wall-time`, `--max-tool-calls`; Playwright is 1.58.*

## Verdict by part

| Part | Verdict | The change |
| --- | --- | --- |
| Understand / Devise artifacts | **Change one thing** | The Solver returns PROBLEM and PLAN as schema-checked JSON (SDK `outputFormat`; qwen-code `--json-schema`); the loop renders the markdown. Each Check is a tagged type: `{kind: "command", run, expectExit}` or `{kind: "observation", steps, expect}`. |
| Fix turns | **Change** (found in R0, not by research) | A failed done-check goes back to the Solver for one proper unit under the stranger test. The loop never writes "fix the cause" itself. |
| Hand | **Keep qwen-code**, tune it | Set `--max-session-turns` and `--max-wall-time` per turn; `skipLoopDetection` in the user-level qwen settings; Playwright `--output-dir` to a temp dir so `.playwright-mcp/` never lands in the repo. |
| Gate | **Keep ours**, close two gaps | The shell-exit runner (`runCheck`) becomes the gate's exec too, because the start probe still waits on pipes. `package.json` scripts are frozen after the unit that creates them, which stops `echo` stand-ins. Stryker, scoped to Touches at finish, is optional and reports only. |
| Verifier | **Change** | A page done-check becomes a Playwright spec the Solver writes at Devise, red first. The Verifier runs `npx playwright test`, a command. The model walk stays for checks that cannot be a spec. |
| Ledger | **Keep ours**, three changes | A merge adds evidence and resets to candidate, never confirms. `contradict()` beside `confirm()`: a lesson applied by a unit that then failed loses a point and is retired at 0 (ExpeL). Lessons are linted against the loop's own rules when written, and a short "what the loop does" note sits next to them. |
| Blind score | **Keep ours**, move probes out | A fixed probe script runs on every candidate before review (`/`, `//`, `%2f`, 2 KB path, wrong method, malformed body, process alive); results go into every reviewer's prompt. Anchor text for structure, tests, UX. Krippendorff's alpha and min-max per candidate; print "tie" when ranges overlap. Repeat 3 by default. Gaps under about 3/35 are noise. |

## Rejected, and why

| Candidate | Part | Why not |
| --- | --- | --- |
| GitHub Spec Kit, Kiro, BMAD-METHOD, OpenSpec | Understand/Devise | Markdown plans with prose checks; the same parsing fragility as ours. OpenSpec's ADDED/MODIFIED/REMOVED marking for change problems is worth borrowing. |
| Taskmaster AI | Devise | Tasks are JSON but `testStrategy` is prose, and it brings its own provider layer. |
| aider architect/editor | Devise, Hand | No plan artifact; no tool use, so it cannot run the red test. Fallback runner only. |
| Gherkin, EARS | Checks | Gherkin swaps our regexes for step regexes; EARS phrases requirements, it does not make them runnable. |
| OpenHands, Cline/Roo | Hand | Docker runtime; IDE-bound. |
| Codex CLI `--oss`, opencode, Goose | Hand | Plausible, but no measured gain over a Hand that passes first try. |
| pre-commit, lefthook | Gate | Run commands on commit; a `--yolo` Hand can skip hooks. |
| browser-use, Stagehand, Skyvern | Verifier | Python; Ollama not recommended; Docker plus Postgres. |
| mem0, Letta/MemGPT, embeddings | Ledger | Check memory against memory, never against reality; need a vector store. Under 50 entries the whole ledger fits the prompt. |
| promptfoo, Inspect | Score | Built for prompt outputs or Python; ours already does repeats and medians. |
| More repeats alone | Score | Judge self-agreement stops improving after about 3; the spread comes from each reviewer inventing its own probes. |

## Sources

Structured output: [Agent SDK](https://code.claude.com/docs/en/agent-sdk/structured-outputs) · [qwen-code](https://qwenlm.github.io/qwen-code-docs/en/users/features/structured-output/) · [Ollama](https://docs.ollama.com/capabilities/structured-outputs).
Spec tools: [Spec Kit](https://github.com/github/spec-kit/blob/main/templates/tasks-template.md) · [Kiro](https://kiro.dev/docs/specs/) · [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) ([#2275](https://github.com/bmad-code-org/BMAD-METHOD/issues/2275)) · [OpenSpec](https://github.com/Fission-AI/OpenSpec/blob/main/schemas/spec-driven/schema.yaml) · [Taskmaster](https://github.com/eyaltoledano/claude-task-master/blob/main/docs/task-structure.md) · [aider](https://aider.chat/docs/config/options.html).
Hand: [qwen-code settings](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/settings.md) · [playwright-mcp](https://github.com/microsoft/playwright-mcp) · [Codex + Ollama](https://docs.ollama.com/integrations/codex) · [opencode + Ollama](https://docs.ollama.com/integrations/opencode) · [Goose headless](https://goose-docs.ai/docs/tutorials/headless-goose/) · [OpenHands + Ollama](https://github.com/OpenHands/OpenHands/issues/8318).
Gate: [Stryker config](https://stryker-mutator.io/docs/stryker-js/configuration/) · [Stryker incremental](https://stryker-mutator.io/docs/stryker-js/incremental/) · [execa termination](https://github.com/sindresorhus/execa/blob/main/docs/termination.md).
Verifier: [Playwright test agents](https://playwright.dev/docs/test-agents) · [browser-use #1126](https://github.com/browser-use/browser-use/issues/1126) · [Stagehand #1303](https://github.com/browserbase/stagehand/discussions/1303) · [Skyvern self-host](https://www.skyvern.com/docs/developers/self-hosted/overview).
Ledger: [Reflexion](https://arxiv.org/abs/2303.11366) · [Voyager](https://arxiv.org/html/2305.16291) · [ExpeL](https://arxiv.org/html/2308.10144v2) · [Agent Workflow Memory](https://arxiv.org/abs/2409.07429) · [error propagation](https://arxiv.org/abs/2505.16067) · [Cline Memory Bank](https://docs.cline.bot/best-practices/memory-bank) · [Claude Code memory](https://code.claude.com/docs/en/memory) · [Teal Book ch. 38](https://projectdelivery.gov.uk/teal-book/home/part-f-solution-delivery/chapter-38-learning-from-experience/).
Scoring: [SWE-bench grading](https://github.com/SWE-bench/SWE-bench/blob/main/swebench/harness/grading.py) · [Inspect scorers](https://inspect.aisi.org.uk/scorers.html) · [Rating Roulette](https://arxiv.org/html/2510.27106v1) · [MT-Bench](https://arxiv.org/abs/2306.05685) · [PoLL](https://arxiv.org/abs/2404.18796) · [promptfoo llm-rubric](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/).
