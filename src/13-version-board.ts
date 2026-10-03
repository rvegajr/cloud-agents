/**
 * Print the version board: which commit each service is running, and whether
 * that is the commit it should be running.
 *
 *   npm run version-board              the whole fleet in services.json
 *   npm run version-board -- --strict  also fail when a service cannot answer
 *   npm run version-board -- --json    machine-readable, for a scheduled sweep
 *
 * Exit 1 when anything is stale or unreachable, so this works as a check.
 * Needs `gh auth` for the expected side; the deployed side is a plain GET.
 */
import { loadEnv } from "./lib/env.js";
import { checkFleet, exitCodeFor, formatVersionBoard, loadRegistry } from "./lib/freshness.js";

loadEnv();

const strict = process.argv.includes("--strict");
const asJson = process.argv.includes("--json");

const registry = loadRegistry();
const rows = await checkFleet(registry);

if (asJson) {
  console.log(
    JSON.stringify(
      rows.map((r) => ({
        name: r.service.name,
        env: r.service.env,
        verdict: r.verdict,
        deployed: r.deployed ?? null,
        expected: r.expected ?? null,
        behind: r.behind ?? null,
        detail: r.detail ?? null,
      })),
      null,
      2,
    ),
  );
} else {
  console.log(formatVersionBoard(rows));
}

process.exit(exitCodeFor(rows, strict));
