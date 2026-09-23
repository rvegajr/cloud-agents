# Make hosted EWURK operable on its three environments

## Goal
EWURK v1 already implements R1–R25 and is deployed. Staff still cannot use the hosted app: production has an empty database and no way to deliver a magic link, and Railway has no health check. After this change, an empty volume boots to a working login page, dev and uat keep the dev outbox, production sends mail only when SMTP is configured, and `/health` returns 200 with no session.

## Context
- Repo: https://github.com/Worthless-Haunted-Meat/ewurk @ `main` (commit that includes the Clock fix, PR #3).
- Railway project `ewurk`, service `ewurk`, volume mounted at `/data`, `EWURK_DB_PATH=/data/ewurk.db`.
- production: https://ewurk.org and https://www.ewurk.org, `NODE_ENV=production`
- uat: https://uat.ewurk.org, `NODE_ENV=development`
- dev: https://dev.ewurk.org, `NODE_ENV=development`
- All three currently deploy `main`. Do not invent a second git flow.
- Custom domains are attached at Porkbun. Certificates were still validating when this brief was written (Railway edge returned `x-railway-fallback: true`). Do not change DNS, Railway, or Porkbun. Do not put secrets in the repo.
- Read `README.md`, `src/server.ts`, `src/app.ts`, `src/db/migrate.ts`, and `src/adapters/mail/DevOutboxMailer.ts` before editing.
- `REQUIREMENTS.md` §6 lists real outbound email and Postgres as v1 non-goals. This job is the hosted follow-on: keep SQLite, keep magic-link auth, add a mail adapter that stays idle until SMTP env vars exist.

## Scope
In:
- Confirm an empty database (no file yet, or an empty file) migrates on startup and `GET /` or `GET /login` renders. Fix the boot path if it throws.
- Add `GET /health` that does not require a session and returns 200 with a small JSON body `{"status":"ok"}`. It is not under `/api`. Unknown `/api/*` paths still return the R25 JSON 404.
- Keep `DevOutboxMailer` and `GET /dev/outbox` only when `NODE_ENV` is not `production`.
- Add an SMTP `Mailer` used only when `SMTP_HOST` is set. Document `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in the README. When `NODE_ENV=production` and `SMTP_HOST` is unset, sign-in returns a clear error that mail is not configured, and it does not mount the outbox.
- README: the three environment URLs, the volume path, how to seed (`npm run seed` with `EWURK_DB_PATH`), and how sign-in works on dev/uat versus production.
- Tests in a new file. Do not edit existing test files. Cover: `/health` is 200 without a session; `/dev/outbox` is absent when `NODE_ENV=production`; the SMTP mailer is not selected when `SMTP_HOST` is unset.

Out:
- Linux images, curriculum, Wanderful licensing, lease pricing, or a pilot donor.
- Stripe, Square, Postgres, Azure, SSO, lessee login, or device lockout.
- Do not edit `DESIGN.md`, `REQUIREMENTS.md`, `QUALITY.md`, `TASKS.md`, `QA.md`, `eslint.config.js`, `tsconfig.json`, `playwright.config.ts`, or the `scripts` block of `package.json`.
- No new paid service and no committed secrets.

## Definition of done
- [ ] A fresh `EWURK_DB_PATH` boots and the login page renders.
- [ ] `GET /health` returns 200 `{"status":"ok"}` with no session.
- [ ] Production composition does not expose `/dev/outbox`.
- [ ] SMTP is used only when `SMTP_HOST` is set, and the README lists the variables and the three URLs.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` exit 0.

## Verification
- `npm ci && npx playwright install chromium`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Constraints
- Composer 2.5, Fast off. No new runtime dependencies unless SMTP cannot be done with Node's built-in `node:net` or an already-installed package. Prefer no new dependency.
- One pull request against `main`.
- Conventional commit messages.
