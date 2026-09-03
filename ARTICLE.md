# I Gave an AI Agent a One-Page Idea and It Shipped a Working App While I Watched

## A step-by-step guide to building software autonomously in the cloud, using nothing but a terminal and about $4 of tokens

Last night I typed one command, walked away for 45 minutes, and came back to a
working web app with 19 passing tests, a README, and a pull request. The agent
picked the stack, wrote the spec, built it in six milestones, verified each one,
and told me what it deliberately left out.

This is not a demo of a product. It is a pattern you can run yourself, and once
you see how few moving parts there are, every "autonomous agent" product on the
market (Grok Bot, Cursor Cloud Agents, OpenClaw, Devin) becomes easy to reason
about, because they all run the same loop.

This article walks through that loop one step at a time. Each step is a single
command. Total time if you do everything: about two hours. Total cost: under $10.

---

## The loop, in one picture

```
idea/brief  →  prompt  →  agent on a cloud VM  →  verify  →  pull request  →  feedback
    ↑                                                                             |
    └─────────────────────────────────────────────────────────────────────────────┘
```

Every step below adds one piece of this picture. By step 7 you will have built
the whole thing.

## What you need

- A Mac, Linux, or Windows machine with Node.js 22 or newer
- A GitHub account
- A Cursor account on any paid plan (the cloud runs need one)
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
paste it anywhere.

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

Now open `src/01-local-smoke.ts`. It is 30 lines. The part that matters:

```typescript
const result = await Agent.prompt(prompt, {
  apiKey,
  model: { id: "composer-2.5" },
  local: { cwd: process.cwd() },
});
```

That is the entire API for a one-shot agent run: a prompt, a model, and where to
run. Everything in the next six steps is this call with more structure around it.

**What you learned:** if this works, auth and model access work. Every later
failure is about repos, prompts, or the loop, never the SDK.

---

## Step 2: Look at a run that already happened

The kit ships with the full transcript of the app I built. Before spending money,
read what a real run looks like:

```bash
less .runs/build-live.log
```

Scroll slowly. You will see:

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

## Step 3: Your first cloud run, read-only

Now the same thing, but on a VM in the cloud against a real repo. Pick any
repository you own that is connected to Cursor (go to cursor.com/agents and
connect GitHub if you have not). Check what is connected:

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
edited nothing. Cost: well under a dollar.

Now open two files side by side: `prompts/01-plan.md` (what the agent was told)
and `src/03-cloud-pipeline.ts` (how it was sent). Match what you saw in the
stream to those files. The only difference from step 1 is this:

```typescript
cloud: {
  repos: [{ url: repo, startingRef: "main" }],
  autoCreatePR: true,
}
```

Swap `local` for `cloud` and you get a fresh machine, a branch, and a PR.

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
| Context | Where the code lives, so the agent does not spend 20 minutes guessing |
| Scope: in / out | Prevents drive-by refactors and new dependencies |
| Definition of done | Each item checkable by a command |
| Verification | The exact commands that must exit 0 |
| Constraints | Anything you would be angry about |

Copy it to `briefs/my-first-change.md` and fill it in for something small and
real in one of your repos. Then:

```bash
npm run cloud -- --brief my-first-change --repo https://github.com/you/some-repo
```

Review the PR. Something will be slightly off. That is not a failure; that is the
brief telling you what it was missing. Fix the brief, not the code, and run it
again. This feedback cycle is the actual skill. After three or four briefs you
will write them right the first time.

**What you learned:** the brief is the biggest lever on quality. A vague brief
produces a confident wrong answer. A brief with a command-checkable definition
of done produces a PR you can merge.

---

## Step 6: Put the guardrails in the repo, not the prompt

Prompts are advice. The agent usually follows them. "Usually" is not good enough
for `git push --force`.

The kit has a folder called `target-repo-kit/`. Copy its contents into the root
of any repo you point agents at:

```
your-repo/
  AGENTS.md                            ← how to build, test, what never to touch
  .cursor/rules/autonomous-agent.mdc   ← working style for unattended runs
  .cursor/hooks.json                   ← runs a script before every shell command
  .cursor/hooks/guard-shell.mjs        ← denies force-push, push to main, deploys
```

The hook runs inside the VM before every shell command and can say no regardless
of what the model decided. Try it locally:

```bash
echo '{"command":"git push --force origin x"}' | node .cursor/hooks/guard-shell.mjs
# {"permission":"deny","user_message":"Blocked: force-push is never allowed for agents"}
```

Fill in `AGENTS.md` with your real commands and conventions. Commit. Every agent
that touches this repo now reads it first.

**What you learned:** there are two kinds of instruction. Advice goes in prompts.
Enforcement goes in hooks.

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
2. **Spec turn.** The agent writes `SPEC.md` (user flows, non-goals, stack,
   quality bar) and `ROADMAP.md` (six milestones, each with checkable acceptance
   items). Mine chose TypeScript, Fastify, SQLite with FTS5, and Vitest, and
   listed eight decisions it made about ambiguities in my idea.
3. **Iterate turns.** Each turn takes exactly one milestone: re-read the roadmap
   from disk, mark it in progress, build it, run the quality bar, tick the boxes,
   commit, report. Six turns, six milestones, zero stalls.
4. **Finish turn.** Fresh clone into `/tmp`, follow only the README, run
   everything, exercise all seven user flows. Report `complete: true`.

The driver script reads every JSON report and decides when to stop. It stops for
exactly these reasons:

| Exit | Reason | What you do |
| --- | --- | --- |
| 0 | complete | Review and merge the PR |
| 3 | blocked on a human (a secret, a paid service, a decision) | Do the thing, `--resume` |
| 4 | stalled, or iteration budget spent | `--resume`, maybe with more iterations |

State is saved after every turn, so closing your laptop loses nothing. The cloud
agent, its branch, and the PR are all still there.

**My numbers:** 45 minutes, about $4, 19 tests, 7 verified user flows.

---

## Step 8: The one thing the agent cannot do for you

Clone the result on your own machine and run it.

```bash
git clone https://github.com/you/snippet-vault && cd snippet-vault
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

That is the feedback arrow in the loop diagram. The agent's conversation is
durable; you can hand it a finding days later and it fixes its own work with full
context.

---

## What you now understand

Every autonomous coding product is this loop with different choices about three
things:

- **Who owns the machine.** Cursor Cloud Agents: they do, ephemeral VM per run.
  OpenClaw: you do, a daemon you host. Grok Bot: they do, one persistent machine
  per user.
- **What the artifact is.** A PR, a file, a change made in a web app via
  computer use.
- **Where enforcement lives.** Repo hooks, gateway config, or human approvals.

The parts that transfer everywhere are the ones you wrote yourself: a brief with
a checkable definition of done, phase prompts with one job and one output
contract each, and a verify step that re-derives the truth from disk instead of
trusting the previous turn.

## Two mistakes to make early, on purpose

1. **Write a vague brief once.** Watch the agent confidently build the wrong
   thing. You will never skip the definition-of-done section again.
2. **Skip the fresh-clone check once.** You will learn that "verified" means
   "verified in the environment the verifier had."

Both cost a couple of dollars. Both are cheaper than learning them on a repo that
matters.

## Start here if you have 30 minutes

Steps 0, 1, 2, and 3. Login, local smoke, read the transcript, one read-only
cloud run. That is enough to see the whole loop with your own eyes. Do step 7 on
a weekend morning with coffee, and check on it when you are done with the coffee.
