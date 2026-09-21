# Request: a tiny job queue that finishes what it started when told to stop

<!-- kind: build, a long-running process: HTTP enqueue, a worker, retries, graceful shutdown. -->

## Why
Every background job I write loses the job in flight when the process is restarted. Solved
feels like: enqueue over HTTP, a worker that retries, and a SIGTERM that waits for the current
job, then exits cleanly.

## I will judge it by
- `POST /jobs` with `{"cmd":"sleep 2"}` returns 202 and an id; `GET /jobs/<id>` shows `queued`, then `running`, then `done`.
- A job whose command exits non-zero is retried up to 3 times with a growing delay, then shown as `failed` with the last stderr.
- Sending SIGTERM while a job is running: the process stops accepting new jobs (503), finishes the running one, marks it `done`, and exits 0 within the job's remaining time plus a second.
- After a restart, jobs that were `queued` are still queued and run.

## Wrong looks like
- SIGTERM kills the running job and it is neither `done` nor retried.
- Two workers run the same job.

## Must not change
- The port is 8790 unless `PORT` is set.

## Not this
- No priorities, no cron, no dependencies, no UI.

## Where it lives, who uses it
Node 22 or newer, macOS and Linux, a stranger with `curl` from a fresh clone after `npm ci`.

## The one walk-through
I run `npm ci && npm start`, `curl -d '{"cmd":"sleep 3"}' -H 'content-type: application/json' localhost:8790/jobs`, send `kill -TERM` to the process at once, and see it exit 0 about three seconds later with the job `done`.
