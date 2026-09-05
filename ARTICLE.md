# I Gave a Cursor Cloud Agent a One-Page Idea and It Shipped a Working App While I Watched

## A step-by-step guide to driving Cursor Cloud Agents from a terminal with the Cursor SDK, using about $4 of tokens

Last night I typed one command, walked away for 45 minutes, and came back to a
working web app with 19 passing tests, a README, and a pull request. The agent
picked the stack, wrote the spec, built it in six milestones, verified each one,
and told me what it deliberately left out.

The agent was a **Cursor Cloud Agent**: a VM that Cursor provisions, clones your
repo into, and hands to a model with a shell. The thing I typed the command into
was a 160-line TypeScript script that talks to that agent through the
[Cursor SDK](https://cursor.com/docs/sdk/typescript). Everything interesting in
this article is in the space between those two: what you send the agent, how you
know it is done, and what you do when it is not.

This is not a demo of a product. It is a pattern you can run yourself, and once
you see how few moving parts there are, every "autonomous coding agent" product
becomes easy to reason about, because they all run the same loop. Each step
below is a single command. Total time if you do everything: about two hours.
Total cost: under $10.

---

## The loop, in one picture

```
idea/brief (or a jam.dev recording)  →  prompt  →  Cursor Cloud Agent (VM)  →  verify  →  pull request  →  feedback
    ↑                                                                                                       |
    └───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Every step below adds one piece of this picture. By step 7 you will have built
the whole thing.

## What a Cursor Cloud Agent actually is

Get this straight first, because the rest of the article, and the whole Slack
article, depends on it.

A Cloud Agent is Cursor's hosted agent. When you start one, Cursor provisions an
isolated Linux VM, clones the repository you name, and runs the agent there with
a shell, network access, and whatever environment the repo describes. The agent
works on its own branch, pushes, and opens a pull request. It has an id that
starts with `bc-`, it shows up at [cursor.com/agents](https://cursor.com/agents)
with its full transcript, you can follow it or send it a message from the web,
the desktop app, or the iOS app, and it is billed to your Cursor plan at API
pricing for the model you picked. You can run as many in parallel as you like;
your laptop does not need to stay on.

There are several ways to start one: the Cloud button in Cursor, cursor.com/agents,
the iOS app, Cursor's own `@Cursor` Slack app, a `@cursor` comment on a GitHub
PR, Linear, or the API. This kit uses the API path through the SDK:

```typescript
await using agent = await Agent.create({
  apiKey,
  model: { id: "composer-2.5" },
  cloud: { repos: [{ url: repo, startingRef: "main" }], autoCreatePR: true },
});
const run = await agent.send(prompt);
```

That call *is* a Cloud Agent. Nothing in this kit runs code on Cursor's
infrastructure except what the agent itself does inside its VM. The scripts in
`src/` (and the Slack bot in the next article) run wherever you run them: your
laptop, a cron box, a Railway service. They are orchestrators. They decide what
to send, read the structured reply, and decide whether to send more.

So there are three layers, and it pays to keep their names apart:

| Layer | What it is | Where it runs | Who owns it |
| --- | --- | --- | --- |
| **Your orchestrator** | `src/*.ts`, prompts, the Slack bot | Your machine / Railway | You |
| **Cursor SDK** | `@cursor/sdk`: `Agent.create`, `send`, `resume`, `getUsage` | Inside your orchestrator, as a library | Cursor (npm) |
| **Cursor Cloud Agent** | The VM, the model, the branch, the PR, the `bc-` id | Cursor's infrastructure | Cursor (billed to you) |

The repo the agent works on is a fourth thing, on GitHub, and the guardrails in
step 6 live there because that is the only place the agent is guaranteed to read
them.

**What you learned:** "the agent" is the VM Cursor runs. Everything you will
write in this article is the thing that talks to it.

---

## What you need

- A Mac, Linux, or Windows machine with Node.js 22 or newer
- A GitHub account, connected to Cursor (cursor.com/agents → connect GitHub)
- A Cursor account on any paid plan (Cloud Agents need one)
- 20 minutes for the first four steps

The code lives in a small kit I built while learning this. Clone it:

```bash
git clone https://github.com/rvegajr/cloud-agents
cd cloud-agents
npm install
cp .env.example .env
```

You do not need to edit `.env` yet.

---

## Step 0: Log in once

```bash
npm run login
```

A browser opens to cursor.com. Sign in. The terminal prints:

```
Logged in as you@example.com. Key stored in ~/.cursor/sdk/auth.json.
Stored login expires 12/1/2026
```

That is a 90-day API key. Every other command finds it automatically. You never
paste it anywhere. (A key from cursor.com/dashboard/integrations in `.env` as
`CURSOR_API_KEY` works the same way and is what you use on a server.)

**What you learned:** the agent runs under your identity, on Cursor's
infrastructure, billed to your plan. Nothing here is a separate service.

---

## Step 1: Run an agent locally, so the first thing you debug is not the cloud

```bash
npm run smoke
```

About ten seconds later you get five bullet points explaining how the kit works,
written by an agent that just read the kit's own files. At the bottom:

```
=== local smoke: finished in 8.3s ===
tokens: 73025 (in 47908 / out 1053)
```

This one is *not* a Cloud Agent. Open `src/01-local-smoke.ts`. It is 30 lines.
The part that matters:

```typescript
const result = await Agent.prompt(prompt, {
  apiKey,
  model: { id: "composer-2.5" },
  local: { cwd: process.cwd() },
});
```

`local` means the SDK runs the agent on this machine against this folder. That
is the entire API for a one-shot agent run: a prompt, a model, and where to run.
Everything in the next six steps is this call with `cloud` instead of `local`
and more structure around it.

**What you learned:** if this works, auth and model access work. Every later
failure is about repos, prompts, or the loop, never the SDK.

---

## Step 2: Look at a run that already happened

Before spending money, read what a real Cloud Agent run looks like. The full
transcript of the app I built in step 7 is published with the app:
[snippet-vault/docs/artifacts/build-live.log](https://github.com/rvegajr/snippet-vault/blob/main/docs/artifacts/build-live.log)
(the kit writes these to a local, git-ignored `.runs/` folder; that copy is the
one I committed on purpose).

Scroll slowly. You will see:

- `[status] CREATING` — Cursor is provisioning the VM and cloning the repo.
- `phase: spec` — the agent reads an empty repo, writes `SPEC.md` and
  `ROADMAP.md`, commits them, and returns a JSON block listing six milestones.
- `iteration 1/8` — it reads those two files back from disk, marks M1 "in
  progress", scaffolds the project, runs lint/typecheck/test/build, fixes a build
  error it caused, commits, and reports `"completed": true, "remaining": 5`.
- Five more iterations, one milestone each.
- `phase: finish` — it clones its own work into `/tmp`, follows only the README,
  runs everything, exercises every user flow, and reports `"complete": true`.

Then open the repo it produced and read `SPEC.md` and `ROADMAP.md`. Notice that
every iteration worked from those files, not from the original idea. That is the
trick that makes long unattended runs stable: the agent writes its own
instructions once, then follows them.

**What you learned:** what "autonomous" actually looks like turn by turn. It is
not magic. It is a loop with a very disciplined report format.

---

## Step 3: Your first Cloud Agent, read-only

Now the same thing, but on a Cursor VM against a real repo. Pick any repository
you own that is connected to Cursor. Check what is connected:

```bash
npm run status
```

Then run the three-phase pipeline in plan-only mode, so nothing is changed:

```bash
npm run pipeline -- --repo https://github.com/you/some-repo \
  --brief example-health-endpoint --plan-only
```

Watch the stream:

```
[status] CREATING        ← VM booting, repo cloning
[status] RUNNING
[tool] read_file  /workspace/package.json
[tool] run_terminal_cmd  cd /workspace && ls src
...
### Plan
1. Add src/routes/health.ts ...
### Verification
- npm test
```

The agent explored your repo and wrote a plan for adding a `/health` endpoint. It
edited nothing. Cost: well under a dollar. While it runs, open
[cursor.com/agents](https://cursor.com/agents) and filter Source → SDK. The same
agent is there, with the same transcript, and you could type a follow-up in
that page instead of in the terminal. Same agent, two windows onto it.

Now open two files side by side: `prompts/01-plan.md` (what the agent was told)
and `src/03-cloud-pipeline.ts` (how it was sent). Match what you saw in the
stream to those files. The only difference from step 1 is this:

```typescript
cloud: {
  repos: [{ url: repo, startingRef: "main" }],
  autoCreatePR: true,
  skipReviewerRequest: true,
}
```

Swap `local` for `cloud` and you get a fresh machine, a branch, and a PR.
`skipReviewerRequest` keeps a script-launched agent from paging a human reviewer
on GitHub just because it opened one.

**What you learned:** the cloud is one field. The plan/implement/verify split is
just three prompts sent to the same conversation, each with one job and one
output format.

---

## Step 4: Let it change something

Same command without `--plan-only`:

```bash
npm run pipeline -- --repo https://github.com/you/some-repo --brief example-health-endpoint
```

This time it plans, implements, and then runs a third phase that re-reads the
diff, re-runs the tests, and emits a JSON report:

```json
{
  "done": true,
  "definition_of_done": [
    { "item": "GET /health returns 200", "met": true, "evidence": "curl output" }
  ],
  "verification": [{ "command": "npm test", "passed": true }]
}
```

The terminal ends with a PR URL. Go read it. It is a real branch with real
commits you can merge or close.

**What you learned:** the JSON block is the whole point. `status: "finished"`
only means the agent stopped talking. `done: true` with evidence means the work
is done. Programs (and tired humans) need the second one.

---

## Step 5: Write your own brief

Open `briefs/TEMPLATE.md`. Six sections:

| Section | Why it exists |
| --- | --- |
| Goal | Outcome, not activity |
| Context | Where the code lives, so the agent does not spend 20 minutes guessing. For a bug, a jam.dev URL (`https://jam.dev/c/<uuid>`) is the repro: notes, console, network, click path, video. |
| Scope: in / out | Prevents drive-by refactors and new dependencies |
| Definition of done | Each item checkable by a command |
| Verification | The exact commands that must exit 0 |
| Constraints | Anything you would be angry about |

Copy it to `briefs/my-first-change.md` and fill it in for something small and
real in one of your repos. If the work is a bug you captured with
[Jam](https://jam.dev), put the share link in **Context** and do not retype
page, role, or expected vs actual; the recording already has them. The Cloud
Agent's VM cannot open a Jam (no Jam MCP there), so either paste the evidence
into the brief yourself, or use the Slack bot from the next article, which
fetches the recording on your side before the prompt is sent. Then:

```bash
npm run cloud -- --brief my-first-change --repo https://github.com/you/some-repo
```

Review the PR. Something will be slightly off. That is not a failure; that is the
brief telling you what it was missing. Fix the brief, not the code, and run it
again. This feedback cycle is the actual skill. After three or four briefs you
will write them right the first time.

**What you learned:** the brief is the biggest lever on quality. A vague brief
produces a confident wrong answer. A brief with a command-checkable definition
of done, and, for a bug, a jam.dev recording instead of a guessed repro,
produces a PR you can merge.

---

## Step 6: Put the guardrails in the repo, not the prompt

Prompts are advice. The agent usually follows them. "Usually" is not good enough
for `git push --force`.

Cloud Agents run the command hooks in `.cursor/hooks.json` from the repo they
clone, inside the VM, before every shell command. That is the enforcement point.
The kit has a folder called `target-repo-kit/`. Copy its contents into the root
of any repo you point agents at:

```
your-repo/
  AGENTS.md                            ← how to build, test, what never to touch
  .cursor/rules/autonomous-agent.mdc   ← working style for unattended runs
  .cursor/hooks.json                   ← runs a script before every shell command
  .cursor/hooks/guard-shell.mjs        ← denies force-push, push to main, deploys
```

The hook can say no regardless of what the model decided. Try it locally:

```bash
echo '{"command":"git push --force origin x"}' | node .cursor/hooks/guard-shell.mjs
# {"permission":"deny","user_message":"Blocked: force-push is never allowed for agents"}
```

Fill in `AGENTS.md` with your real commands and conventions. Commit. Every agent
that touches this repo now reads it first. If your tests need system packages
or services, also look at `.cursor/environment.json` in Cursor's
[Cloud Agent setup docs](https://cursor.com/docs/cloud-agent/setup): it tells
Cursor how to build the VM, which is the difference between an agent that can
run your tests and one that can only claim to.

**What you learned:** there are two kinds of instruction. Advice goes in prompts
and `AGENTS.md`. Enforcement goes in hooks, and the VM honours them.

---

## Step 7: Give it an idea, get an app

This is where the previous six steps become a loop.

Open `ideas/TEMPLATE.md`. The important section is **Must have (v1)**: five
bullets or fewer. Everything else becomes a "non-goal", and non-goals are what
stop an unattended agent from building forever.

Here is the idea I used, in full:

> **Snippet Vault.** A local-first web app where a developer saves, tags, and
> instantly searches code snippets. Must have: create/edit/delete snippets with
> title, language, body, tags; full-text search as you type; copy button; data
> persists in SQLite; runs with one command, no accounts. Nice to have (later):
> syntax highlighting, gist import, keyboard navigation.

Run it:

```bash
npm run build-app -- --idea-file ideas/example-snippet-vault.md \
  --create-repo snippet-vault --max-iterations 8
```

What happens, in order:

1. `gh` creates a private repo with a README.
2. **Spec turn.** One Cloud Agent is created. It writes `SPEC.md` (user flows,
   non-goals, stack, quality bar) and `ROADMAP.md` (six milestones, each with
   checkable acceptance items). Mine chose TypeScript, Fastify, SQLite with
   FTS5, and Vitest, and listed eight decisions it made about ambiguities in my
   idea.
3. **Iterate turns.** Each turn is another `send()` to the *same* agent, and
   takes exactly one milestone: re-read the roadmap from disk, mark it in
   progress, build it, run the quality bar, tick the boxes, commit, report. Six
   turns, six milestones, zero stalls.
4. **Finish turn.** Fresh clone into `/tmp`, follow only the README, run
   everything, exercise all seven user flows. Report `complete: true`.

The driver script (`src/lib/build-loop.ts`) reads every JSON report and decides
when to stop. It stops for exactly these reasons:

| Exit | Reason | What you do |
| --- | --- | --- |
| 0 | complete | Review and merge the PR |
| 3 | blocked on a human (a secret, a paid service, a decision) | Do the thing, `--resume` |
| 4 | stalled, or iteration budget spent | `--resume`, maybe with more iterations |

State is saved to `.runs/build-<agentId>.json` after every turn, so closing your
laptop loses nothing. The Cloud Agent, its branch, and the PR are all still
there; the driver only needs the `bc-` id to pick up where it left off.

**My numbers:** 45 minutes, about $4.57, 19 tests, 7 verified user flows. The
result is public: [github.com/rvegajr/snippet-vault](https://github.com/rvegajr/snippet-vault).
Transcripts and cost live in
[docs/artifacts](https://github.com/rvegajr/snippet-vault/tree/main/docs/artifacts).
Download a zip of `main` from
[the v1.0.0 release](https://github.com/rvegajr/snippet-vault/releases/tag/v1.0.0).

---

## Step 8: The one thing the agent cannot do for you

Clone the result on your own machine and run it.

```bash
git clone https://github.com/rvegajr/snippet-vault && cd snippet-vault
npm install && npm run dev
```

Mine failed. The release gate had passed on the VM's Node version, but my laptop
runs Node 26, and the SQLite library the agent picked had no prebuilt binary for
it. The gate can only test the runtime it has.

Here is the part that made the whole exercise click. I did not fix it myself:

```bash
npm run resume -- --agent bc-ea005c5a-... --message \
  "Fresh clone fails npm install on Node 26: better-sqlite3@11 has no prebuilt binary. \
   better-sqlite3@13 works. Bump it, re-run the quality bar, push to the same branch."
```

Fifty-three seconds later the PR had a new commit, the types were updated, the
README said "Node 20–26", and the quality bar was green. I cloned again; it ran.
I merged.

That is the feedback arrow in the loop diagram. A Cloud Agent's conversation is
durable; `Agent.resume(id)` from any machine hands it a finding days later and
it fixes its own work with full context. The same id typed into
cursor.com/agents does the same thing.

---

## What you now understand

Every autonomous coding product is this loop with different choices about three
things:

- **Who owns the machine.** With Cursor Cloud Agents, Cursor does: an isolated
  VM per agent, provisioned on demand, gone when you are done. Other products
  make you host a daemon, or give you one persistent box.
- **What the artifact is.** Here, a branch and a PR on your repo. Elsewhere, a
  file, or a change made in a web app via computer use.
- **Where enforcement lives.** Here, hooks in the repo, which the VM runs. Elsewhere,
  gateway config or human approvals.

The parts that transfer everywhere are the ones you wrote yourself: a brief with
a checkable definition of done, a recording (or other evidence) the agent did
not invent, phase prompts with one job and one output contract each, and a
verify step that re-derives the truth from disk instead of trusting the previous
turn. For bugs, the recording is a jam.dev link. The Slack article is that input
wired to the same loop.

---

## After it ships: the same loop from Slack

`ARTICLE-SLACK.md` is the front door. You create a Slack app of your own from the
kit's manifest, run one Node process that holds a socket open to Slack, and
that process creates and resumes Cloud Agents exactly the way the scripts above
do. `@<bot>` is whatever your workspace names it; the bot reads that name at
startup. It is not Cursor's `@Cursor` app. That app also starts Cloud Agents,
directly from your sentence, with none of the triage, evidence, or verify gate
below. The mention is a small command line, not a free-form paragraph you hope
the bot interprets:

```
@<bot>                          usage (projects, this channel's default, examples)
@<bot> <project>                that project's repo, branch, and options
@<bot> <project> -              same
@<bot> <project> <request>      start a Cloud Agent on that repo
@<bot> <request>                start a Cloud Agent on this channel's project
@<bot> version                  which build of the bot is answering
```

Name the channel `#<project>-anything` (I use `#<project>-fixbot`; `#api-bugs`
works too) and the bot already knows which GitHub repo to clone. One process,
many repos, one Cloud Agent per request. `SLACK_PROJECTS` in `.env` is the
catalog; a bare mention prints it. Options on a real request: `branch=`,
`autopr=`, `model=`.

The hooks from step 6 are what that usage block means by `hooks: force-push, push
to develop/main, deploys, and --no-verify are blocked`. Advice in `AGENTS.md`.
Enforcement in `.cursor/hooks.json`. The Slack CLI just tells you they are there.

Notice what is *not* in that list: there is no deploy verb. The bot holds no
Vercel or Railway credential, so the only way to ship is to merge the PR, and the
platform posts the result into the same channel on its own. `ARTICLE-SLACK.md`
step 6½ is why an earlier version of this kit had a `deploy` command and why it
was taken out.

## Two mistakes to make early, on purpose

1. **Write a vague brief once.** Watch the agent confidently build the wrong
   thing. You will never skip the definition-of-done section again.
2. **Skip the fresh-clone check once.** You will learn that "verified" means
   "verified in the environment the verifier had."

Both cost a couple of dollars. Both are cheaper than learning them on a repo that
matters.

## Start here if you have 30 minutes

Steps 0, 1, 2, and 3. Login, local smoke, read the transcript, one read-only
Cloud Agent. That is enough to see the whole loop with your own eyes, in the
terminal and at cursor.com/agents at the same time. Do step 7 on a weekend
morning with coffee, and check on it when you are done with the coffee. When
you want the loop to start from a Slack message, name a channel
`#<project>-anything`, copy `target-repo-kit/` into that repo, and follow
`ARTICLE-SLACK.md`; a bare mention of your bot prints the rest.
