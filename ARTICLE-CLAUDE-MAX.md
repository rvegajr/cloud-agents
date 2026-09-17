# I Paid Anthropic $5,300 in Six Months While Holding a $200 Max Plan. Here Is How the Agent Loop Moves Onto the Plan I Already Own

## A step-by-step guide to running the cloud-agents build loop on Claude Code under a Max subscription: which credentials are flat-rate and which meter, why LiteLLM is the wrong tool for this, what Anthropic's policy actually permits, and the one seam in this repo where the engine swaps

The first two articles built an autonomous loop (brief → plan → implement →
verify → PR) and gave it a Slack front door. Both ran on Cursor Cloud Agents,
which bill per token. That was fine while I was learning. It stopped being fine
when I read six months of receipts.

I hold a Claude Max 20x plan, $200 a month, and I assumed that meant "my Claude
usage is $200 a month." It did not. Between March 14 and September 9, 2026,
Anthropic charged me **$5,326.74**. The plan was $1,279 of that. The other
$4,047 was per-token billing I never decided to buy, arriving in two streams
that look identical on a card statement:

| Stream | Total | What it was | How it shows on the statement |
| --- | --- | --- | --- |
| Max plan renewals | $1,279.20 | Six months of Max 20x | $213.20 on the 14th, every month |
| API credit auto-recharges | $2,501.74 | Twelve top-ups of ~$195 on the Console (API key) account | $207.87–$210.23, odd cents, card ending 2004 |
| Extra usage on Max | $1,545.80 | Claude Code overage past the 20x cap, bought in blocks | $213.20 on days that are not the 14th; $27–$39 auto top-ups; one $746.20 |

Eleven of the twelve API recharges landed between April 6 and July 1, one every
five to ten days, which is about $25 a day of API consumption. The extra-usage
stream spent $1,119 in five days in August. Neither stream was a product I run.
Both were me, using agents, on the wrong credential.

This article is what I did about it. The short version: the Max plan does
cover the Agent SDK and headless Claude Code today; it does not cover anything
that speaks the raw Messages API, which means it does not cover LiteLLM, and it
does not cover the API key that was sitting in my shell profile. The build loop
in this repo has one seam where the engine plugs in. Moving that seam from
`@cursor/sdk` to `@anthropic-ai/claude-agent-sdk`, authenticated with a Max
token and nothing else, is the whole project.

```
today
  06-build-app.ts ── @cursor/sdk ──► Cursor Cloud Agent VM ──► PR        Cursor tokens
  laptop terminal ── claude (ANTHROPIC_API_KEY set) ──► API credits      $25/day, unnoticed

after
  06-build-app.ts ── engine-claude.ts ── Agent SDK ──► clone on a box ──► PR   Max limits, $0 marginal
  laptop terminal ── claude (no key in env) ─────────────────────────────►     Max limits
  products (earl, scholaracle, vivaflow) ── LiteLLM ── API keys ────────►     API, as intended, ~$2/month
```

---

## Step 0: Seven things with similar names, and which ones meter

Every dollar above traces back to confusing two of these.

**Max plan.** A subscription on claude.ai. Flat $200 a month for the 20x tier.
Authenticated by OAuth: `claude auth login` in the terminal, or a long-lived
token from `claude setup-token`. Usage is capped by a rolling weekly limit, not
a dollar amount. When you hit the cap you wait, unless you have turned on the
next thing.

**Extra usage (usage credits).** An opt-in on the Max account: when the cap is
hit, keep going and pay API rates for the overage. It can auto-recharge. This is
the $1,545.80 stream. It is a feature, and it was on.

**Console API key.** A `sk-ant-api03` key from platform.claude.com. Pure
pay-as-you-go, billed to a credit balance that auto-recharges when it runs low.
This is the $2,501.74 stream. A Max plan does nothing for an API key, and an
API key does nothing for a Max plan; they are two accounts that happen to share
a login.

**Claude Code, interactive.** The terminal and IDE tool. Uses whichever
credential it finds. If `ANTHROPIC_API_KEY` is set in the environment, it uses
that and bills the API, even when you are logged in to Max. `claude auth status`
tells you which one won.

**Agent SDK and `claude -p`.** The programmatic and headless forms of Claude
Code. Same harness, same credential rules. As of the June 15, 2026 help-center
notice, they "still draw from your subscription's usage limits." This is the
fact the whole article rests on, and it is the one most likely to change; the
planned split to a separate $200/month credit at API rates was announced,
paused on launch day, and is "being updated."

