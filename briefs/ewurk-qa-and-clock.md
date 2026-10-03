# Finish EWURK v1: run the QA script and fix the Clock bug

## Goal
EWURK v1 is already on `main` and its automated suite was reported green. Two things were never closed: nobody has executed `QA.md`, and issue #2 leaves token and session expiry on wall-clock time while the auth service uses the injected `Clock`. After this run, every QA scenario has been executed, every failure is fixed in product code, and issue #2 is fixed the way the issue specifies.

## Context
- Repo: https://github.com/Worthless-Haunted-Meat/ewurk @ `main`
- The product is a server-rendered Node/Express/EJS app with `node:sqlite`. Read `README.md`, `AGENTS.md`, `QA.md`, and `DESIGN.md` before changing anything.
- `QA.md` is the script. It has a standard setup (seed, port 3500, magic-link sign-in via `/dev/outbox`) and scenarios Q1 onward, one per requirement. Run them in order. Each scenario says what evidence to capture.
- Issue #2: https://github.com/Worthless-Haunted-Meat/ewurk/issues/2
  - `AuthService` sets expiry from `this.clock.now()` (`src/services/authService.ts`).
  - `SqliteTokenStore.consume` and `SqliteSessionStore` compare expiry to `Date.now()` (`src/adapters/sqlite/authAdapters.ts`).
  - The fix is to inject `Clock` into those two stores and compare with `clock.now()`, matching `DESIGN.md`. Do not remove `Clock` from `AuthService`.

## Scope
In:
- Execute every scenario in `QA.md` against a locally started app, in order.
- Fix product code when a scenario fails.
- Inject `Clock` into `SqliteTokenStore` and `SqliteSessionStore` and use it for expiry checks. Update the composition root so production still receives `SystemClock`.
- Add one new test file that freezes the clock and proves a fresh token is not already expired. Do not edit the existing test files.

Out:
- Do not edit `DESIGN.md`, `REQUIREMENTS.md`, `QUALITY.md`, `TASKS.md`, `QA.md`, `eslint.config.js`, `tsconfig.json`, `playwright.config.ts`, or the `scripts` block of `package.json`.
- Do not add features, a Linux image, a curriculum, payments processing, Azure hosting, or new dependencies.
- Do not change device state except through the existing guarded transition.
- Do not store a dollar value on an acknowledgment, and do not disable a device because a payment is behind.

## Definition of done
- [ ] Every scenario in `QA.md` was executed. The PR body lists each Q id as pass, or names the product fix that made it pass.
- [ ] `SqliteTokenStore` and `SqliteSessionStore` expire tokens and sessions with the injected `Clock`, and a test proves a frozen clock does not expire a fresh token.
- [ ] Issue #2 is referenced in the PR.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` exit 0.

## Verification
- `npm ci && npx playwright install chromium`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Constraints
- Model stays Composer 2.5 with Fast off. No new runtime dependencies.
- Open one PR against `main`.
- Conventional commit messages.
