# Requirements

<!-- Written by the architect in stage 0. Owned by the architect; the crew reads it.
     Job kind is the first Decision. Every criterion has a stable id and a check a
     stranger could run. See PATTERN.md section 2.1. -->

## Problem

Who has the problem, what it costs them today, and what "solved" looks like in
one observable sentence. For a repair: the defect as observed, and the
reproduction.

## Users

- **<user type>**: what they need to do.

## Acceptance criteria

- **R1** WHEN <event> THE SYSTEM SHALL <response> <measurable outcome>.
  Check: `<command or request>` → <exact expected result>.
- **R2** WHILE <state> THE SYSTEM SHALL <response>.
  Check: …
- **R3** IF <condition> THEN THE SYSTEM SHALL <response>.
  Check: …

## Workflows

<!-- End-to-end journeys a user walks, each crossing several requirements. QA
     executes every one start to finish in a fresh clone (stage 4), in a real
     browser when the steps happen on a page. A build or change needs at least one. -->

- **W1** <title> (R1, R3, R7)
  1. <step, what the user does and what they see> (R1)
  2. <step> (R3)
  3. <step> (R7)

## Coverage

<!-- One line per must-have bullet of the job, in the job's order. The orchestrator
     checks every M maps to real requirement ids and that one of them is in a workflow. -->

- M1: R1, R2
- M2: R3

## Non-goals (v1)

- <explicit exclusion>

## Decisions

- Job kind: build | change | repair | maintain
- <ambiguity in the job> → <decision taken>

```json requirements
{ "requirements": [
    { "id": "R1", "text": "", "check": "" }
  ],
  "workflows": [
    { "id": "W1", "title": "", "requirements": ["R1", "R3", "R7"], "steps": ["", "", ""] }
  ],
  "coverage": { "M1": ["R1", "R2"], "M2": ["R3"] }
}
```