**Managed Agents.** Anthropic's hosted agent runtime (Sessions, Environments,
credential vaults, memory stores in the Console sidebar). API-key billed, plus
$0.08 per running session-hour. It is the closest thing Anthropic sells to a
Cursor Cloud Agent, and it cannot use Max.

**LiteLLM.** An OpenAI-compatible proxy that forwards requests to providers
using API keys, with budgets and logging on top. It speaks the Messages API,
which is exactly the surface a Max plan does not expose. More in Step 2.

The rule that falls out: **Max pays for Claude Code and the Agent SDK, when you
are the user, and nothing else.** Anything that needs a URL and a key is API.

---

## Step 1: Stop the bleeding before writing code

None of this needs the repo. All of it needs to happen first, because the
engine swap in Step 4 is worthless if the API key is still winning the
credential race.

**1a. Find out who is paying for your terminal.**

```bash
claude auth status
```

Mine said `apiKeySource: ANTHROPIC_API_KEY` under a `loggedIn: true` Max
account. Line 8 of `~/.zshrc` exported the key for a LiteLLM experiment months
ago and every Claude Code session since had billed the API. Remove the export,
open a new shell, run it again; you want `apiKeySource: none`. If a project
genuinely needs the key (a LiteLLM instance, a script), put it in that
project's `.env`, never the global profile.

**1b. Turn off the two auto-recharges.**

On platform.claude.com, Manage → Billing: disable credit auto-reload, or set a
monthly spend limit well under the $195 top-up size. On claude.ai, Settings →
Usage: set the extra-usage budget to zero, so passing the cap requires a
deliberate purchase and not a background charge. Both defaults are "keep
buying"; you want "stop and tell me."

**1c. Audit the key list.** Console → API keys, Workspace filter set to All.
Every key has a cost badge. Mine showed nine product keys under a dollar each
and one, made for a browser extension in October, at $175 for the month; that
key had been idle for a month and then pushed nine million tokens in a single
day, at which point Anthropic disabled it for suspected exposure. Delete
anything you do not recognise, and never paste a Console key into a third-party
tool that "brings your own key." That is Sider, Cursor's BYOK field, LiteLLM
clients, all of them: each is a place a key can leak, and each bills the API
account with no cap.

**1d. Read Usage grouped by API key.** Console → Usage, Range: last 6 months,
Group by: API key. The bar that matches your recharge dates is the culprit for
the historical spend. In my case the Apr–Jun run maps to the laptop key, not a
product.

After 1a–1d the API stream should go to the few dollars a month the products
actually use, and the extra-usage stream cannot restart without you clicking.
That alone is most of the saving. The rest of the article is about doing more
work inside the plan you kept.

---

## Step 2: The LiteLLM question, answered

I run a LiteLLM instance (`llm.noctusoft.com`) that fronts several products.
The obvious idea was: point Claude Code at LiteLLM, or point LiteLLM at Max, and
let the proxy meter and route. Neither direction saves money, and one of them
is against the terms.

**Direction one: Claude Code → LiteLLM → Anthropic with an API key.** This is
what `ANTHROPIC_BASE_URL=https://llm.noctusoft.com` does. LiteLLM authenticates
upstream with a Console API key in its config. Every token bills the API
account. You have taken the flat-rate tool and routed it through the metered
door. This is a strictly worse version of the `.zshrc` mistake, with a proxy
in the middle.

**Direction two: Claude Code → LiteLLM → Anthropic forwarding the Max OAuth
bearer.** LiteLLM documents this (`forward_llm_provider_auth_headers: true`;
the proxy pins an OAuth bearer to the Anthropic provider and forwards
it). It works mechanically. Three reasons not to:

1. It buys nothing. Max is not per-token, so LiteLLM's budgets, spend logs and
   per-key limits meter a number nobody is billed for. The routing feature
   (fall back to DeepSeek when Anthropic is slow) is real, but the fallback
   models bill API keys, which is the thing being avoided.
2. It is the pattern Anthropic enforces against. The legal-and-compliance page
   says OAuth "is designed to support ordinary use of Claude Code and other
   native Anthropic applications" and that developers "may not collect, store,
   or intermediate Claude.ai credentials or session tokens." On January 9, 2026
   Anthropic cut off third-party clients (OpenCode, Cline, Roo, Goose) using
   subscription tokens server-side, without notice, while the subscriptions
   kept billing. A proxy that holds and forwards your bearer is an intermediary
   by construction. Mine, on my box, for me, is a gray zone; it is not a zone I
   want a $200/month account living in.
