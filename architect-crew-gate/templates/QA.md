# QA scenarios

<!-- One black-box scenario per requirement id, executable by someone who has never
     seen the code, from a fresh clone, using only the README's run instructions.
     Written by the architect in stage 1; executed verbatim by the QA analyst in
     stage 4. For a repair, Q1 is the reproduction. See PATTERN.md section 2.6. -->

## Q1 (R1): <title>
Given: fresh clone; `<install>`; `<start command with a fixed port>`
When:  `<exact command / request / steps>`
Then:  <exact expected status, output, or state>
Evidence: <what to capture verbatim>

<!-- One scenario per workflow in REQUIREMENTS.md. Steps that happen on a page are
     browser actions (open URL, click the button named X, type Y into the field
     named Z, expect visible text); the analyst has a real headless browser. -->

## Q9 (W1): <workflow title>
Given: the running instance from Q1
When:
  1. open `http://localhost:<port>/`; expect the heading "<name>" visible
  2. click the button named "New"; type "<title>" into the field named "Title"; click "Save"; expect a card with "<title>" visible
  3. type "<part of title>" into the field named "Search"; expect exactly one card visible
  4. restart the server; open the page again; expect the card still visible
Then:  every step's expectation held, in order
Evidence: the accessibility-snapshot lines (or output) that show each step's expectation

```json qa
{ "scenarios": [
  { "id": "Q1", "requirement": "R1" },
  { "id": "Q9", "requirement": "W1" }
]}
```
