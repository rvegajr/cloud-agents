# cloud-agents: learn to build autonomously in the cloud

A working, minimal kit that shows every moving part of "an agent builds software
for me on a machine in the cloud while I do something else." The agents are
Cursor Cloud Agents: Cursor-hosted VMs that clone your repo, work on a branch,
and open a PR. The kit drives them through the Cursor SDK (`@cursor/sdk`), the
same API behind Cursor's own web, IDE, and Slack entry points, exposed as a
library you can call from a script, a cron job, a CI step, or (step 8) a Slack
bot you host yourself. Nothing in `src/` is itself a Cursor agent; it is the
orchestrator that creates, prompts, and resumes them.

Read this file top to bottom once. Then run the numbered scripts in order.
`ARTICLE.md` is the idea-to-app walkthrough; `ARTICLE-SLACK.md` is the Slack
walkthrough, with a jam.dev recording as the preferred bug report.
`IMPLEMENTATION-GUIDE.md` is the same setup as a recipe an AI agent can execute:
every credential and scope in the order it is needed, with the browser-only steps
marked as human gates, and `npm run doctor` to prove each one. `CHANGELOG.md` is
what changed between tags — start there if you are upgrading.

---

## 1. The mental model

Every autonomous build system, whether it is Grok Bot, Cursor Cloud Agents,
Devin, Codex, or something you write yourself, is the same loop:

```
   brief (or jam.dev)  ─>  prompt  ─>  agent on a VM  ─>  verification  ─>  artifact (PR)  ─>  feedback
     ^                                                                              |
     └──────────────────────────────────────────────────────────────────────────────┘
```

| Part | What it is | Where it lives in this kit |
| --- | --- | --- |
| **Brief** | A human-written description of the outcome, with a checkable definition of done | `briefs/*.md` |
| **Prompt** | The brief wrapped in phase-specific operating instructions and an output contract | `prompts/*.md`, assembled by `src/lib/prompts.ts` |
| **Agent on a VM** | A fresh Linux machine with your repo cloned, a shell, and a model driving it | `Agent.create({ cloud: { repos } })` |
| **Repo-side guidance** | Files inside the target repo that the agent reads: conventions, commands, hard limits | `target-repo-kit/` (copy into your repo) |
| **Verification** | Commands the agent must run and see exit 0. Not "looks right", exit 0 | Brief's `## Verification` section + `prompts/03-verify.md` |
| **Artifact** | A branch and a pull request. Never a direct push to main | `autoCreatePR: true` |
| **Feedback** | Resume the same agent with review comments; it keeps full context | `src/04-resume.ts` |
| **Observability** | IDs, cost, status, records on disk | `src/05-status.ts`, `.runs/` |

What Grok Bot adds on top of this loop is persistence (named bots that remember
across tasks), a shared always-on computer with a browser, and computer-use for
tools with no API. What it does **not** change is the loop above. If you can build
the loop, you understand the product category.

---

## 2. Setup (five minutes)

```bash
git clone https://github.com/rvegajr/cloud-agents
cd cloud-agents
npm install
cp .env.example .env
```

Authenticate one of two ways:

```bash
npm run login        # browser login, mints a 90-day key into ~/.cursor/sdk/auth.json
# or: paste a key from cursor.com/dashboard/integrations into .env as CURSOR_API_KEY
```