3. Header leakage. With `forward_client_headers_to_llm_api` on, a client that
   sends `x-api-key` overrides the configured upstream key for whatever
   deployment the request routes to. One misconfigured client and your
   Anthropic key goes to a different provider.

**What LiteLLM is for, in this setup:** the products. earl, scholaracle,
vivaflow and the rest are applications serving other people; they must use API
keys under the policy anyway, and they cost about two dollars a month combined.
Keep them on LiteLLM, keep LiteLLM on API keys, set a budget per key there, and
keep Max entirely out of it. The agent loop never touches the proxy.

---

## Step 3: What the policy permits, in the words that matter

Two Anthropic pages govern this. Read them yourself before building; they
changed three times this year.

From code.claude.com/docs/en/legal-and-compliance, fetched September 10:

> Advertised usage limits for Pro and Max plans assume ordinary, individual
> usage of Claude Code and the Agent SDK.

> OAuth authentication is intended exclusively for purchasers of Claude Free,
> Pro, Max, Team, and Enterprise subscription plans and is designed to support
> ordinary use of Claude Code and other native Anthropic applications.

> Developers building products or services that interact with Claude's
> capabilities, including those using the Agent SDK, should use API key
> authentication … Anthropic does not permit third-party developers to offer
> Claude.ai login into their own applications, or to route requests through
> Free, Pro, or Max plan credentials on behalf of their users.

From support.claude.com article 15036540, the June 15 update:

> For now, nothing has changed: Claude Agent SDK, `claude -p`, and third-party
> app usage still draw from your subscription's usage limits.

Put together:

- **Allowed:** me, running the Agent SDK or `claude -p` against my own repos,
  authenticated with my own Max token, drawing from my own weekly limit. The
  first quote names the Agent SDK as something the limits are sized for. The
  GitHub Actions docs go further and document `CLAUDE_CODE_OAUTH_TOKEN` from
  `claude setup-token` as the supported way to authenticate a CI runner on Pro
  and Max.
- **Not allowed:** running that agent for other people on my credential. The
  moment a teammate mentions the Slack bot and my token does the work, I am
  routing "on behalf of their users." That is the line the Slack bot has to
  respect (Step 8), and it is why the build loop, which only I drive, is the
  right thing to move first.
- **Not allowed:** anything that stores or forwards the OAuth token through a
  service. See Step 2.
- **Fragile:** the "still draw from your subscription" sentence. Anthropic's
  paused plan would have moved SDK usage to a $200/month credit at API rates,
  with Max 20x users getting exactly that credit. Treat $200 of API-equivalent
  per month as the budget they believe you bought, log your API-equivalent
  spend per build (Step 7), and keep the engine behind an environment switch
  so a policy change is a redeploy, not a rewrite.

---

## Step 4: The seam, and the ~150 lines that fill it

The first article promised this: "swap the SDK calls for a different engine
and the Slack layer would not know." Two types are that promise.

```ts
// src/lib/build-loop.ts
export type SendFn = (prompt: string, opts?: { mode?: "agent" | "plan" }) => Promise<TurnResult>;

// src/lib/slack-fix.ts
export interface JobRuntime {
  create: (args: { repo: string; ref: string; autoCreatePR?: boolean; model?: string }) => Promise<AgentHandle>;
  resume: (agentId: string) => Promise<AgentHandle>;
  post: (text: string) => Promise<void>;
  markPrReady?: (prUrl: string) => Promise<"marked" | "already-ready">;
}
```

`runBuildLoop` and `runPipeline` only ever call `send`. They do not import
`@cursor/sdk`. The engine is whatever produces a `send`. Today `06-build-app.ts`
produces one from `Agent.create` and `run.wait()`. The Claude engine produces
one from `query()`.

The Cursor Cloud Agent gave three things for free that the new engine has to
supply: a machine with the repo cloned, a durable id to resume, and a PR at the
end. Each is small.

