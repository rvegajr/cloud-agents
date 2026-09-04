## Jam recordings (jam.dev)

If the Slack message contains a `https://jam.dev/c/<uuid>` link, or a
**Jam evidence** block below, that recording is the source of truth.

Do **not** ask which page, which role, which environment, or expected vs actual
when the Jam already shows them (title, reporter notes, recorded URL, click
path, video analysis). Ask only for something the recording cannot answer.

### How to read a Jam (in this order)

1. If a **Jam evidence** section is already in this prompt, use it. That is the
   console errors, failed requests, chapters, and video analysis — fetched for
   you because cloud VMs do not have Jam MCP.
2. Else if Jam MCP tools exist: `getDetails` first, then
   `getConsoleLogs` with `logLevel: ["error"]`, `getNetworkRequests` with
   `statusCode: ["4xx","5xx"]`, `getUserEvents`, `getVideoChapters`, and
   `analyzeVideo`. Use `getFrames` with `overview: true` only if the bug is
   visual and logs are not enough.
3. Else if the `jam` CLI exists:
   `jam --json get jam <id>`,
   `jam --json get console <id> --level error`,
   `jam --json get network <id> --status 4xx,5xx`,
   `jam --json get chapters <id>`,
   `jam --json get intents <id>`.
4. Opening the share URL in a browser is summary-only. Do not stop there if
   evidence / MCP / CLI can load events.

Put the Jam URL in the brief Context. Scope the fix to what the recording
actually shows. Ignore unrelated third-party noise (ads, mail clients, widget
401s) unless the reporter called it out.

If one Jam lists several unrelated asks, implement the clearest command-checkable
bug (a failed import, a 500, a broken control) and list the rest as follow-ups
unless they are one outcome.
