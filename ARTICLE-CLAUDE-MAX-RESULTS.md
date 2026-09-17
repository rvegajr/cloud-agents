# I Ran the Same Idea on Cursor and on Claude Max. Both Apps Shipped. Only One Added a Line to a Bill

## The snippet-vault A/B promised in ARTICLE-CLAUDE-MAX.md, measured 17 September 2026: wall time, charged cents, API-equivalent dollars, stacks, and what that means for the Slack bot

The previous article moved the build loop onto a Max credential and left one
experiment unrun: the same `ideas/example-snippet-vault.md`, the same prompts,
the same finish gate, once on a Cursor Cloud Agent and once on the Anthropic
Agent SDK authenticated as Max.

That run is done. Both engines stopped with `complete`. Six milestones, six
iterations, zero stalls, zero blocks. The numbers are smaller, and in one
respect more interesting, than the sketch predicted.

```
npm run build-app -- --engine cursor --idea-file ideas/example-snippet-vault.md \
  --repo https://github.com/rvegajr/sv-cursor --ref main

npm run build-app -- --engine claude --idea-file ideas/example-snippet-vault.md \
  --repo https://github.com/rvegajr/sv-claude --ref main
```

| | Cursor composer-2.5, Fast off | Claude Max, Sonnet |
| --- | --- | --- |
| Stop reason | `complete` | `complete` |
| Milestones / iterations | 6 / 6 | 6 / 6 |
| Wall time | 13.5 min | 16.2 min |
| Money | **$1.20 charged** (`chargedCents` 120.25) | **$6.65 API-equivalent** on Max (`apiEquivalentUsd` 6.65) |
| Tokens (Cursor) | 5,281,013 | n/a (Max cap, not a token bill) |
| Agent id | `bc-4936ea78-66a8-4132-8b92-107545605e90` | `cc-55f6ec96-b241-4d43-8908-784a77a1a5f3` |
| PR | [sv-cursor #1](https://github.com/rvegajr/sv-cursor/pull/1) (ready) | [sv-claude #1](https://github.com/rvegajr/sv-claude/pull/1) (draft) |
| Diff | +7,012 / −33, 39 files | +3,793 / −1, 22 files |
| Tests (engine's own count) | Vitest + Supertest; finish gate green | 19 passing `node:test` |
| Storage | `better-sqlite3@13` | `node:sqlite` (built-in) |
| UI | server-rendered HTML + EJS | vanilla JS, no bundler |

The first public snippet-vault, on Cursor with the product default still Fast,
was about **45 minutes and $4.57**. This Cursor rerun is the same idea with
Fast pinned off in `selectModel()`. Four times cheaper, three times faster. The
Claude run is slower in API-equivalent dollars and slightly slower on the
clock, and it added **nothing** to a card statement because Max was paying.

---

## What we were trying to learn

Three questions, from [ARTICLE-CLAUDE-MAX.md](ARTICLE-CLAUDE-MAX.md) step 6:

1. Does the Claude engine actually finish the loop, or does it stall where a
   Cursor VM would not?
2. What does one snippet-vault-sized app cost in **API-equivalent** dollars
   under Sonnet, which is how you know how many apps a Max week buys?
3. Is that cheap enough to move the Slack bot too?

Answers, in order: it finished; **$6.65**, which is well under the $20–40 the
article guessed; **no**, not the Slack bot.

---

## Reading the money without mixing the units

Do not put $1.20 and $6.65 on the same axis and pick a winner.

**Cursor $1.20** is a metered bill. `Agent.getUsage` reported 120.25 charged
cents on `composer-2.5` with `fast=false`. That is the number that would have
shown up on a Cursor invoice. Fast-off is doing the work the first article's
$4.57 run did not: Cursor's product default for Composer is Fast, about 6×.

**Claude $6.65** is the SDK's `total_cost_usd` summed across turns, the
API-rate equivalent of the tokens Max covered. Nothing was purchased. The
constraint is the weekly cap shared with interactive Claude Code, not a
dollar field. If the cap had been hit, the engine would have thrown
`MaxExhausted` and refused extra usage. It did not hit the cap.

So: for this size of app, **Cursor is the cheaper metered path**, and **Claude
Max is the zero-marginal-dollar path**, as long as the week still has room.
The $5,326 Anthropic receipts were not this loop. They were an API key in a
shell profile and extra usage left on. This A/B does not undo that diagnosis.
It shows what the loop costs once the credential is right.

At $6.65 API-equivalent per snippet-vault-sized app, a Max 20x week that
behaves like the paused "$200 of API-equivalent" number would buy on the
order of **thirty** of these, not the five-to-ten the sketch feared. One data
point. The next app that wants Opus will move that.

---

## What the two apps actually are

Same idea file. Different specs, because spec is a model turn.

**Cursor** wrote TypeScript, Express 5, EJS, Vitest, esbuild, and
`better-sqlite3@13`. The original public vault had failed a laptop clone on
`better-sqlite3@11` under Node 26; `@13` is the bump that resume already
taught. The finish gate cloned into `/tmp`, ran lint / typecheck / test /
build, and exercised all six SPEC flows including a browser click on Copy.

**Claude** wrote plain JS with JSDoc, Express 4, `tsc --checkJs`, `node:test`,
and **`node:sqlite`**, citing the operator preference for Node built-ins that
`prompts/app/spec.md` now states. Nineteen tests. The finish gate ran the
same quality bar from a fresh clone. Copy was unit-tested and wiring-reviewed;
there was no headless browser on the laptop, so that one flow is weaker
evidence than Cursor's.

Both left syntax highlighting, gist import, keyboard-only navigation, and JSON
export as known gaps. That is the idea file's Nice-to-have list, which is what
Non-goals are for.

The Claude tree is smaller (22 files vs 39). Smaller is not better by itself.
It is what you get when the model picks "no bundler" and a built-in SQLite.

---

## What broke before the loop started, and what the kit learned

The first pair of processes died in about five seconds. `.env` had
`TARGET_REF=develop` for Slack projects. `gh repo create --add-readme` only
creates `main`. Cursor rejected `startingRef: develop`; Claude's
`git clone --branch develop` failed. `--create-repo` now defaults the ref to
`main` and ignores `TARGET_REF`. Pass `--ref` when you mean it.

Claude's first successful clone then died with `Not logged in · Please run
/login`. `claude auth status` on the same machine was Max,
`apiKeySource=none`. The Agent SDK subprocess had been given `PATH`, `HOME`,
and nothing else, which is not enough for the macOS Keychain login
interactive `claude` uses. `scrubbedEnv()` now drops API keys, Slack tokens,
and GitHub tokens, and **keeps the rest of the process environment**. The
`apiKeySource=none` assertion on init is unchanged: a leaked Console key still
refuses the run.

The Claude engine only opened a GitHub PR when `git status` was dirty. Every
iterate turn commits before it returns, so the tree was clean and **sv-claude
had no PR** until a push after the fact. It now calls `pushAndOpenPr` after
an agent turn whether or not there are unstaged files.

A clone failure, on that first develop miss, echoed a GitHub credential in
the thrown `execFileSync` message. Clone I/O is piped now, and error text is
redacted. Rotate the GitHub CLI login if you ran an older `ENGINE=claude`
against a private repo.

None of that is in the A/B table. All of it is why the table exists at all.

---

## What this does not change

**The Slack bot stays on Cursor.** One snippet-vault on Max is you, running
your agent, on your plan. `@CloudAgents` is a team door. Anthropic's rule is
the owner of the Max token, not whoever typed in Slack. `SLACK_CLAUDE_USER_IDS`
exists for a solo channel. Production Railway does not set it. Leave it empty.

Railway `cloud-agents / slack` is still `ff7a2a6`: jobs HTTP API, Fast off,
Cursor. The Claude engine is not deployed there. There is no volume for
clones, and there must not be a Max token on a process other people can
mention.

The leftover `filedrop-slack` service was still running the same Slack app
tokens as `@CloudAgents`. Two Socket Mode clients on one app. That service
was deleted on 17 September 2026. The empty Railway project remains if you
want the shell.

Cursor still has `cursor.com/agents`. Claude still does not. If the thing you
want is a live transcript you can type into from a phone, that is still a
Cursor Cloud Agent, or Claude Code Remote Control on a box you SSH into, not
this Slack process.

---

## How to reproduce

From a checkout of this kit, with `claude auth status` showing
`apiKeySource=none` and no `ANTHROPIC_API_KEY` in the environment:

```bash
npm run doctor -- --phase A
npm run build-app -- --engine cursor --idea-file ideas/example-snippet-vault.md --create-repo sv-cursor
npm run build-app -- --engine claude --idea-file ideas/example-snippet-vault.md --create-repo sv-claude
```

State lands in `.runs/build-bc-….json` and `.runs/build-cc-….json`. Claude
also writes `.runs/claude-cc-….json` (`apiEquivalentUsd`, `sessionId`,
workspace). Resume with `--resume bc-…` or `--resume cc-…`.

The PRs from this run:

- https://github.com/rvegajr/sv-cursor/pull/1
- https://github.com/rvegajr/sv-claude/pull/1

Clone and run either:

```bash
git clone https://github.com/rvegajr/sv-cursor && cd sv-cursor && npm install && npm run dev
git clone https://github.com/rvegajr/sv-claude && cd sv-claude && npm install && npm run dev
```

---

## What you now have numbers for

- The loop is engine-agnostic in practice, not only in `SendFn`. Same stop
  reasons, same milestone count, same idea file.
- Fast-off Composer is in a different price class from the first article's
  $4.57 run. Keep `selectModel()` pinning `fast=false`.
- Sonnet-on-Max for this app was **$6.65 API-equivalent**, not $20–40. Log
  `apiEquivalentUsd` anyway; the next app will not be this one.
- Zero extra dollars is not the same as a cheaper engine. Cursor still wins
  on the metered dollar, on wall time, and on a UI. Max wins when the weekly
  bar has room and you do not want another invoice line.
- Slack is not that case. The bot stays on Cursor.
