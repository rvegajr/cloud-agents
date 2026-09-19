# Look back: <PROBLEM title>

<!-- Written by the orchestrator or the person, from (a), (b), (c). Always written, even after a stop.
     See PATTERN.md section 2.3. -->

## Result
| D | Met | Evidence |
| --- | --- | --- |
| D1 | yes | <line from (a) or (b)> |

## Judgment
- Answers the restated problem: <yes / no, why>
- Another way to check it: <…>
- Findings:
  - [high] <where> — <what> — fix: <…> — check: <…>

## What worked
- <tied to a unit or level>

## What did not
- U<n>: <retry / question / escalation> — cause — what would have prevented it

## Still open
<!-- L only. Ds not yet met, the sub-problem and units that carry them. -->

## Lessons
## L-<yyyy-mm-dd>-<nn>
Tags:     kind:<…> domain:<…> stage:<…>
When:     <the problem looks like …>
Lesson:   <one imperative sentence>
Evidence: <this problem, what happened, which unit or D>
Status:   candidate

<!-- or: No lesson: <why> -->

Confirmed: L-<id> → confirmed(n+1)

## Reusable
- <method, unit, or check that applies elsewhere>

```json lookback
{ "verdict": "done",
  "results": [ { "id": "D1", "met": true, "evidence": "" } ],
  "findings": [],
  "lessons": [],
  "confirmed": [] }
```
