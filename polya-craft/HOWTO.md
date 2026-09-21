# How to use polya-craft on a real problem

Five steps. Two of them are yours; the rest is the loop's. Measured on twelve
products so far (ROADMAP.md, R3 and R4); the honest limits are at the end.

## Once, on this machine

```sh
# in the cloud-agents checkout
export PATH="/opt/homebrew/bin:$PATH"                 # Node 22+, not nvm's 18
export WORK_ROOT="$HOME/.cache/cloud-agents-work"     # Colima shares only $HOME
export TMPDIR="$WORK_ROOT/tmp"; mkdir -p "$TMPDIR"
export POLYA_ORACLE=1                                 # the stranger's questions
unset ANTHROPIC_API_KEY                               # Max pays, never the API
ollama list | grep -q qwen3-coder-next                # the local Hand
```

Put those in a `polya` shell function if you like. `examples/corpus/run-corpus.sh`
is the same set, with the budget rule.

## 1. Write the request (ten minutes, yours)

Copy `templates/REQUEST.md`. The three sections only you can write:

- **I will judge it by**: the two to five things you will check when it comes back.
- **Wrong looks like**: the failure you would notice first.
- **Must not change**: a test, a schema, a route, a name. Unlisted means movable.

Say where it runs and who the stranger is. One walk-through. Name the repo and
branch if it exists. Save it anywhere, say `requests/<name>.md`.

## 2. Start it and walk away

```sh
# an existing repo
npm run build-app -- --loop polya --engine hybrid --idea-file requests/<name>.md --repo <url> --ref main
# a new product
npm run build-app -- --loop polya --engine hybrid --idea-file requests/<name>.md --create-repo <name>
```

Thirty to ninety minutes; $3 to $12 Max API-equivalent for a small or medium
problem, more for a page whose checks a browser must attest. It logs; you do
not watch.

## 3. Read the checks (five minutes, yours, optional but cheap)

After the first turn, `.polya/PROBLEM.md` in the workspace lists the done-checks
the architect derived. `templates/ACCEPT.md`, top half: is every line you wrote
there; is there a check you would not pay for; does any check need something
you said may not move. Edit a check's wording and resume if so. A request that
contradicts itself has already stopped and said so.

## 4. It comes back as a draft pull request

The code, the tests the architect wrote red and the worker turned green, and
`LOOKBACK.md`: every check met or not with its evidence, plus what a
fresh-eyed reviewer found that you never asked for.

## 5. Accept (five minutes, yours)

`templates/ACCEPT.md`, bottom half: does "met" mean what you meant; what did
the stranger find; does it answer the problem you had. Accept, accept with a
follow-up, or send it back with one sentence naming the check. Merge it
yourself.

## When it stops instead of finishing

It prints the resume command. Three causes, in the order you will meet them:

1. **"The Solver says the check is wrong, not the product."** Read the
   evidence; it is usually right. Reword the check in `.polya/PROBLEM.md`,
   resume. This is step 3 arriving late.
2. **An orchestrator defect** (a parser, a gate, a resume). Reproduce it
   outside the loop for free, fix it with the artifact as the test, resume.
   Never resume blind: you pay twice for the same wrong diagnosis.
3. **A unit the Hand cannot pass after three tries.** Resume once; it re-plans.
   If it stops again, that unit is a person's or a frontier Hand's.

## Use it for / not yet for

For: anything with a checkable "done": a feature on an existing app, a repair,
a CLI, an API, a library, a long-running process. Measured across those shapes
and across npm, TypeScript, Python and Docker.

Not yet: work whose "done" you cannot describe, taste-driven design, anything
big enough to need the split path (never run live), and anything you would not
let a model with a shell touch until the sandbox exists (ROADMAP.md).