For the cloud steps you also need a GitHub repo connected to Cursor. Go to
[cursor.com/agents](https://cursor.com/agents), connect GitHub, grant the repo.
Then set `TARGET_REPO` in `.env`. Check everything with:

```bash
npm run status       # account, models, connected repos, agents launched by this kit
npm run doctor       # every credential, scope, and grant, with the fix for each gap
```

`npm run doctor` is read-only and safe to re-run at any point: it never posts to
Slack and never creates or changes anything. `npm run doctor -- --phase A` scopes
it to one phase of `IMPLEMENTATION-GUIDE.md`; `--json` is the form to hand an
agent.

---

## 3. The eight steps, in order

### Step 1: local smoke test

```bash
npm run smoke
```

Runs `Agent.prompt()` locally against this folder. Nothing is committed, no repo
is cloned. Its only job is to make the first thing you debug be **auth and model
access**, not GitHub permissions and VM provisioning. If this works, the SDK works.

Look at `src/01-local-smoke.ts`. It is 30 lines. The whole SDK surface you need
for a one-shot is `Agent.prompt(text, { apiKey, model, local | cloud })`.

### Step 2: cloud one-shot

```bash
npm run cloud -- --brief example-health-endpoint
```

Same shape as step 1, one field changed: `cloud: { repos: [...] }` instead of
`local: { cwd }`. In exchange you get a fresh clone on an isolated VM, a branch
pushed for you, and a PR to review. Watch the stream: `[status] CREATING` is the
VM booting and cloning, `[tool] shell` lines are the agent working.

Look at `src/02-cloud-oneshot.ts`. Notice:

- `skipReviewerRequest: true` keeps CI-launched agents from paging humans.
- `metadata: { kit, brief }` tags the agent so `npm run status` can find it later.
- The prompt asks for a fenced `json` report at the end, and the script parses it
  to set the exit code. **Structured output is how a program knows if the agent
  succeeded.** `result.status === "finished"` only means the run ended cleanly.

### Step 3: the plan → implement → verify pipeline

```bash
npm run pipeline -- --brief example-health-endpoint
npm run pipeline -- --brief example-health-endpoint --plan-only   # stop after the plan
```

One agent, three `send()` calls, one conversation. This is the pattern that
scales because:

1. **Plan** runs in `mode: "plan"` (read-only). The model explores and writes a
   plan with exact verification commands. Nothing is edited. You can stop here and
   read it. Cheap to throw away.
2. **Implement** runs in `mode: "agent"`. It sees the plan in its own conversation
   history and executes it. Narrow job, narrow output format.
3. **Verify** re-derives state from `git diff`, re-runs the verification commands,
   fixes anything it finds, and emits a JSON report with per-item evidence.

Each phase gets one job and one output contract. The model spends its attention on
one thing. You get a checkpoint between phases where a program or a human can stop.

Look at `src/03-cloud-pipeline.ts` and the three files in `prompts/`.

### Step 4: resume and give feedback

```bash
npm run resume -- --agent bc-xxxx --message "Address the review comments on the PR"
npm run resume -- --agent bc-xxxx --message "Looks good, implement it" --mode agent
```

A cloud agent's `bc-` ID is a durable handle. Pick it up from another terminal,
another machine, or a cron job days later; the conversation and the branch are
still there. This is how "the plan looked good, go ahead" and "fix what the
reviewer said" work without re-explaining anything. `.runs/*.json` keeps the IDs.

### Step 5: observe

```bash
npm run status
npm run status -- --agent bc-xxxx    # detail + token usage / cost for one agent
```

Autonomous without observable is just runaway. Every script logs `agent.agentId`
and `run.id` before it streams anything, so if a stream hangs you still have the
handle to investigate at cursor.com/agents (Filter > Source > SDK).

### Step 6: put the guardrails in the repo, not the prompt

Copy `target-repo-kit/` into the root of any repository you point agents at:

```
your-repo/
  AGENTS.md                              <- onboarding doc: layout, commands, conventions, never-do list
  .cursor/rules/autonomous-agent.mdc     <- working style for unattended runs
  .cursor/hooks.json                     <- runtime-enforced shell guard
  .cursor/hooks/guard-shell.mjs          <- blocks force-push, push to main, deploys, publish, --no-verify
```

Prompts are advice; hooks are enforcement. A hook runs in the VM before every
shell command and can deny it regardless of what the model decided. Test the guard
locally:

```bash
echo '{"command":"git push --force origin x"}' | node target-repo-kit/.cursor/hooks/guard-shell.mjs
```

### Step 7: give it an idea, get an app

```bash
npm run build-app -- --idea-file ideas/example-snippet-vault.md --repo https://github.com/you/snippet-vault
npm run build-app -- --idea "A CLI that turns a CSV into a SQLite db" --create-repo csv2sqlite
npm run build-app -- --resume bc-xxxx                       # continue after a stop
```

This is steps 3 and 4 turned into a loop that runs until the app is done:

```
spec  ->  [ iterate: pick next milestone -> implement -> verify -> commit -> report ]*  ->  finish
```

- **spec** (`prompts/app/spec.md`): the agent writes `SPEC.md` (flows, non-goals,
  stack, quality bar) and `ROADMAP.md` (at most 7 milestones, each with
  command-checkable acceptance items; M1 is always a walking skeleton). It commits
  them and reports the milestone list as JSON.
- **iterate** (`prompts/app/iterate.md`): each turn re-derives state from disk,
  takes exactly one milestone, ticks acceptance boxes only when the command
  passes, commits, and reports `{ milestone_id, completed, remaining, blocked }`.
- **finish** (`prompts/app/finish.md`): a release gate that clones into `/tmp`,
  follows only the README, runs the quality bar, and exercises every user flow.

The driver (`src/lib/build-loop.ts`) decides when to stop, and every decision is
based on the JSON reports, not on vibes:

| Stop reason | What happened | Exit | Next |
| --- | --- | --- | --- |
| `complete` | finish gate verified every flow | 0 | Review the PR |
| `blocked` | a milestone needs a human (secret, paid service, decision) | 3 | Do the thing, `--resume` |
| `stalled` | same milestone incomplete 2 turns; one `unblock.md` intervention did not fix it | 4 | Read `ROADMAP.md` Notes, split or rewrite, `--resume` |
| `max-iterations` | budget spent (default 12) | 4 | `--resume --max-iterations N` |
| `finish-reported-incomplete` | gate found unverified flows | 4 | Read `known_gaps`, `--resume` |
| `unparseable-report` | two turns without a JSON block | 4 | Usually a prompt/model issue |

State is written to `.runs/build-<agentId>.json` after every turn, so a killed
process or a closed laptop loses nothing: the cloud agent, its branch, and the PR
are all still there. The PR grows one milestone at a time, which is how you review
it.

`ideas/TEMPLATE.md` shows what a good idea file contains. The single biggest lever
is the **Must have (v1)** list: five or fewer bullets. The spec phase turns
everything else into Non-goals, and Non-goals are what keep an unattended loop
from building forever.

The loop logic has no SDK dependency, so its stop conditions are testable with a
fake agent; that is how it was verified.

**First live run** (`ideas/example-snippet-vault.md`, `composer-2.5`): 6
milestones, 6 iterations, 0 stalls, about 45 minutes, about $4.57 in tokens, 19
tests, all 7 user flows verified by the release gate. Public result:
[rvegajr/snippet-vault](https://github.com/rvegajr/snippet-vault) — transcripts,
cost, and a zip of `main` are under
[docs/artifacts](https://github.com/rvegajr/snippet-vault/tree/main/docs/artifacts)
and [releases](https://github.com/rvegajr/snippet-vault/releases). Two lessons
that are now baked into the prompts:

- The agent opened a new stacked branch and PR per milestone instead of growing
  one PR. Harmless (the last PR contained everything) but noisy; `iterate.md` now
  says to stay on one branch.
- The release gate passed on the VM's Node but a fresh clone failed on the
  operator's Node 26 because `better-sqlite3@11` had no prebuilt binary. The
  gate can only test the runtime it has. Fixed by resuming the agent with the
  finding (53 seconds); `spec.md` now steers toward built-ins or latest-major
  native deps. **Always do one fresh-clone verification on your own machine.**

### Step 8: trigger from Slack

```bash
npm run slack
```

A Bolt app in Socket Mode (no public URL). It is *your* Slack app, created
from `slack-app-manifest.json`, and `@<bot>` below is whatever your workspace
named it (the manifest ships as `CloudAgents`; rename it and the bot picks the
new name up at startup). It is not Cursor's own `@Cursor` app: mentioning that
runs Cursor's agent without the Jam fetch, triage, or verify gate.

The mention is a small CLI:

```
@<bot>                          usage (projects, channel default, examples)
@<bot> <project>                that project's repo / branch / options
@<bot> <project> -              same
@<bot> <project> <request>      start a job
@<bot> <request>                start a job on this channel's project
@<bot> version                  which build of the bot is answering
```

A channel whose name starts with a project (`#api-bugs`, `#web-agent-test`,
any suffix) selects that project, so you can omit the name.
Paste a jam.dev URL or a sentence; the bot fetches the recording, triages it
into a brief, runs plan → implement → verify, and posts the PR. A later
@mention in that thread resumes the same `bc-` agent.

**The bot cannot deploy.** It holds no Vercel or Railway credential, and there is
no `deploy` verb: merging the PR is the only trigger. The deploy card you see in
the channel is posted by Vercel for Slack or a Railway webhook, neither of which
runs through this process — `IMPLEMENTATION-GUIDE.md` phase F sets them up, and
`ARTICLE-SLACK.md` step 6½ is the argument for doing it this way.

Set `JAM_TOKEN` from jam.dev → Settings → MCP (`mcp:read`). Cloud VMs do not
have Jam MCP; `src/lib/jam.ts` fetches evidence before the prompt is sent.

Create the Slack app from `slack-app-manifest.json` (api.slack.com/apps → From
an app manifest), mint a bot token (`xoxb-`) and an app-level token with
`connections:write` (`xapp-`), put them in `.env`, `/invite @<bot>`.

`SLACK_PROJECTS=api=https://github.com/you/api@develop,web=https://github.com/you/web@develop`
is the CLI catalog. `SLACK_CHANNEL_REPOS=C0123=https://github.com/you/api@develop,#web-bugs=https://github.com/you/web`
still maps a channel id/`#name` when the channel is not prefixed with a
project. Usage text prints the bot's real Slack name; `SLACK_BOT_HANDLE` only
overrides it. `SLACK_CURSOR_USER_ID` (the member id of Cursor's official app,
optional) makes a stray `@Cursor` in those channels answer with a pointer to
`@<bot>` and the usage. Unmapped channels use `TARGET_REPO`/`TARGET_REF`.

To leave it running when the laptop is closed:

```bash
railway init
railway variables --set SLACK_BOT_TOKEN=... --set SLACK_APP_TOKEN=... --set JAM_TOKEN=... # plus TARGET_* and CURSOR_*
npm run deploy       # stamps the git commit into BUILD_INFO, then railway up
```

`railway.json` installs the Jam CLI if needed, then starts `npm run slack`.
Socket Mode dials out; no domain needed.

Walkthrough: `ARTICLE-SLACK.md`.

### Versioning and releases

A bot you cannot see needs to be able to tell you what it is running.

```bash
npm run stamp        # write version.json + print the BUILD_INFO pair
npm run deploy       # stamp the host, then railway up
npm run doctor -- --phase E   # warns when the stamp and HEAD disagree
```

`src/lib/version.ts` resolves the version from `BUILD_INFO` (set by
`npm run deploy`), then `version.json`, then live `git describe`, then bare
`package.json` — and reports *which* source it used, so a local checkout cannot
pass itself off as a deployed build. The bot prints it as the first line of its
logs and answers `@<bot> version` with the detail. The stamp has to travel as an
environment variable because `railway up` honours `.gitignore` and a built image
has no `.git`.

Releases are semver git tags with a `CHANGELOG.md` entry:

```bash
# move CHANGELOG.md's Unreleased section under the new version, then:
npm version minor -m "release: v%s"   # bump + commit + annotated tag
git push --follow-tags
```

`--follow-tags` is what stops you pushing the commit and leaving the tag behind.

---

## 4. Prompt anatomy: what actually goes in

The single biggest lever on outcome quality is the brief. Open
`briefs/TEMPLATE.md` and `briefs/example-health-endpoint.md`. Every section
exists to prevent a specific failure:

| Section | Failure it prevents |
| --- | --- |
| **Goal** (outcome, not activity) | The agent optimises for "did the steps" instead of "the thing works" |
| **Context** (paths, patterns to copy, a jam.dev URL for bugs) | Twenty minutes of exploration in a fresh clone, inventing a second convention, or inventing a repro the recording already captured |
| **Scope: in / out** | Drive-by refactors, new dependencies, touched CI config |
| **Definition of done** (each item checkable by a command or file) | "Done" that means "I stopped" |
| **Verification** (exact commands) | The agent deciding tests are optional |
| **Constraints** | Anything you would be angry about that is not covered above |

Then the phase templates in `prompts/` wrap the brief with three more things:

1. **Operating posture**: "you are unattended, nobody will answer questions, state
   assumptions and continue". Without this, models stop and ask.
2. **Process**: read repo guidance first, smallest change, verify with commands,
   commit, clean tree.
3. **Output contract**: exact section headings, and for the final phase a JSON
   block a program can parse. This is the difference between an agent and a demo.

Things that are deliberately **not** in the prompts:

- Personality, flattery, "you are an expert". No measurable effect; costs tokens.
- Long style guides. Those belong in `AGENTS.md` / `.cursor/rules/` inside the
  target repo where every agent (and human) sees them, not re-sent on every run.
- Secrets. Use `cloud.envVars` on `Agent.create()` or per-run on `send()`; they are
  injected into the VM shell and deleted with the agent.

---

## 5. Failure modes you will hit, and what they mean

| Symptom | Meaning | Fix |
| --- | --- | --- |
| Script exits 1, `Startup failed` | Run never started: auth, config, network | `npm run login`, check `.env`, check repo is connected |
| Script exits 2, status `error` | Run started and failed | Read the transcript at cursor.com/agents; check `.runs/` for IDs |
| Exits 2, status `finished`, report `done: false` | Agent ended cleanly but could not meet the brief | Read `definition_of_done` in the report; usually the brief was ambiguous or verification is missing in the repo |
| `[status] CREATING` for a long time | VM provisioning + clone | Normal for large repos; nothing to do |
| Agent asks a question and stops | Prompt lacked the unattended posture, or the brief has a real gap | Fix the brief; resume with the answer |
| PR touches files outside scope | Scope section too vague | Add explicit `Out:` bullets; add a hook if it is a hard rule |
| Tests "pass" but were weakened | Verification not re-run independently | That is what phase 3 is for; never skip it |

---

## 6. Where to go from here

- **Trigger from Slack.** Step 8 above. Same pipeline, human-readable front door.
- **Trigger from GitHub.** Wrap `src/02-cloud-oneshot.ts` in a GitHub Action on
  `issues.labeled` and pass the issue body as the brief. The kit's exit codes
  are already CI-friendly. `startJob` / `continueJob` in `src/lib/slack-fix.ts`
  are Slack-agnostic aside from the `post` callback.
- **Parallel briefs.** `Agent.create()` is cheap; launch one agent per brief with
  `Promise.all`, collect the PR URLs. Keep briefs independent so PRs do not conflict.
- **Review loop.** After the PR is open, a second agent (or the same one via
  `resume`) reads the PR comments with `gh` and addresses them. That is the
  feedback arrow in the diagram; Slack step 8 is the same arrow from a thread.
- **Scheduled maintenance.** A cron that runs a brief like "bump dependencies with
  no major versions, run tests, open PR" every Monday. This is what Grok Bot calls a
  routine.
- **Give it tools.** Pass `mcpServers` on `Agent.create()` for HTTP or stdio MCP
  servers (issue trackers, databases, deploy platforms). Credentials go through
  `headers`/`auth` (proxied) or stdio `env` (in-VM).
- **Python instead.** `pip install cursor-sdk`. Same `Agent` → `Run` model; sync by
  default with an async mirror.

## Reference

- SDK docs: [cursor.com/docs/sdk/typescript](https://cursor.com/docs/sdk/typescript)
- Cloud agents: [cursor.com/docs/cloud-agent](https://cursor.com/docs/cloud-agent)
- Hooks: [cursor.com/docs/hooks](https://cursor.com/docs/hooks)
- Grok Bot docs (same loop, productised): [docs.x.ai/grok-bot/overview](https://docs.x.ai/grok-bot/overview)

## Layout

```
cloud-agents/
  README.md                      this guide
  ARTICLE.md                     walkthrough: idea -> app on a cloud agent
  ARTICLE-SLACK.md               walkthrough: Slack @mention -> PR
  IMPLEMENTATION-GUIDE.md        agent-executable recipe: credentials, phases, human gates
  CHANGELOG.md                   what changed between tags
  slack-app-manifest.json        paste at api.slack.com/apps
  railway.json                   start command for npm run slack
  .env.example                   credentials + target repo + Slack tokens
  briefs/
    TEMPLATE.md                  the brief skeleton, with a rationale per section
    example-health-endpoint.md   a filled-in, runnable example
  ideas/
    TEMPLATE.md                  what an app idea file needs
    example-snippet-vault.md     a runnable example idea
  prompts/
    oneshot.md                   single-pass wrapper (step 2)
    01-plan.md  02-implement.md  03-verify.md     the pipeline phases (step 3)
    slack/
      jam.md                     how to read a jam.dev recording
      triage.md  followup.md     Slack turn 0 and thread replies (step 8)
    app/
      spec.md  iterate.md  unblock.md  finish.md  the idea -> app loop (step 7)
  src/
    00-login.ts                  browser login, stores a key
    01-local-smoke.ts            Agent.prompt, local
    02-cloud-oneshot.ts          Agent.create + send, cloud, PR
    03-cloud-pipeline.ts         CLI over plan -> implement -> verify
    04-resume.ts                 pick up a bc- agent later
    05-status.ts                 account, models, repos, agents, usage
    06-build-app.ts              idea -> spec -> milestones loop -> release gate
    07-slack-bot.ts              Bolt Socket Mode; @mention -> pipeline
    08-doctor.ts                 read-only preflight: every credential, scope, grant
    09-stamp-version.ts          stamp the commit into BUILD_INFO before a deploy
    lib/
      pipeline.ts                plan -> implement -> verify, SDK-agnostic
      jam.ts                     fetch jam.dev recordings into the prompt
      slack-cli.ts               mention CLI: usage, <project>, version, channel prefix
      slack-cli.test.ts
      slack-fix.ts               startJob / continueJob
      slack-thread.ts            agent id in thread, allowlist, dedupe
      build-loop.ts              the loop: phases, stall/block detection, resumable state
      doctor.ts                  verdict model, scope diffing, credential shape checks
      doctor.test.ts
      version.ts                 BUILD_INFO -> version.json -> git -> package.json
      version.test.ts
      auth.ts                    env -> stored login -> interactive
      prompts.ts                 load templates and briefs, render {{vars}}
      stream.ts                  readable transcript from run.stream()
      report.ts                  exit codes, run records, JSON report parsing
      env.ts                     .env loader and argv flags, no deps
  target-repo-kit/               copy into the repo the agent works on
    AGENTS.md
    .cursor/rules/autonomous-agent.mdc
    .cursor/hooks.json
    .cursor/hooks/guard-shell.mjs
```
