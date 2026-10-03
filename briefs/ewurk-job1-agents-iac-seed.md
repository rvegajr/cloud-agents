# Fill AGENTS.md, Railway IaC, and seed-on-boot for non-prod

## Goal
Later Cloud Agents should not reconstruct this repo from a template. Staff on hosted **dev** and **uat** should get the demo dataset when an empty volume boots. Railway config for the existing `ewurk` service lives in the repo.

## Context
- Repo: https://github.com/Worthless-Haunted-Meat/ewurk @ `main`
- `AGENTS.md` is still the kit template (`src/index.ts`, fake layout). Replace it with the real app: Express + EJS + `node:sqlite`, entry `src/server.ts`, composition `src/app.ts`, tests in `test/*.test.ts` and `test/e2e/*.spec.ts`. Commands: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm start`, `npm run seed`.
- Railway project already exists: service `ewurk`, volume at `/data`, custom domains `dev.ewurk.org`, `uat.ewurk.org`, `ewurk.org`. Do not invent a second project. TypeScript IaC at `.railway/railway.ts` (no Railway UUIDs, no secrets). Healthcheck `GET /health`. Variables by name only: `EWURK_DB_PATH=/data/ewurk.db`, `NODE_ENV`, `EWURK_PUBLIC_URL` per environment (dev / uat / production). SMTP names may be declared optional; never put credential values in the file.
- Seed already exists (`src/seed.ts`). Add `EWURK_SEED_ON_BOOT` that runs that seed only when `NODE_ENV` is not `production`. Default off. Production must never seed from this flag.

## Scope
In:
- Rewrite `AGENTS.md` for this repo.
- Add `.railway/railway.ts` for the existing service as above.
- Implement `EWURK_SEED_ON_BOOT` for non-production only, with tests in a new file.
- README: document the flag and that production never auto-seeds.

Out:
- Do not edit `REQUIREMENTS.md`, `DESIGN.md`, `QUALITY.md`, `TASKS.md`, `QA.md`, or existing test files.
- No secrets, no new paid services, no Stripe, no Postgres.

## Definition of done
- [ ] `AGENTS.md` describes the real layout and commands.
- [ ] `.railway/railway.ts` declares healthcheck `/health`, volume `/data`, and the env var names above.
- [ ] `EWURK_SEED_ON_BOOT` seeds only when not production; a test proves production ignores it.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` exit 0.

## Verification
- `npm ci && npx playwright install chromium`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Constraints
- Composer 2.5, Fast off. One PR against `main`. Conventional commits.