```ts
// src/lib/engine-claude.ts  (sketch; the shape, not the final file)
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import type { SendFn, TurnResult } from "./build-loop.js";

export class MaxExhausted extends Error {
  constructor(public resetsAt?: number) {
    super("Max plan usage exhausted; not buying extra usage. Resume after reset or use --engine cursor.");
  }
}

/** The only environment the agent subprocess sees. No Slack, GitHub, Jam, Railway, or API keys. */
function scrubbedEnv(): Record<string, string | undefined> {
  const { PATH, HOME, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CONFIG_DIR } = process.env;
  return { PATH, HOME, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CONFIG_DIR };
}

export function cloneWorkspace(repo: string, ref: string, root = process.env.WORK_ROOT ?? "/tmp"): string {
  const dir = mkdtempSync(join(root, "build-"));
  execFileSync("git", ["clone", "--branch", ref, "--depth", "50", repo, dir], { stdio: "inherit" });
  return dir;
}

export function makeClaudeSend(opts: {
  cwd: string;
  model?: string;
  sessionId?: string;
  onSession?: (id: string) => void;
  onCost?: (usd: number) => void;
}): SendFn {
  let sessionId = opts.sessionId;
  return async (prompt, o): Promise<TurnResult> => {
    let result: string | undefined;
    let status: TurnResult["status"] = "error";
    for await (const m of query({
      prompt,
      options: {
        cwd: opts.cwd,
        resume: sessionId,
        model: opts.model ?? "sonnet",
        permissionMode: o?.mode === "plan" ? "plan" : "acceptEdits",
        allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash(git *)", "Bash(npm test*)", "Bash(npm run *)"],
        settingSources: ["project"],   // the target repo's .claude/settings.json hooks and deny rules
        maxTurns: 80,
        maxBudgetUsd: 20,              // client-side API-equivalent estimate; a tripwire, not a bill
        env: scrubbedEnv(),
      },
    })) {
      if (m.type === "system" && m.subtype === "init") {
        sessionId = m.session_id;
        opts.onSession?.(sessionId);
        if (m.apiKeySource !== "none") throw new Error(`refusing to run: apiKeySource=${m.apiKeySource}, this would bill the API`);
      }
      if (m.type === "rate_limit_event" && m.rate_limit_info.errorCode === "credits_required") {
        throw new MaxExhausted(m.rate_limit_info.resetsAt);
      }
      if (m.type === "result") {
        status = m.subtype === "success" ? "finished" : "error";
        result = m.subtype === "success" ? m.result : undefined;
        opts.onCost?.(m.total_cost_usd);
      }
    }
    return { status, result, runId: sessionId };
  };
}

/** The bot, not Claude, pushes and opens the PR. Claude never holds a GitHub credential. */
export function pushAndOpenPr(cwd: string, branch: string, title: string): string {
  execFileSync("git", ["push", "-u", "origin", branch], { cwd, stdio: "inherit" });
  return execFileSync("gh", ["pr", "create", "--draft", "--fill", "--title", title], { cwd, encoding: "utf8" }).trim();
}
```

Four details in that sketch are the article.

**The `apiKeySource` assertion.** The init message reports where the credential
came from. Anything other than `none` means an API key won the race and the run
will bill it. The engine refuses. This is the `.zshrc` lesson made structural.

**`credits_required` is a stop, not a purchase.** When the Max cap is hit, the
SDK emits a `rate_limit_event` with `errorCode: "credits_required"` and, if
extra usage is on, the session can continue by buying it. The engine throws
instead. The August receipts are what happens when this decision is left to a
default.

**`env` replaces the subprocess environment.** The SDK documents that a passed
`env` replaces rather than merges. That is the feature: the agent process sees
a token that can only make model requests, `PATH`, `HOME`, and nothing else.
On a Cursor Cloud Agent this isolation came from the VM. Here it comes from
four lines.

**`total_cost_usd` is a savings meter.** It is Anthropic's client-side estimate
of what the turn would have cost at API list price. Under Max the charge is
zero; the number is what you did not pay. Log it per turn into
`.runs/build-*.json` and you have the A/B against Cursor's `chargedCents` for
free.

---

## Step 5: Where it runs

The Cursor VM is gone, so something has to hold the clone. Three options, in
the order I would try them.

**Your laptop.** `npm run build-app -- --engine claude …` with the loop's state
file on disk. Zero setup. Dies when the lid closes, which the state file and
`--resume` already handle. Fine for the first three builds.

**An always-on box you own.** I have a developer VM on Azure. `tmux new -s
build`, run the loop inside it, detach. `claude setup-token` on that box once
gives a long-lived `CLAUDE_CODE_OAUTH_TOKEN`; put it in the box's `.env`, not
the shell profile. Sessions live under `~/.claude` so `resume` works across
reconnects. This is where I run it.

