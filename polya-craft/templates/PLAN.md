# Plan for: <PROBLEM title>

<!-- Devise only. Every unit must pass the stranger test before this plan is handed over.
     See PATTERN.md sections 2.2 and 3. -->

## Approach
<the method; the related problem it borrows from; what is deliberately not attempted>

## Shape
- L2 whole — check: <the outer test passes>
- L1 <group> — check: <adopted if one exists, else written>
- L0 units — below

## Outer test
1. <a stranger does …> (D1)
2. <…> (D2)

## Units

## U1: <verb + deliverable>
Serves:   D1
Level:    L1:<group>
Produces: <one deliverable, by location>
Given:    <every input, by owning location or verbatim; nothing else is read>
Do:       1. <imperative>. 2. <…>. (≤ 7; no choose / decide / appropriate / as needed / best / etc.)
Touches:  <the complete set the Hand may change>
Check:    <decided without the Hand; unmet now; outside Touches> — Now: unmet
Depends:  none
Not:      <what to leave alone>

## Order
U1 → U2, U3 in parallel (disjoint Touches) → U4

## Trace
- D1 → U1, U4 → steps 1, 3
- D2 → U2 → step 2

## Still open
<!-- L only, filled at look back. -->

```json plan
{ "levels": [ { "id": "L1:<group>", "check": "" } ],
  "units": [ { "id": "U1", "title": "", "serves": ["D1"], "level": "L1:<group>",
               "produces": "", "touches": [""], "check": "", "depends": [] } ],
  "outer": [ { "step": 1, "d": "D1" } ],
  "trace": { "D1": ["U1"] } }
```
