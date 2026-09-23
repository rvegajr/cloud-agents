# Wire develop → uat → main promotion

## Goal
A merge to `main` must not ship to every hosted environment at once. Production tracks `main`, uat tracks `uat`, dev tracks `develop`. PRs into those branches run lint, typecheck, and unit tests.

## Context
- Repo: https://github.com/Worthless-Haunted-Meat/ewurk @ `main` (includes AGENTS.md rewrite, `.railway/railway.ts`, `EWURK_SEED_ON_BOOT`).
- Railway project already has environments named `dev`, `uat`, and `production`. Update `.railway/railway.ts` so production tracks `main`, uat tracks `uat`, and dev tracks `develop`. Do not write Railway UUIDs or secrets.
- Create `develop` and `uat` branches from current `main` if they are missing. Do not force-push. Do not enable GitHub branch-protection rulesets (a human does that).

## Scope
In:
- Branches `develop` and `uat` from current `main` if missing.
- Railway IaC branch tracking as above.
- GitHub Actions: lint, typecheck, and unit tests (`npm run test:unit` or equivalent — not the full Playwright suite unless it is already cheap) on PRs into `develop`, `uat`, and `main`.
- README: document promote commands (`develop` → PR into `uat` → PR into `main`).

Out:
- Do not edit `REQUIREMENTS.md`, `DESIGN.md`, `QUALITY.md`, `TASKS.md`, `QA.md`, or existing test files.
- Do not enable rulesets.
- Do not force-push.
- No secrets.

## Definition of done
- [ ] `develop` and `uat` exist on the remote (or already existed).
- [ ] `.railway/railway.ts` tracks `main` / `uat` / `develop` for production / uat / dev.
- [ ] A workflow file runs lint, typecheck, and unit tests on PRs into those branches.
- [ ] README documents the promote path.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` exit 0.

## Verification
- `npm ci && npx playwright install chromium`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Constraints
- Composer 2.5, Fast off. One PR against `main`. Conventional commits.
