# Development playbook

How work moves through this kit, day to day. The articles explain why each
rule exists and carry the measurements; this page is the order you do things
in. When the two disagree, the code and `.env.example` win, then this page,
then the articles.

| Read for the why | Covers |
| --- | --- |
| [ARTICLE-SLACK.md](ARTICLE-SLACK.md) | The fix loop: mention or Jam → brief → PR → thread |
| [ARTICLE-CLAUDE-MAX.md](ARTICLE-CLAUDE-MAX.md) | Credentials, meters, the Max policy line |
| [ARTICLE-CLAUDE-MAX-RESULTS.md](ARTICLE-CLAUDE-MAX-RESULTS.md) | Cursor vs Max on the same idea, measured |
| [IMPLEMENTATION-GUIDE.md](IMPLEMENTATION-GUIDE.md) | Phase-by-phase setup recipe (`npm run doctor -- --phase A`…`G`) |

---

## 1. Door: pick the path before you type anything

| You have | Do | Never |
| --- | --- | --- |
| A `bc-…` or `cc-…` id | `npm run build-app -- --resume <id>` | Start a second job for the same work |
| A bug or change in an existing product | `@CloudAgents <project> <request or jam.dev link>` in Slack, or a branch + PR in that repo | `build-farm` a new repo for it |
| A new, independent app idea | `ideas/ready/<name>.md` → `npm run build-farm`, or one idea with `npm run build-app -- --engine hybrid` | Hand-roll a loop outside this repo |
| A failed farm job | Resume that job's `bc-…` | Re-farm the wave |

One front door per product. The Slack bot is the only mention people learn;
Cursor's own `@Cursor` app stays uninstalled.

---

## 2. Before anything runs: credentials and meters

Every expensive mistake so far was an environment variable or a default left on.
Check these once per machine, and again after any shell-profile change.

```bash
claude auth status          # apiKeySource must be "none"
npm run doctor              # read-only; names the fix for every failure
```

**Rules.**

- **No `ANTHROPIC_API_KEY` in the shell.** If it is set, Claude Code and the
  Agent SDK bill the API instead of Max. The Claude engine refuses to start when
  `apiKeySource` is not `none`; keep it that way. A project that truly needs a key
  keeps it in that project's gitignored `.env`.
- **Auto-recharge off on both Anthropic streams.** Console → Billing: no credit
  auto-reload. claude.ai → Settings → Usage: extra-usage budget zero. These two
  defaults were $4,047 of the $5,327.
- **Cursor: `composer-2.5`, Fast off.** `selectModel()` pins `fast=false`; do not
  override it. Fast is about 6× the price. Not Opus, GPT, or Grok Fast on Cursor
  VMs, and not "Other Models" in the IDE. ($789 on-demand in July with 96% of the
  included pool unused.)
- **Max: Sonnet by default.** `CLAUDE_MODEL=sonnet`. Opus or Fable only for a spec
  turn that has proven it needs them.
- **A cap hit is a stop, not a purchase.** `MaxExhausted` and `MaxCeiling` exit
  with the reset time. Resume after the reset or on `--engine cursor`. Never
  turn on extra usage to finish a job.
- **LiteLLM is for products, not agents.** Apps call the LLM Relay at
  `https://ai.noctusoft.com/v1` with a virtual key. Never point Claude Code at a
  proxy, and never forward a Max OAuth token through one.
- **Max is for you, on your work.** Never run the Max-backed engine on behalf of
  other people. That is why Slack stays on Cursor and `SLACK_CLAUDE_USER_IDS`
  stays empty.
- **Secrets come from 1Password**, read into a variable or a gitignored `.env`,
  never printed. See `~/.claude/rules/secrets.md`.

---

## 3. Make a target repo agent-ready (once per repo)

The bot does not make a repo safe for unattended runs. `AGENTS.md`, the
environment, and the hook do.