**Railway, next to the Slack bot.** Same container, needs three things the bot
image does not have today: git and the target repos' toolchains (a small
`Dockerfile` replacing the Railpack default; `railway.json` already shows the
pattern with the Jam CLI install), a volume mounted at `/data` with
`CLAUDE_CONFIG_DIR=/data/claude` and `WORK_ROOT=/data/work` so a redeploy does
not wipe sessions and clones, and `CLAUDE_CODE_OAUTH_TOKEN` as a service
variable. Do this only when Step 8 says so.

Whichever box: `npm run doctor` should grow a phase that runs `claude auth
status` and fails if `apiKeySource` is anything but `none`, and asserts that
`ANTHROPIC_API_KEY` is absent from the process environment. The two most
expensive mistakes in this story were both environment variables.

---

## Step 6: Port `06-build-app.ts` first, not the Slack bot

The build loop is the thing that generates applications, which is the point of
the kit; it has no UI to lose, because nobody types into it; and its `SendFn`
is already engine-agnostic. The diff is an `--engine` flag and a second way to
make `send`:

```ts
// src/06-build-app.ts, the shape of the change
const engine = args.engine ?? env("ENGINE", "cursor");

let send: SendFn;
let handle: string;             // bc-… for Cursor, cc-<session_id> for Claude
if (engine === "claude") {
  const cwd = record?.workspace ?? cloneWorkspace(repo, ref);
  send = makeClaudeSend({
    cwd,
    model: env("CLAUDE_MODEL", "sonnet"),
    sessionId: record?.sessionId,
    onSession: (id) => { record.sessionId = id; record.agentId = `cc-${id}`; save(record); },
    onCost: (usd) => { record.apiEquivalentUsd = (record.apiEquivalentUsd ?? 0) + usd; save(record); },
  });
} else {
  const agent = record ? await Agent.resume(record.agentId, { apiKey }) : await Agent.create({ … });
  send = cursorSend(agent);      // the existing eight lines
}
const final = await runBuildLoop(send, { …unchanged… }, record.state);
```

The state file gains `engine`, `workspace`, `sessionId`, and `apiEquivalentUsd`.
Resume works the same way from the outside: `--resume cc-…` reads the record,
checks out the workspace (or re-clones the branch if the directory is gone,
which is why the branch on GitHub is the real durable handle), and passes
`sessionId` to `resume`. If the session has been cleaned up, the loop still
works: every prompt in `prompts/app/` carries the spec and the history, which
is what made the Cursor version resumable in the first place.

Then run the experiment that decides everything:

```bash
npm run build-app -- --engine cursor --idea-file ideas/example-snippet-vault.md --create-repo sv-cursor
npm run build-app -- --engine claude --idea-file ideas/example-snippet-vault.md --create-repo sv-claude
```

Same idea, same prompts, same finish gate. Compare iterations to complete,
`chargedCents` against `apiEquivalentUsd`, and how much of the weekly Max bar
one app consumed. That last number is the one that matters.

We ran this on 17 September 2026. Both engines finished `complete` in six
iterations. Cursor (composer-2.5, Fast off) charged **$1.20** in 13.5 minutes.
Claude Max (Sonnet) logged **$6.65** API-equivalent in 16.2 minutes and added
nothing to a card. The write-up, PRs, stacks, and the reasons Slack still
stays on Cursor are [ARTICLE-CLAUDE-MAX-RESULTS.md](ARTICLE-CLAUDE-MAX-RESULTS.md).

---

## Step 7: The budget you actually have

Under Cursor the constraint was dollars. Under Max it is the weekly cap, shared
between the loop and your own interactive Claude Code. Rules that follow:

**Sonnet by default, Opus by exception.** The kit's Cursor default is
composer-2.5, which is cheap; the Claude equivalent for "most of the loop" is
Sonnet. Reserve Opus for the spec phase if the first builds show it is needed.
Fable and Opus burn the weekly bar several times faster for the same milestone.

**One account, one cap; parallel builds buy nothing.** Two loops at once finish
in the same wall time as two in sequence, because they drain the same bar.
`SLACK_MAX_CONCURRENT` becomes a cap-protection setting, not a VM-count
setting. Leave it at 1 for the build loop.

