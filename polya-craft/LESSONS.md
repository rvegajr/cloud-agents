# Lessons

<!-- The ledger. Append-only. One entry per lesson; PATTERN.md section 5 has the rules.
     Read at Understand; written at Look back. Entries here are cross-project and process
     lessons. A target repo may keep its own at .polya/LESSONS.md; both are read. -->

## L-2026-09-18-01
Tags:     kind:build kind:change stage:devise domain:software
When:     a unit's Given pastes content that also lives in a file the Hand can read
Lesson:   name the file as the owner and let the packet be assembled from it when the unit runs; never paste a copy that can drift
Evidence: polya-craft design; the window that did not fit its opening in examples/house.md, U8
Status:   candidate

## L-2026-09-18-02
Tags:     kind:build stage:understand
When:     a done-check depends on work in more than one sub-problem
Lesson:   keep the D in PROBLEM.md, list it in every sub-plan's Trace that carries it, and read the next draft plan against Still-open at each look back
Evidence: polya-craft design; the hollow-core door found at P2 look back in examples/house.md
Status:   candidate

## L-2026-09-18-03
Tags:     stage:devise
When:     a check already exists for a level (an inspection, a CI job, a rubric)
Lesson:   adopt it verbatim as the level check and name the units that close it; do not write a parallel one
Evidence: polya-craft design; the county inspection schedule in examples/house.md
Status:   confirmed(1)

## L-2026-09-19-01
Tags:     kind:repair domain:software stage:understand routing http
When:     the problem is about which paths an HTTP app answers, and the done-checks curl the paths the requester named
Lesson:   add a done-check for malformed paths (`//`, `%2f`, a 2 KB path, a wrong method): the app must answer, never exit; a request that kills the process is the defect the requester did not name
Evidence: polya-live-404, both loops' fixes passed every check and review; a blind reviewer sent GET // and the process died on `new URL(req.url, …)`, a line neither loop touched
Status:   confirmed(2)

## L-2026-09-19-02
Tags:     kind:build stage:devise runtime:node
When:     a build declares a minimum Node engine version and then uses a `node:` core module that stabilized (dropped its experimental CLI flag) partway through that major version's release line
Lesson:   Pin `engines.node` to the exact version where the used core module works unflagged, not the version where the module first appeared behind a flag, and verify by actually installing that minimum version rather than trusting whatever Node happens to be on the build/CI machine.
Evidence: package.json engines >=22.5.0 and README both cite 22.5 as sufficient for `node:sqlite`, but the flag requirement wasn't dropped until later in the 22.x/23.x line; every check in this build (including the orchestrator's own gate) ran on Node 26.7 and so never exercised the stated minimum.
Status:   candidate