```bash
cp target-repo-kit/AGENTS.md /path/to/repo/
cp -R target-repo-kit/.cursor /path/to/repo/
```

1. Fill `AGENTS.md`: install and test commands (and the directory each runs in),
   the integration branch, the test subset that passes on a fresh clone, and the
   Never list (CI config, deploy files, existing migrations).
2. Neutralise chat-style `.cursorrules` ("ask before acting"). The kit's
   `.cursor/rules/autonomous-agent.mdc` is `alwaysApply`.
3. Make sure `npm ci && npm test` can pass on a stock Ubuntu VM. Native addons,
   services, or a required env file go in `AGENTS.md` and
   `.cursor/environment.json`; secrets go in the Cloud Agents dashboard.
4. Wire `/health` to report `commit`, so `npm run version-board` can see it
   (`target-repo-kit/AGENTS.md` has the contract). Add the service to
   `services.json`.
5. Prove Cursor can clone it with a read-only run:

   ```bash
   npm run pipeline -- --repo https://github.com/you/repo --ref <branch> \
     --brief example-health-endpoint --plan-only
   ```

   You want a clone and a plan that names the real layout. If this fails, Slack
   will not help.

---

## 4. Fix loop: existing products, through Slack

```
jam.dev link in Slack → bot fetches console/network/clicks → triage (brief or ≤3 questions)
   → plan (read-only) → implement → verify (JSON, checklist) → PR in the thread
   ↑                                                                 │
   └──────────── reply in the same thread, another Jam is fine ──────┘
```

**Send a Jam, not a sentence.** A recording is a repro the model did not write.
Without one, triage asks for page, role, expected vs actual, and environment.

```
@CloudAgents                         usage
@CloudAgents api                     that project's repo, branch, options
@CloudAgents https://jam.dev/c/<id>  start a job (in #api-…, the project is implied)
@CloudAgents api branch=release autopr=true <request>
@CloudAgents status                  in a job thread: where it is, no model call
@CloudAgents version                 which build of the bot is answering
```

- **One request per new message.** A Jam with several asks gets the clearest
  checkable bug fixed and the rest listed as follow-ups.
- **Follow-ups go in the same thread.** The `agent: bc-…` line is the handle the
  bot resumes; do not edit it. A new top-level message is a new agent and a new
  bill.
- **"Ready" means the verifier said `done: true` with evidence.** Then the PR is
  marked ready and auto-merge is armed if the repo allows it. Otherwise it stays
  a draft and the thread says why.
- **Watch it live** at cursor.com/agents (Source → SDK) or the Cursor iOS app.
- **Small fix with no Slack wiring?** A branch and a PR in that repo, by hand or
  in the IDE on Composer.

---

## 5. New-app loop: `build-app` and `build-farm`

```
spec → [ next milestone → verify → commit ]* → finish     one branch, one growing PR
```

**Pick the engine.**

| Engine | Where it runs | Pays with | Use when |
| --- | --- | --- | --- |
| `cursor` (default) | Cursor VM | Cursor tokens, Composer Fast off | Default; cheapest metered dollar, fastest wall time, has a UI |
| `hybrid` | This box | Max plans and reviews; Ollama (`LOCAL_MODEL`) implements and verifies | Volume on Max without draining the weekly cap |
| `claude` | This box | Max weekly cap | One app, Max has room, you want no invoice line |
| `local` | This box | Nothing but electricity | Max is at the ceiling or you are offline |

Measured on the snippet-vault (17 Sept 2026): Cursor $1.20 charged, 13.5 min;
Max Sonnet $6.65 API-equivalent, 16.2 min, $0 billed. Both finished in 6/6.

```bash
# one idea
npm run build-app -- --engine hybrid --idea-file ideas/ready/<name>.md --create-repo <name>

# a wave of ideas (Cursor only)
npm run build-farm -- --ideas-dir ideas/ready --concurrency 5 --create-repos
npm run build-farm -- --status

# resume, any engine
npm run build-app -- --resume bc-…     # or cc-…
```

