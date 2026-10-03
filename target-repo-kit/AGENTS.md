# AGENTS.md

<!--
Copy this file to the root of any repository you want cloud agents to work on,
then fill in the blanks. The agent reads it on every run before touching code.
Think of it as the onboarding doc you'd hand a contractor on day one: where
things are, how to build, how to test, what never to touch.
-->

## What this project is
One paragraph. What it does, who uses it, what "working" looks like.

## Noctusoft platforms (when this product is a Noctusoft app)

A product does not sign up for OpenAI, Twilio, or SendGrid. The product id is the only difference.

- **LLM Relay** — `https://ai.noctusoft.com/v1` on litellm-vm (Azure `20.46.250.159`, Tailscale `100.112.233.46`). Virtual key. No provider SDK.
- **Mail / text / store / marketplace** — noctusoft-relay on `ns` (`74.235.141.84`) with a product-scoped `nsk_…` key. Catalog: `noctusoft-relay/README.md`.

## Health and version (every deployed service)

"Up" and "running the latest code" are different questions. A status page only
answers the first. Answer the second with one public `GET /health`, same field
names everywhere, so one command can check the whole fleet:

```json
{ "ok": true, "service": "tailorfolio", "commit": "d6e2af5d4c30c2ca3fbbf76d0f924a16b2277593",
  "env": "production", "version": "1.0.0.0", "utc": "2026-09-28T15:32:43Z" }
```

| Field | Required | Meaning |
| --- | --- | --- |
| `ok` | yes | The process is serving. Liveness only — no dependency checks here. |
| `service` | yes | Stable slug. Same string in every environment. |
| `commit` | yes | **Full git sha of the running build.** This is the field that answers the question. |
| `env` | yes | `dev` \| `uat` \| `production`. Derive it from a deploy variable, never from a framework's environment name — dev and UAT are often both "Staging". |
| `version` | no | Package or assembly version. Useful, but it does not identify a build. |
| `utc` | no | Now, so a cached response is obvious. |

No auth on `/health`. Put dependency checks behind a second route
(`/health/ready`) so a liveness probe never fails on a slow database.

**Where `commit` comes from, per host.** This is the part that quietly breaks.
Prefer a variable the host injects over a stamping step you have to remember:

| Host | Source |
| --- | --- |
| Railway | `RAILWAY_GIT_COMMIT_SHA` — injected free, including through a Dockerfile build. Nothing to stamp. |
| Vercel, Git integration | `VERCEL_GIT_COMMIT_SHA` |
| Vercel, `npx vercel --prod` from Actions | Do **not** rely on the git vars on a CLI deploy. Pass `${{ github.sha }}` explicitly as a build env. Deterministic either way, so just do this. |
| A VM that deploys by `git pull` | The box has a real `.git`. Read `git rev-parse HEAD` once at boot and cache it. |
| Anything else | Stamp at build time into an env var. Never `npm_package_version` — it is only set when launched through npm and says nothing about the commit. |

A stamp taken from a dirty tree matches no commit and cannot answer the
question. If you must stamp, fail the build on a dirty tree.

**Prove the rollout, do not assume it.** The last step of a deploy polls its own
`/health` until `commit` equals the sha just built, and fails if it has not
converged in ~90s. That is the only way to catch the real failure mode: build
green, rollout never took. `ok: true` from the previous build looks identical to
success.

**Registering the service.** Add it to `services.json` in the `cloud-agents`
factory (name, env, health url, repo, expected branch), then
`npm run version-board` reports it with everything else. One list, not a second
one per tool.

**CORS.** The comparison runs server-side, so `/health` needs no
`Access-Control-Allow-Origin`. Do not add CORS to every app just to feed a
browser status page; have the page call something that compares for it.

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
- Do not switch the Cloud Agent to Fast, Opus, or GPT. Composer 2.5, Fast off. Resume a `bc-` id; do not start a second job. Extra Max usage is never bought.

## Definition of done for any change
1. Typecheck, lint, and tests pass locally.
2. New behavior has a test.
3. User-facing behavior is documented (README or docs/).
4. Working tree is clean and all commits have clear messages.
5. Last lines of the job are COST on that AI's own meter (never one combined dollar). If usage is missing: `COST this run: unknown`.
