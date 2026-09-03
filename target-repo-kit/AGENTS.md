# AGENTS.md

<!--
Copy this file to the root of any repository you want cloud agents to work on,
then fill in the blanks. The agent reads it on every run before touching code.
Think of it as the onboarding doc you'd hand a contractor on day one: where
things are, how to build, how to test, what never to touch.
-->

## What this project is
One paragraph. What it does, who uses it, what "working" looks like.

## Layout
- `src/` - application code. Entry point: `src/index.ts`.
- `src/routes/` - one file per HTTP route. Add new routes here, register in `src/app.ts`.
- `test/` - mirrors `src/`. `src/routes/foo.ts` is tested by `test/routes/foo.test.ts`.
- `scripts/` - one-off maintenance scripts. Not part of the build.

## Commands
| Purpose | Command | Notes |
| --- | --- | --- |
| Install | `npm ci` | Never `npm install`; keep the lockfile stable. |
| Typecheck | `npm run typecheck` | Must pass before commit. |
| Lint | `npm run lint` | Auto-fix with `npm run lint -- --fix`. |
| Test | `npm test` | Runs in under a minute. Add tests next to what you change. |
| Dev server | `npm run dev` | Listens on `$PORT` (default 3000). |

## Conventions
- TypeScript strict mode. No `any` unless you comment why.
- Errors: throw typed errors from `src/errors.ts`; never swallow.
- Logging: use `logger` from `src/logger.ts`; no `console.log` in `src/`.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`), imperative mood, one concern per commit.

## Never
- Do not edit files under `migrations/` that already exist. Add new ones.
- Do not modify `.github/workflows/` or deployment config without being asked explicitly.
- Do not add runtime dependencies without stating why in the PR description.
- Do not commit secrets, `.env` files, or generated artifacts.

## Definition of done for any change
1. Typecheck, lint, and tests pass locally.
2. New behavior has a test.
3. User-facing behavior is documented (README or docs/).
4. Working tree is clean and all commits have clear messages.