- **Ideas start from `ideas/TEMPLATE.md`.** Put the must-haves in, and the
  nice-to-haves under Non-goals so the finish gate does not chase them.
- **`--create-repo` defaults the ref to `main`** and ignores `TARGET_REF`. Pass
  `--ref` when you mean another branch.
- **`--loop blueprint`** (requirements → blueprint → gated tasks → QA → review)
  for apps that need a stricter gate. Needs an engine that owns its clone.
- **Hybrid ceiling.** Every Claude turn checks the last reported Max
  utilization. At `MAX_UTILIZATION_CEILING` (0.85) the turn moves to
  `LOCAL_PLANNER_MODEL`, or the job stops if `HYBRID_OVER_CEILING=stop`.
  `npm run max-usage` refreshes the number.
- **Farm cap.** `FARM_MAX_USD` stops a wave; in-flight jobs finish. Do not raise
  `FARM_CONCURRENCY` until the current wave is `complete`.
- **A long turn hit its cap?** `CLAUDE_MAX_TURNS=160 npm run build-app -- --resume cc-…`.
  The loop is resumable by design.
- **Max loops in parallel buy nothing.** One account, one weekly bar. Run Claude
  and hybrid builds one at a time.

---

## 6. Guardrails and shipping

**The bot cannot deploy.** It holds no Vercel, Railway, or deploy-hook
credential. A merged PR is the only path to production. Vercel for Slack and
Railway webhooks post the deploy card in the same channel.

| Guard | Where |
| --- | --- |
| Force-push and protected-branch pushes blocked | `.cursor/hooks.json` in the target repo, run inside the VM |
| Who can fire jobs | `SLACK_ALLOWED_CHANNELS`, `SLACK_PROJECTS` |
| How many VMs bill at once | `SLACK_MAX_CONCURRENT` |
| One job per thread, duplicate events dropped | Bot process |
| No credentials beyond model requests in a Claude subprocess | `scrubbedEnv()` in `src/lib/engine-claude.ts` |
| Bad tests, silenced checks, placeholders | Deterministic gate, plus `DECIDER` if it is on |

**Shipping the bot itself.**

```bash
# edit CHANGELOG.md: move Unreleased to the new version
npm version minor -m "release: v%s"      # patch for a fix
git push --follow-tags
npm run deploy                           # stamps BUILD_INFO, then railway up
```

Never a bare `railway up`; without the stamp the container cannot say what it
is running.

**"Is the latest out?"**

```bash
npm run version-board           # --strict, --json; exit 1 on stale or unreachable
```

It compares each service's `/health` `commit` with the branch tip. A green status
dot is not an answer. Run it a few times a day; do not tight-poll.

---

## 7. Close: every job ends with COST

The last lines of every job, report, or PR description are cost, one line per
provider that actually spent. The shape (figures illustrative):

```
COST this run:     cursor $1.20 · max $6.65 API-equivalent (not billed)
COST this project: cursor $<n>
COST today:        cursor $<n> · decider:typesafe $<n>
```

- Every AI provider is its own meter. Never add them into one dollar.
- Skip meters with no spend. No `$0.00` padding.
- If the number is not known, write `COST this run: unknown`.
- `npm run cost-board` prints every meter by day and project from `.runs/`.

---

## Done means

- A PR in the right repo, opened from the right door.
- Tests that ran, with their output in the PR or the thread.
- `npm run version-board` green once it merges and deploys.
- COST lines at the bottom.

## Start of day, five minutes

1. `claude auth status`: `apiKeySource` is `none`.
2. `npm run doctor`: green, or each failure has a fix line.
3. `npm run version-board`: nothing stale you did not expect.
4. `npm run cost-board`: yesterday matches what you think you ran.
5. Resume any `bc-…` or `cc-…` that stopped overnight before starting anything new.
