# <Title: verb + object, e.g. "Add /health endpoint to the API">

## Goal
One or two sentences describing the outcome, not the activity. Why does this
matter to a user or operator?

## Context
- Where the relevant code lives (paths, module names). Guessing is expensive for
  an agent in a fresh clone; pointing is cheap for you.
- Existing patterns to copy (e.g. "follow how `src/routes/version.ts` is wired").
- Anything non-obvious about the stack, environment, or history.

## Scope
In:
- Bullet the concrete things that must change.

Out:
- Bullet what must NOT change. Adjacent refactors, unrelated files, deps, config.

## Definition of done
Each item must be checkable by a command or by reading a specific file.
- [ ] `GET /health` returns `200` with body `{ "status": "ok" }`
- [ ] A test covers the new endpoint and `npm test` passes
- [ ] README lists the endpoint

## Verification
The exact commands the agent must run and see exit 0:
- `npm ci`
- `npm run lint`
- `npm test`

## Constraints
- No new runtime dependencies.
- Conventional commit messages.
- Do not modify CI config.
