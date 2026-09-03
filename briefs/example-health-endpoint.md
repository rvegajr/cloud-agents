# Add a /health endpoint

## Goal
Operators need a cheap liveness check for the service so the platform (Railway,
Kubernetes, a load balancer) can tell whether the process is up without hitting
a real route.

## Context
- This is a Node.js HTTP service. Find the main server entry point (look for
  `src/server.*`, `src/index.*`, `app.*`, or the `main`/`start` script in `package.json`).
- Follow whatever routing style the repo already uses (Express router, Fastify
  plugin, raw `http` handler, Next.js route handler). Do not introduce a framework.
- If the repo already exposes a version or status route, put `/health` next to it
  and mirror its structure.

## Scope
In:
- A `GET /health` route.
- One test for it, in the repo's existing test style and location.
- A one-line README mention under whatever section lists routes or operations.

Out:
- Readiness checks that touch databases or external services.
- Changes to auth, middleware ordering, logging, or CI.
- New dependencies.

## Definition of done
- [ ] `GET /health` responds `200` with JSON `{ "status": "ok", "uptime": <seconds as number> }`
- [ ] The route is unauthenticated even if other routes require auth
- [ ] A test asserts the status code and `status: "ok"`, and the full test suite passes
- [ ] README documents the endpoint in one line

## Verification
- Install with the repo's lockfile (`npm ci`, `pnpm install --frozen-lockfile`, or `yarn install --frozen-lockfile`)
- The repo's lint command, if one exists
- The repo's test command
- Start the server and `curl -s localhost:$PORT/health` shows the expected JSON

## Constraints
- No new runtime dependencies.
- Conventional commit messages (`feat: add /health endpoint`).
- Do not modify CI config or deployment files.
