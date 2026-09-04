# I Wired Slack to a Cloud Agent So a Bug Report Became a Pull Request

## A step-by-step guide to taking any existing repo, attaching Slack, and letting an @mention kick off the same plan/implement/verify loop from the first article

I already had the loop: a brief, a cloud VM, three phases, a pull request. The
missing piece was the front door. Bugs do not arrive as markdown files in
`briefs/`. They arrive as a [jam.dev](https://jam.dev) recording — console,
network, clicks, video — pasted into Slack while you are in a meeting.

This article adds that door. By the last step you will have a bot that sits in
a channel, treats a mention as a small CLI, treats a jam.dev link as the source
of truth, turns it into a brief, runs the pipeline against the repo that channel
(or the project name) selected, posts the PR in the thread, and treats a reply
as feedback to the same agent.

This is not Cursor's official Slack app. That app already exists, and step 0
tells you when to use it. This is the same kit as the first article, with one
more script, so you can see every moving part.

Each step is a single command or a five-minute click-through. Total time if you
do everything: about an hour, plus however long the agent spends on the actual
fix. Total extra cost: the tokens for one cloud run, typically a few dollars.

The live run that proved the door works: **13 minutes** from `@mention` to
a PR in the same Slack thread, **547,656 tokens**, **$0.49**, PR
https://github.com/rvegajr/rubriq-flow/pull/164. The first turn's plan-mode
triage did not emit parseable JSON; a follow-up `@mention` in that thread
resumed the same `bc-` agent, implemented, and posted the checklist.

---

## The loop, in one picture

```
jam.dev URL in Slack  →  bot fetches the recording  →  triage (brief)
        →  plan  →  implement  →  verify  →  PR in the thread
        ↑                                                      |
        └──────── reply in the same thread (another Jam ok) ─┘
```

The inner four boxes are the pipeline from the first article. The new pieces
are the arrows on the left and the right: a recording in, a PR out, with the
thread as the durable handle. A Slack sentence still works. A Jam is what you
should send.

## What you need

- Everything from the first article: Node 22+, a GitHub repo connected to
  Cursor, a paid Cursor plan, the kit cloned
- A Slack workspace where you can create an app (most of them)
- The repo you want the bot to work on. Any repo. For one repo, set
  `TARGET_REPO`. For several, set `SLACK_PROJECTS` and start each channel
  name with the project (`#api-bugs`). Nothing in the TypeScript names a
  specific product, a specific channel suffix, or a specific bot name.
- A [jam.dev](https://jam.dev) workspace and a read PAT (`JAM_TOKEN`). Optional
  only if you are fine with prose reports. Without the token the bot can see
  the share URL, not the console and network events.

```bash
git clone https://github.com/rvegajr/cloud-agents
cd cloud-agents
npm install
cp .env.example .env
npm run login
```

Set `TARGET_REPO` and `TARGET_REF` in `.env` to the repo and integration
branch you actually use (`main`, `develop`, whatever it is). If you already
know you have more than one repo, also set `SLACK_PROJECTS` now (step 3
shows the format). Check that Cursor can see the repo:

```bash
npm run status
```

---

## Step 0: You might not need this bot

Cursor already ships a Slack integration. Install it from
[cursor.com/dashboard](https://cursor.com/dashboard), mention `@Cursor` with a
prompt, get a cloud agent and a PR. For a sharp, well-scoped request in a
channel that already knows which repo to use, that is enough. `@Cursor help`
lists Cursor's own commands. It will not print *your* project catalog.

Build this bot instead when you want seven things the official app does not
give you as files you can read:

1. **A Jam as the brief.** Paste `https://jam.dev/c/<uuid>`. The bot fetches
   notes, console errors, failed requests, the click path, and video analysis,
   then writes the brief from that. Cloud VMs do not have Jam MCP; this
   process does the fetch so the agent is not guessing from a paragraph.
2. **Triage into a brief.** A Slack sentence is not a definition of done. The
   first turn writes one, or asks one or two questions, before anyone spends
   implement tokens. A Jam usually makes those questions unnecessary.
3. **The verify gate.** A JSON report with per-item evidence, not just "the
   agent finished."
4. **Repo-level enforcement.** Hooks that deny `git push --force` even if the
   model decides to try.
5. **A mention CLI and channel-aware targeting.** `@<bot>` alone prints
   usage. `@<bot> <project>` (or `@<bot> <project> -`) prints that
   project's repo and options. A channel named `#api-bugs` selects `api`
   so the name can be omitted. One bot, many repos, no extra Slack apps.
6. **Control over the thread.** Channel allowlist, concurrency cap, a cost
   line on every job, no extra Slack scopes.
7. **Deploy from the channel.** `@<bot> api deploy` fires a Vercel or
   Railway deploy from the bot process and reports ✅/❌ back. The agent still
   cannot deploy; the hook blocks it. A person in Slack can.

If those do not matter to you, stop here and install `@Cursor`. The rest of
this article is those seven things, as code.

One naming rule for the rest of the article. `@Cursor` means Cursor's app.
`@<bot>` means the app *you* create in step 2 from the kit's manifest, under
whatever name your workspace gives it. The manifest ships as `CloudAgents`;
call it `Shipper` or `Fixer` and the bot reads the new name from Slack at
startup and prints that in its usage. A workspace cannot have two apps named
`Cursor`, so the two are never the same mention.

**What you learned:** the product and the pattern are different. The product
is a mention. The pattern is still recording → brief → VM → verify → PR →
feedback.

---

## Step 1: Make the existing repo agent-ready

Pointing a cloud agent at a repo that was set up for humans in an IDE is how
unattended runs go off the rails. Do this before you invite Slack into it.

Copy the kit into the **target** repo, not this one:

```bash
cp target-repo-kit/AGENTS.md /path/to/your-repo/
cp -R target-repo-kit/.cursor /path/to/your-repo/
```

Then fill in `AGENTS.md`. The agent reads it on every run. The blanks that
actually matter:

| Blank | Why existing projects get this wrong |
| --- | --- |
| Commands | Install at the repo root, test in a subdirectory. Write both. |
| Integration branch | Many repos use `develop`, not `main`. Set `TARGET_REF` to match. The shell hook now blocks pushes to `main`, `master`, *and* `develop`. |
| Tests the agent can run | If `npm test` needs Docker, Mailpit, or a paid API, say so, and give the agent the subset that works in a fresh clone (unit + typecheck is enough). |
| Never | CI config, production deploy files, existing migrations. Prompts will not hold this line; the hook and this list will. |

Three other things a real repo usually has that fight the unattended posture:

1. **No `AGENTS.md`.** The agent spends the first ten minutes reconstructing
   what you would have written in one.
2. **A legacy `.cursorrules` written for chat.** Role banners, "ask before
   acting," "wait for confirmation." Those are correct for an interactive
   session and fatal for a bot. Either scope them to interactive use, or add
   `.cursor/rules/autonomous-agent.mdc` from the kit (it is `alwaysApply`) so
   the unattended style is in the repo the VM clones.
3. **Native addons and missing env files.** `bcrypt`, `better-sqlite3`, a
   required `.env.local`. If `npm ci && npm test` cannot succeed on a stock
   Ubuntu VM, the verify phase cannot succeed either. Document the minimum
   env in `AGENTS.md` (copy from the example file, no secrets) or the agent
   will invent one.

Prove it with a read-only run. Cheap, reversible, tells you whether Cursor
can clone the repo at all:

```bash
npm run pipeline -- --repo https://github.com/you/your-repo \
  --ref develop \
  --brief example-health-endpoint \
  --plan-only
```

Use a brief that is *wrong for this repo* on purpose. You are not trying to
land a health endpoint. You are trying to see `[status] CREATING`, a clone,
and a plan that mentions the real layout. If that works, Slack is a trigger.
If it does not, Slack will not save you.

**What you learned:** the bot does not make a repo agent-ready. `AGENTS.md`
and the hook do. Slack only fires the starting pistol.

---

## Step 2: Create the Slack app, five minutes, two tokens

The kit ships a manifest so you do not click through scopes by hand.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App**
   → **From an app manifest**.
2. Paste `slack-app-manifest.json`. Change `name` and `display_name` if you
   want; that is the `@<bot>` handle from here on.
3. **Socket Mode** is already on in the manifest. Under **Basic Information →
   App-Level Tokens**, generate a token with the `connections:write` scope.
   That is the `xapp-` value.
4. **Install App** to the workspace. Copy the **Bot User OAuth Token**
   (`xoxb-`).
5. Invite it to the channel: `/invite @<bot>`. Start the channel name with
   the project (`#api-bugs`, `#api-agent-test`; the suffix is yours). The
   leading segment is how the project is picked without typing one.

Put both tokens in `.env`:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

`SLACK_BOT_HANDLE` is not required. The bot calls `auth.test` and `users.info`
at startup and prints its own display name. Set the variable only if you
removed the `users:read` scope and the username it falls back to is not what
people see.

For one repo, `TARGET_REPO` / `TARGET_REF` are enough. For several, add a
catalog (aliases are lowercase, last duplicate wins):

```
SLACK_PROJECTS=api=https://github.com/you/api@develop,web=https://github.com/you/web@develop
```

`SLACK_CHANNEL_REPOS` still maps a channel id or `#name` when the channel is
not prefixed with a project. Mapped channels are implicitly allowed.

Optionally set `SLACK_ALLOWED_CHANNELS` to the channel ID (right-click the
channel in Slack → Copy link → the `C…` segment). Empty means every channel
the bot is in, which is fine for a first run and sloppy after that.

`SLACK_CURSOR_USER_ID` is optional: the member id of Cursor's official
`@Cursor` app, if it is also installed. When set, and the app is subscribed to
`message.channels` (already in the manifest), someone who types `@Cursor` in a
channel this bot is in gets a one-line pointer to `@<bot>` and the usage,
because that mention went to Cursor's agent, not this pipeline. `@Cursor
help`, `settings`, and `list my agents` are left to Cursor.

Socket Mode means Slack opens a websocket **out** from this process. There is
no public URL, no ngrok, no request signing to debug yet. That is why this
step is five minutes and the Railway step can wait.

**What you learned:** two tokens, one outbound socket. The bot is a client of
Slack, not a server on the internet.

---

## Step 3: Run it, mention it, watch the thread

```bash
npm run slack
```

You should see a Socket Mode line naming the bot as Slack knows it, then the
same usage the bot posts in Slack (the examples use `@CloudAgents`, the
manifest's default; yours prints whatever you named it):

```
Slack CLI running (Socket Mode) as @CloudAgents. default=https://github.com/you/your-repo@develop  maxConcurrent=2
  project api -> https://github.com/you/api@develop
  project web -> https://github.com/you/web@develop
usage: @CloudAgents [<project>] [options] <request>
       @CloudAgents [<project>] deploy [env=<name>]
...
@CloudAgents                 this usage
@CloudAgents <project>       options for that project
@CloudAgents <project> -     same
@CloudAgents <project> deploy -   deploy targets for that project
```

If a Slack token is missing, it exits immediately with the name of the var.
That is the same fail-fast the other scripts use for `CURSOR_API_KEY`.

The mention is a CLI. Bare mention, or `help` / `-` / `--help`, prints usage.
A project name with nothing after it (or with `-`) prints that project's
repo, branch, and options. A request starts a job.

```
@<bot>
@<bot> api
@<bot> api -
@<bot> https://jam.dev/c/<uuid>
@<bot> the settings page 500s after logout
```

In `#api-bugs` you can omit `api`. In `#web-bugs`, `@<bot> api <request>`
still targets `api`. Inline options are stripped before triage:

```
@<bot> api branch=release autopr=true On hosted, the webhook retries.
```

If the message contains a jam.dev link, the first reply is `Reading Jam
https://jam.dev/c/… (console, network, click path, video)…`. Then a line you
should not edit:

```
agent: bc-…
Triaging against https://github.com/you/your-repo@develop
```

Then phase lines (`Planning (read-only)...`, `Implementing...`,
`Verifying...`) and, if the request was enough, a PR URL plus a checklist
copied from the verify JSON. An hourglass reaction on your mention turns into
a check or an X.

Open `src/lib/slack-cli.ts`. The parser is what makes a mention a CLI:

```typescript
const cli = parseMentionCli(event.text, { projects, channelProject: implied });
// kind: "usage" | "project-usage" | "run" | "deploy" | "deploy-usage"
```

Open `src/07-slack-bot.ts` for the Bolt listener. The part that branches once
there is a request:

```typescript
const existingId = findAgentId(threadMessages);

const outcome = existingId
  ? await continueJob({ agentId: existingId, message: request, repo, ref }, runtime)
  : await startJob({ repo, ref, request, threadContext }, runtime);
```

A new mention creates an agent. A mention in a thread that already has
`agent: bc-…` resumes it. There is no database. Restart the process, deploy
it, close the laptop: the thread still has the id.

Prove the parser without Slack:

```bash
npm test
```

**What you learned:** `@mention` is the only trigger. The first token is either
a project, a help token, or the start of the request. That is fewer Slack
scopes, no accidental fires from every message in `#bugs`, and the same
shape as `@Cursor`. The Jam URL is payload, not a second integration. The
channel name is how you stop typing the project on every message.

---

## Step 4: A jam.dev recording is the brief

A Slack paragraph is a guess about what happened. A Jam is the session:
the page, the role, the click path, the console, the failed requests, and
(if the mic was on) what the reporter said.

That is why Jam is not an optional attachment in this kit. It is the input
I actually use. The bot is written so the cloud agent can *see* the
recording, not just the URL.

Cloud VMs do not have Jam MCP. Opening `https://jam.dev/c/<uuid>` in a
browser is summary-only (signal counts, not events). So this process
fetches the evidence **before** it sends the triage prompt:

1. `extractJamIds` in `src/lib/jam.ts` pulls uuids out of the Slack text,
   including Slack's `<https://jam.dev/c/…>` auto-links.
2. `loadJamEvidence` runs the [Jam CLI](https://docs.jam.dev) (`jam --json
   get jam|console|network|chapters|intents`) with `JAM_TOKEN`.
3. `startJob` / `continueJob` inject that block plus `prompts/slack/jam.md`
   into the prompt. The playbook says: treat the recording as the source of
   truth; do not ask which page, role, environment, or expected vs actual
   when the Jam already shows them; ignore third-party noise unless the
   reporter called it out.

Create a PAT at jam.dev → **Settings → MCP** with `mcp:read`. Put it in
`.env` as `JAM_TOKEN`. The CLI honours the same name. If `jam` is not on
PATH, the bot installs it once (`curl -fsSL https://native.jam.dev/install`).

In Cursor itself (this laptop, this chat), add the Jam MCP server
`https://mcp.jam.dev/mcp` so *you* can read recordings the same way. That
MCP does not travel to the cloud VM. The prefetch is the bridge.

A Jam that lists several unrelated asks: implement the clearest
command-checkable bug (a 500, a failed import, a broken control) and list
the rest as follow-ups. One request per new Slack message; a second Jam of
the remainder goes in the **same thread**.

If there is no Jam, triage still works. It will ask for page, role, expected
vs actual, and environment — the things a recording would have given it for
free.

**What you learned:** the expensive mistake is letting the agent invent a
repro. A Jam is a repro the model did not write. Fetch it off the VM,
inject it, then let triage write the brief.

---

## Step 5: A Slack message is not a brief

Turn 0 is triage. It runs in `mode: "plan"` (read-only) against the repo,
with `prompts/slack/triage.md`, `prompts/slack/jam.md`, and
`briefs/TEMPLATE.md` in its prompt. It must emit:

```json
{
  "ready": true,
  "title": "Fix settings 500 after logout",
  "questions": [],
  "brief": "# Fix settings 500 after logout\n\n## Goal\n..."
}
```

or `ready: false` and at most three questions.

If the mention is "the thing is broken" and there is no Jam, you get
questions back, not a PR. Reply in the thread, mention the bot again. That
is a follow-up (step 6), not a new agent.

If `ready` is true, the same agent continues into the three-phase pipeline
from `src/lib/pipeline.ts` — the same function `npm run pipeline` uses. Plan
is still read-only. Implement is `mode: "agent"`. Verify re-derives from
`git diff` and re-runs the commands in the brief. The Jam URL belongs in the
brief's Context so later phases still have it.

The JSON at the end is the same shape as article 1:

```json
{
  "done": true,
  "summary": "one sentence",
  "definition_of_done": [{ "item": "...", "met": true, "evidence": "..." }],
  "verification": [{ "command": "npm test", "passed": true }]
}
```

`status: "finished"` still only means the model stopped talking. `done: true`
with evidence is what the bot posts as a check.

**What you learned:** the expensive mistake is skipping triage. A vague
mention plus implement is a confident wrong PR. A Jam plus triage is a
brief with a recorded definition of done.

---

## Step 6: The thread is the feedback loop and the database

The agent id is a durable handle. You already used this in the first article
as `npm run resume -- --agent bc-…`. Slack does the same lookup without you
copying the id:

```typescript
export const AGENT_ID_RE = /\bagent:\s*(bc-[a-z0-9-]+)/i;
```

`conversations.replies` on the thread, regex, `Agent.resume`. That is
`src/lib/slack-thread.ts` and `continueJob` in `src/lib/slack-fix.ts`.

Reply in the thread:

```
@<bot> the test you added doesn't cover the logged-out case. Add one.
```

or paste a second recording of what is still wrong:

```
@<bot> https://jam.dev/c/<uuid>
```

`continueJob` runs `loadJamEvidence` on the new message too. One follow-up
prompt (`prompts/slack/followup.md`) covers both situations: you were still
answering triage questions, or a PR already exists and this is review. The
agent stays on the same branch. The bot posts an updated checklist.

`.runs/` still gets a JSON record, for you, on the machine that ran the bot.
The thread does not need it. A Railway restart does not need it.

**What you learned:** state that has to survive a process restart belongs in
the conversation the human can already see. A second Jam is still that
conversation, not a new job.

---

## Step 6½: Deploy from the channel

The PR merged. The next question in the channel is always "is it out yet?"
The repo hook blocks the *agent* from running `vercel deploy` or `railway up`,
on purpose. It does not block *you*, and the bot process is yours. So the
mention CLI grows one verb:

```
@<bot> api deploy                 the default target for api
@<bot> api deploy env=uat         a named target
@<bot> api deploy -               list api's targets
@<bot> deploy                     this channel's project (#api-bugs)
@<bot> deploy api uat             same as the second line
```

Targets come from one variable, `<project>[/<env>]=<provider>:<spec>`:

```
SLACK_DEPLOYS=api=vercel:https://api.vercel.com/v1/integrations/deploy/prj_x/y,web/uat=railway:684f4bb6-…/uat/web+api,web/production=railway:684f4bb6-…/production/web+api
```

- `vercel:<deploy-hook-url>` — Vercel → project → Settings → Git → Deploy
  Hooks. A hook is tied to one branch, so a project with `develop` and `main`
  hooks gets two entries (`api=…` and `api/main=…`). The hook fires without
  a token; watching it to READY/FAILED needs `VERCEL_TOKEN` (and
  `VERCEL_TEAM_ID` for team projects).
- `railway:<projectId>/<environment>/<service>[+<service>]` — names or ids;
  `web+api` deploys both and waits for both. Uses `serviceInstanceDeployV2`
  on the GraphQL API, so it picks up the latest commit on the connected
  branch. Needs `RAILWAY_TOKEN` (a project token, scoped to one environment
  — prefer this when one target is enough) or `RAILWAY_API_TOKEN` (account
  token, needed once Slack should reach several environments or projects).
  Same names the Railway CLI uses.

An entry without `/<env>` is the default and runs when `env=` is omitted. If
every entry is named, the bot asks you to pick.

What you see in Slack, in order:

1. 🚀 on your message. Thread: `⏳ Deploying *api* (vercel prj_x job …) → <inspector url>`.
2. Thread lines as the state changes: `🔨 building — develop@a1b2c3d`.
3. The final line goes to the thread **and** the channel (`reply_broadcast`),
   @-mentioning you, so nobody has to follow the thread:
   `✅ *api* is live (1m 42s) — https://api-git-develop-you.vercel.app @you`
   or `❌ *api* deploy failed after 58s — <inspector url> @you`, followed by
   the last 25 build-log lines in the thread. The 🚀 turns into ✅ or ❌.

Who may run it is `SLACK_DEPLOYERS`, a list of Slack member ids. Empty means
anyone in an allowed channel, which is right for a two-person team and wrong
after that. One deploy per `project/env` at a time; a second request while
one is running gets "already running" instead of a second build.

Open `src/lib/slack-deploy.ts`. `parseDeploys`, `pickDeployTarget`, and the
two provider functions are the whole thing; `startDeploy` returns a `watch`
callback the bot drives. `npm test` covers the parsing.

Both Vercel projects in the running example already auto-deploy on push to
their linked branch, so there the command means "rebuild develop now." The
Railway project has no git trigger; there it is the only way to ship from a
phone.

**What you learned:** the hook says what the model may not do. The bot says
what a person in the channel may do. Deploy is the first place those two
lines diverge, and the code keeps them apart: the agent never gets a token
that can deploy; the bot process never gets a prompt.

---

## Step 7: Guardrails that belong in the bot, not the repo

The repo hook still blocks force-push. The bot adds more, because Slack
is a multi-user input:

| Guard | Where | Default |
| --- | --- | --- |
| Channel allowlist | `SLACK_ALLOWED_CHANNELS` | empty = all channels the bot is in |
| Project catalog | `SLACK_PROJECTS` | aliases printed by `@<bot>` / `@<bot> <project>` |
| Channel prefix | `#<project>-…` | selects that project so the name can be omitted |
| Mention in usage | `SLACK_BOT_HANDLE` | read from Slack; env var overrides |
| Stray `@Cursor` gets a pointer | `SLACK_CURSOR_USER_ID` | empty = off |
| Deploy targets | `SLACK_DEPLOYS` | empty = `deploy` is not offered |
| Who may deploy | `SLACK_DEPLOYERS` | empty = anyone in an allowed channel |
| One deploy per target | in-memory set of `project/env` | "already running" reply |
| Concurrency cap | `SLACK_MAX_CONCURRENT` | 2 |
| Duplicate events | `Deduper` on Slack's event id | 10 minute TTL |
| One job per thread | in-memory set of `thread_ts` | skip with a "already working" reply |
| Cost line | `agent.getUsage()` after the job | tokens, and dollars when billing has landed |

Open `src/07-slack-bot.ts` and `src/lib/slack-thread.ts` and match each row.
There is no extra service. The cap is per process; one Railway replica is one
cap, which is the point.

Also still true from article 1: `skipReviewerRequest: true`, so a Slack-fired
agent does not page a human reviewer on the GitHub side just because it
opened a PR.

**What you learned:** repo hooks are about what the model may do to git.
Bot guards are about who may spend your tokens, and how many at once.

---

## Step 8: Leave it running when the laptop lid closes

Socket Mode still applies on a server. The process dials out to Slack. You do
not need a domain, TLS, or a signing secret. Railway is one option; any box
that can keep a Node process alive and reach the internet works.

From this directory, after `railway login`:

```bash
railway init
railway variables --set "SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN" \
  --set "SLACK_APP_TOKEN=$SLACK_APP_TOKEN" \
  --set "TARGET_REPO=$TARGET_REPO" \
  --set "TARGET_REF=$TARGET_REF" \
  --set "CURSOR_API_KEY=$CURSOR_API_KEY" \
  --set "CURSOR_MODEL=composer-2.5" \
  --set "JAM_TOKEN=$JAM_TOKEN" \
  --set "SLACK_ALLOWED_CHANNELS=$SLACK_ALLOWED_CHANNELS" \
  --set "SLACK_PROJECTS=$SLACK_PROJECTS" \
  --set "SLACK_CHANNEL_REPOS=$SLACK_CHANNEL_REPOS" \
  --set "SLACK_CURSOR_USER_ID=$SLACK_CURSOR_USER_ID" \
  --set "SLACK_MAX_CONCURRENT=2" \
  --set "SLACK_DEPLOYS=$SLACK_DEPLOYS" \
  --set "SLACK_DEPLOYERS=$SLACK_DEPLOYERS" \
  --set "VERCEL_TOKEN=$VERCEL_TOKEN" \
  --set "RAILWAY_TOKEN=$RAILWAY_TOKEN"
railway up
railway logs
```

`RAILWAY_TOKEN` here is a project token for the *target* project, not for
the one running the bot. Mint it in that project's Settings → Tokens, scoped
to the environment you want Slack to be able to ship.

`railway.json` in the kit installs the Jam CLI if it is missing, then runs
`npm run slack`, and restarts on failure. The bot also self-installs `jam` on
first fetch if `JAM_TOKEN` is set. `tsx` is a runtime dependency so
`NODE_ENV=production` does not skip it.

Do not put Slack or Jam tokens in the GitHub repo. Railway variables (or
whatever your host uses) are the store.

When it is up, close the laptop, mention `@<bot>` from your phone with a Jam
link, come back to a PR.

**What you learned:** the hosting question is "can this process keep a
websocket open, and can it reach jam.dev with a token," not "what is my
public URL." That is why Socket Mode is the first path and HTTP is optional
later.

---

## What you now understand

The first article was the loop. This one is one way to fire it. The preferred
payload is a jam.dev recording, because that is the repro the model did not
invent. Every other front door — a GitHub `issues.labeled` Action, a Linear
webhook, a cron — is the same `startJob` / `continueJob` pair with a different
`post` callback. If that door also carries a Jam URL, call `loadJamEvidence`
the same way.

Three choices stay yours, and they are the same three as before:

- **Who owns the machine.** Cursor owns the VM that writes code. You own the
  process that talks to Slack and fetches Jams.
- **What the artifact is.** Still a PR. Slack is how you hear about it.
- **Where enforcement lives.** Hooks in the target repo, allowlist and cap in
  the bot, verify JSON as the definition of done. The Jam is the definition of
  *what happened*.

The parts that transfer if you throw this bot away tomorrow: a brief with a
checkable definition of done, a recording the agent can actually read, a
triage turn that is allowed to say "not yet," and a thread (or an issue, or a
comment) that holds the `bc-` id.

## Two mistakes to make early, on purpose

1. **Mention `@<bot>` with "fix it" and nothing else.** Watch it ask questions
   instead of opening a PR. That is triage working. Then mention it with a
   real `https://jam.dev/c/<uuid>` and compare the briefs. The second one
   should not ask which page you were on.
2. **Skip the `--plan-only` readiness run on the target repo.** You will debug
   Slack tokens for an hour before noticing Cursor cannot clone the repo.

Both cost a couple of dollars, or less. Both are cheaper than learning them
in `#prod-incidents`.

## Start here if you have 30 minutes

Steps 0, 1, 3, and 4. Copy `target-repo-kit/` into one real repo and fill
`AGENTS.md`; set `JAM_TOKEN`; run `npm run slack` against a channel named
`#<project>-sandbox` that nobody important is in; mention `@<bot>` with nothing
to see usage, then paste one Jam, with `--plan-only` already proven. Do step 8
when you trust the thread enough to let it run overnight.
