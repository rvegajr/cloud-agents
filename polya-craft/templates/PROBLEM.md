# Problem: <one line, in your words, not the requester's>
Kind: repair | change | build | answer
Size: S | M | L

<!-- Understand only. No plan text. See PATTERN.md section 2.1. -->

## Given
- <what exists, by its owning location: a path, a document, a URL, a drawing. If it can change and its owner is outside your control, its revision>

## Unknown
<the exact form of the deliverable>

## Condition
<how Given and Unknown connect: the rules the answer must obey>

## Restated
<two to five sentences in your own words; what "wrong" looks like; what the requester will judge it by>

## Done-check
- D1: <the answer in use, by a stranger> — Check: <what a stranger runs or compares> — Now: unmet
- D2: <statement> — Check: <…> — Now: unmet | met (invariant)

## Not this
- <explicit non-goal>

## Lessons consulted
- L-<id>: applied as <…> | not applicable because <…>

## Split
<!-- L only. Delete otherwise. -->
| Sub-problem | Bounding check (adopted) | D ids carried |
| --- | --- | --- |
| P1 <name> | <existing inspection / milestone / release check> | D2 D3 |

## Quality bar
<!-- Software only. Delete otherwise. Purpose → shell. `test` is required. -->
| Purpose | Command |
| --- | --- |
| install | `npm ci` |
| test | `npm test` |
| lint | `npm run lint` |
| start | `npm start` |

```json problem
{ "kind": "build", "size": "M",
  "done": [ { "id": "D1", "text": "", "check": "", "outer": true, "now": "unmet" } ],
  "lessons": [ { "id": "L-", "applied": true, "how": "" } ],
  "split": [],
  "bar": { "install": "", "test": "" } }
```
