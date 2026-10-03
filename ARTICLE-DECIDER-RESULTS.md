# A Decision Model Read Every Diff for a Day. It Found One Real Bug, Cost Two Tenths of a Cent, and Did Not Make More Apps Finish

## What Jev, d1, nimble, and tev1 did and did not do for the factory's code, measured 2 and 3 October 2026: a spot test on three blind-reviewed builds, a 20-run A/B on the polya corpus, and the blind scores

Decision models ("System One" models) answer typed questions with
probabilities and never write text. TypeSafe's Jev was the first; Liquid's d1
followed, and Ollama 0.35 serves open-weight ones (`nimble`, `tev1`) locally on
the same `/v1/systemone` API. They cannot write code. The question here is
narrower: if one reads each diff the crew produces and flags defects, do the
apps get better?

The mechanism is gate rule 7, `judgment` (PR #24, `architect-crew-gate/src/decider.ts`):

- **What it asks:** after every deterministic gate rule passes, one call per changed file asks literal yes/no
  questions:
  - **test-skips-code:** the test checks a stand-in it defines itself.
  - **vacuous-test:** the test asserts nothing.
  - **weakened-check:** a check was silenced or loosened.
  - **import-side-effect:** a resource is opened at import time (entry points exempt).
  - **swallowed-error:** an error is caught and discarded.
  - **placeholder:** a TODO or stub stands in for real logic.
  - **hardcoded-secret:** a literal credential is committed.
- **What a flag does:** a flag at p ≥ 0.9 blocks the task's first attempt with the gate's usual feedback.
  Later attempts only advise, so the model can never stop a build.
- **Cloud agents:** a Cursor agent has no local clone, so `src/lib/cloud-judgment.ts` reads its pushed
  branch from GitHub instead, and a flag gets one fix turn.

## The short answer

| Question | Answer |
| --- | --- |
| Can these models see the defects our reviewers found? | **Yes.** Jev and nimble flagged exactly the two reviewer-listed defects in the 19/35 hybrid build, and nothing in the 29/35 and 28/35 builds. |
| Do they make more builds finish? | **No.** 4/10 complete with the rule off, 3/10 with Jev on; the rule flagged nothing in the one request where the arms differed. |
| Do they make the finished code better? | **Once, measurably.** One real defect caught and repaired; that pair scored 34 vs 32 blind. Two other pairs: +1 (noise) and a tie. |
| What does it cost? | **$0.002** of Jev for the whole A/B (6 builds judged, 196 decisions), against $82.79 Max API-equivalent for the 20 builds. |
| False alarms? | **None** at the 0.9 threshold in the A/B. The highest unflagged probability was 0.89. |

The judgment rule is a cheap safety net. It is not the lever for completion
rate. The orchestrator is: 11 of 20 runs stopped on its own planning and task
checks, or crashed.

---

## Test 1: the three builds a human already scored

The snippet-vault A/B of 17 September ([ARTICLE-CLAUDE-MAX-RESULTS.md](ARTICLE-CLAUDE-MAX-RESULTS.md))
left three repos and a blind human review:
- **sv-hybrid** (19/35): an import-time DB singleton, two tests that assert nothing, and a lint rule bent
  around one variable.
- **sv-claude** (29/35) and **sv-cursor** (28/35).

Each model read each build's full diff from the root commit.

| Model | sv-hybrid (19/35) | sv-claude (29/35) | sv-cursor (28/35) | Time per build | Cost |
| --- | --- | --- | --- | --- | --- |
| Jev `jev-1.13.0` | `src/db.js` import-side-effect p=0.98; `test/server.test.js` test-skips-code p=0.96 | nothing | nothing | 0.6–1.3 s | $0.0036 for all three |
| nimble (Ollama 0.35) | the same two, p=0.98 | nothing | nothing | 48–132 s | $0 |
| d1 `d1:free` | the same two, p=1.00 | `tsconfig.json` `"strict": false` p=0.92 (defensible) | `public/copy.js` empty catch before a fallback p=0.95 (false positive) | 31–63 s, with 429s | $0 |
| tev1 (Ollama 0.35) | missed both | nothing | nothing | 28–54 s | $0, but rejects any request over ~2,050 tokens |

Two fixes came out of this test before the A/B. Both are reminders that these
models read literally.

1. **The first test question missed the fake test.** It asked whether a test
   has "no assertion that compares output with an expected value."
   `test/server.test.js` *does* assert (`status === 200`), against a server it
   builds inside the test and never imports from `src/`. Jev answered the
   question as written: p=0.05. TypeSafe's own guidance is to split an
   interpretive question into literal ones. Splitting it into `test-skips-code`
   and `vacuous-test` took the flag to p=0.96.
2. **Entry points were flagged for doing their job.** Both models called
   `src/server.js` (which `npm start` runs, and which calls `app.listen`) an
   import-time side effect. Files named by `main`, `bin`, or the `start`/`dev`
   scripts are now exempt from that one question.

## Test 2: the A/B

- **Setup:** the ten polya corpus requests (`polya-craft/examples/corpus/`), each built twice on
  `--engine hybrid --loop polya`, with `DECIDER=off` and `DECIDER=jev`.
- **Order:** which arm went first alternated per request, so drift in the Max window hit both arms.
- **Isolation:** runs came from a worktree pinned to PR #24's first commit; the driver is
  `.runs/corpus-ab/ab-driver.sh`.
- **When:** 2 Oct 12:58Z to 3 Oct 06:32Z.

| Request | Off | Jev | Did the rule act? |
| --- | --- | --- | --- |
| jsoncount-depth | stopped while planning (`understanding-incomplete`), $1.07 | stopped while planning (`plan-not-workable`), $2.67 | no code reached the gate |
| slugify | **complete**, $4.20 | **complete**, $2.59 | no flags |
| iso-week | **complete**, $2.99 | **complete**, $1.90 | no flags |
| kv-api | `finish-check-failed`, $4.09 | `unit-gate-failed`, $7.83 | no flags; U2 failed the quality bar |
| packing-list | **complete**, $5.68 | **complete**, $6.27 | **yes**, see below |
| ledger-report | `unit-gate-failed`, $5.29 | `unit-gate-failed`, $6.44 | no flags |
| snippet-vault-export | **complete**, $5.24 | `unit-gate-failed`, $8.81 | no flags |
| cron-next | `unit-gate-failed`, $5.01 | `verify-failed`, $1.98 | no flags |
| dedupe-py | crashed: `git add -A` | `unit-gate-failed`, $4.64 | no flags |
| job-queue | `verify-failed`, $6.09 | crashed: 80-turn cap | no flags |

Every money figure above is Claude Max API-equivalent: plan usage, not a card
charge. The A/B total is **$82.79**.

### The one thing the rule did

In packing-list, the crew's `app.js` caught a failed `localStorage` save and
discarded it.

1. **First flag:** Jev flagged `swallowed-error` at p=0.92 on unit U3's first attempt.
2. **Advisory flag:** the crew's retry did not change it, so attempt 2 reported the same p=0.92 as advisory and the unit
   passed.
3. **Finish check:** it flagged again (blocking, attempt 0). The Solver devised a repair unit,
   *"Surface a failed load instead of discarding it,"* and the build completed.

Here is what each arm shipped:

```js
// DECIDER=off: the save failure is swallowed
} catch (e) {
  /* storage unavailable (e.g. private-browsing quota); state still
     renders for this session, it just will not survive a reload */
}

// DECIDER=jev: the user is told
} catch (err) {
  errorBox.textContent =
    'Could not save your changes. They may be lost if you leave this page.';
}
```

The off arm's comment shows the decision was deliberate, and it still loses a
user's list without telling them. The repair cost $0.59 more Max (6.27 vs 5.68).

### Blind scores

`npm run quality-review --repeat 2 --model sonnet` scored the three requests that both arms completed.
Candidates are anonymised and shuffled, and engine labels are joined back after scoring.

| Request | Off | Jev | Where the difference is |
| --- | --- | --- | --- |
| packing-list | 32 | **34** | security 4 → 4.5, structure 4 → 5 |
| slugify | 32.5 | 33.5 | no flags in either arm, so this is noise |
| iso-week | 34 | 34 | none |

The scorer was calibrated on 18 September as a relative instrument that is
lenient in absolute terms. All six builds got a `merge` verdict. Read the
deltas, not the totals. With three pairs, only packing-list's +2 can be
credited to the rule, and it lines up with the one defect it caught.

### Why it fired so rarely

196 decisions across 6 judged builds, by question:

| Question | Asked |
| --- | --- |
| weakened-check | 42 |
| hardcoded-secret | 42 |
| swallowed-error | 41 |
| placeholder | 41 |
| import-side-effect | 28 |
| test-skips-code | 1 |
| vacuous-test | 1 |

The two test questions were asked **once each**. In the polya loop, the
Solver (Claude) writes the done-checks as tests at Understand. The local Hand
writes source against them and rarely touches a test file. The defects that
made sv-hybrid score 19/35 came from the old milestone loop, where the local
model wrote its own tests. In polya, the structure already prevents most of
them. The rule's remaining value is the source-side questions, and those are
exactly where it caught packing-list.

Only 8 of 196 decisions reached p ≥ 0.5. The rule is quiet by design.

---

## What this does not show

- **Sample size:** 10 requests and 3 scored pairs. That can show a large effect and cannot rule out a small
  one.
- **Only Jev was A/B tested.** nimble matched it in the spot test, but has not been through the A/B. d1 was
  noisier and slower in the spot test.
- **Cursor and Slack are unmeasured.** The rule is live there through `withJudgment`, on Railway since
  3 October. It probably matters more there: a Cursor agent writes its own tests, so the sv-hybrid defect
  class can recur. It has not been A/B tested.
- **Only one use was tested:** flagging defects in finished work. Three uses are untried:
  - routing each turn to the local model or Claude with a confidence;
  - deciding retry vs escalate after a failed gate;
  - picking the best of N cheap local attempts.

  These spend fewer Max turns, rather than polishing finished code, and may be the bigger win.

## What changed because of this run

- **Rule wording:** the test question was split in two, and entry points were exempted (above).
- **Crash fixes (PR #25):**
  - A probe's unreadable fixture crashed `git add -A`. Probe scratch now goes to `.git/info/exclude`,
    and a file git cannot index is skipped and named.
  - The SDK re-throws after a max-turns result. That is now a resumable failed turn.
- **Turn cap (PR #17):** `CLAUDE_MAX_TURNS` raises the 80-turn cap per job.
- **What is on:** `DECIDER=jev` locally and on the Slack bot, plus `GITHUB_TOKEN` there so private branches
  can be read.

## Next, cheapest first

1. **Rerun the corpus with the crash fixes.** Add a nimble arm; its decisions cost nothing. Fewer runs die
   before the gate, so the rule gets more chances to act.
2. **Run a Cursor A/B on the same ideas,** off vs Jev, through `withJudgment`. This is where the test-quality
   questions should fire.
3. **Try routing.** A Jev `Choice` per turn: local vs Claude, with confidence. Measure Max spent per
   completed build.

## Reproduce

```
DECIDER=jev   npm run build-app -- --loop polya --engine hybrid --idea-file polya-craft/examples/corpus/05-packing-list.md --create-repo my-pl-jev
DECIDER=off   npm run build-app -- --loop polya --engine hybrid --idea-file polya-craft/examples/corpus/05-packing-list.md --create-repo my-pl-off
npm run quality-review -- --job-file polya-craft/examples/corpus/05-packing-list.md <off repo> <jev repo> --repeat 2 --model sonnet
```

The raw data is in `.runs/corpus-ab/`:
- `summary.tsv`
- one log per run
- `decider-jev.jsonl` (every decision)
- `review-*.log`

COST of this study, by meter:
- Claude Max API-eq: $82.79 for the builds, $3.24 for the blind review.
- TypeSafe (Jev) billed: $0.002 in the A/B, $0.0036 in the spot test.
- Liquid (d1): $0 on the free tier.
- Local nimble and tev1: $0.