**Treat $200/month of API-equivalent as the allowance.** That is what Anthropic
priced the paused Agent SDK credit at for Max 20x. The `apiEquivalentUsd` field
tells you where you stand. A snippet-vault-sized app on Sonnet should be $20–40
API-equivalent; on Opus, more like $150. So Max buys five to ten small apps a
month, or one large one, for zero marginal dollars. Beyond that you are back
to the earlier decision: Cursor composer (cheap, metered, keeps its UI) or
wait for the reset.

**On a cap hit, fail loudly.** `MaxExhausted` carries `resetsAt`. Print it,
print `npm run build-app -- --resume cc-… --engine cursor`, exit 4. Never
convert a cap hit into an extra-usage purchase or a silent fall-through to
`ANTHROPIC_API_KEY`. If you ever want an API fallback, make it an explicit
`CLAUDE_FALLBACK_API_KEY` that the doctor warns about while set.

**Watch the help-center article.** support.claude.com/en/articles/15036540 is
where the "still draws from your subscription" sentence lives. When it
changes, `ENGINE=cursor` is one variable away.

---

## Step 8: The Slack bot last, and the trap in it

Everything above ports to the fix-bot too. `JobRuntime.create` becomes clone
plus `makeClaudeSend`; `resume` reads `cc-<session_id>` from the thread instead
of `bc-…` (`AGENT_ID_RE` in `slack-thread.ts` grows one alternative); the bot
pushes the branch and opens the draft PR with its existing `GITHUB_TOKEN`;
`markPrReady` is unchanged. The triage prompt drops its `create_plan` nudge,
which was Cursor-specific. One to two days including the first live run.

But read Step 3 again before doing it. The moment anyone other than you can
mention the bot, your Max token is doing work on their behalf, which is the
thing Anthropic names as not permitted. Three honest positions:

1. **Solo.** `SLACK_ALLOWED_CHANNELS` limited to channels only you post in.
   `ENGINE=claude`. Inside the policy.
2. **Team, cheap UI.** Leave the fix-bot on Cursor. The Slack pipeline was
   never where the money went; the one measured run was $0.49. Fix the
   credentials, move the build loop, keep the bot as it is.
3. **Team, Claude.** `CLAUDE_AUTH=api-key` for the bot, with a Console key
   that has a spend limit, or a Team plan. Metered, but capped and compliant.

Position 2 is what I did. The Cursor UI at cursor.com/agents is also the one
thing the Claude engine cannot give back, and the fix-bot is where I actually
look at transcripts.

---

## What you now understand

- A Max plan is a flat-rate credential for two clients: Claude Code and the
  Agent SDK, used by you. Everything with a base URL and a key is API and
  meters, including LiteLLM, Managed Agents, browser extensions with a BYOK
  field, and your own terminal if a key is exported in its environment.
- The two per-token streams on a Max account, Console credits and extra usage,
  both default to auto-recharge. Turn both off. The receipts in this article
  are what the defaults cost.
- The SDK tells you, on the first message of every session, which credential
  it is about to bill. Assert on it.
- The Cursor VM was three things: a clone, an id, a PR. Each is a few lines
  when you own the box.
- The constraint moves from dollars to the weekly cap. Log API-equivalent cost
  anyway; it is how you know how many apps a month the plan buys, and it is
  the A/B against Cursor.
- The policy permits you running your own agent on your own plan and forbids
  running it for others. Build the solo path first; it is also the one that
  generates applications.

## Two mistakes to make early, on purpose

**Run one build with `ANTHROPIC_API_KEY` still exported** and watch the
`apiKeySource` assertion refuse. Then you trust it.

**Hit the cap once with extra usage turned off** and read the
`credits_required` event. Then you know what August would have looked like
with the guard in place.

## Start here if you have 30 minutes

1. `claude auth status`. If `apiKeySource` is not `none`, fix the shell profile
   and re-check. Five minutes, and probably the largest single saving.
2. Console → Manage → Billing: disable auto-reload. claude.ai → Settings →
   Usage: extra-usage budget to zero. Two minutes.
3. Console → API keys, Workspace: All. Delete keys you do not recognise. Note
   any key with a cost badge over a dollar and find what holds it. Ten minutes.
4. `npm run build-app -- --engine claude --idea-file ideas/example-snippet-vault.md --create-repo sv-claude`
   (and the Cursor twin with `--engine cursor`). The rest of the half hour, plus
   the builds.

The measured A/B from that step is [ARTICLE-CLAUDE-MAX-RESULTS.md](ARTICLE-CLAUDE-MAX-RESULTS.md).
