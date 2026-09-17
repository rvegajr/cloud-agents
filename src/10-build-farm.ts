/**
 * Parallel Cursor factory: one idea file → one Cloud Agent VM → one PR.
 *
 * The loop is the same as `npm run build-app`. This process is only the
 * scheduler; it must stay awake for the wave. Resume a single job with
 * `npm run build-app -- --resume bc-xxxx`. Slack and Max are not this path.
 *
 *   npm run build-farm -- --ideas-dir ideas/ready --concurrency 5 --create-repos
 *   npm run build-farm -- --status
 *   npm run build-farm -- --farm farm-2026-09-17T14-00-00-000Z
 */
import { loadEnv, flags } from "./lib/env.js";
import { reportStartupFailure } from "./lib/report.js";
import { runBuildApp } from "./lib/build-app.js";
import {
  farmExitCode,
  formatFarmStatus,
  listFarmManifests,
  loadFarmManifest,
  loadIdeaSpecs,
  parseConcurrency,
  parseMaxUsd,
  runFarm,
} from "./lib/farm.js";
import { buildStateDir } from "./lib/build-app.js";
import { defaultLedgerPath, formatCostBoard, loadCostLedger } from "./lib/cost-ledger.js";

loadEnv();
const args = flags();

function usage(): never {
  console.error(
    `usage:
  npm run build-farm -- --ideas-dir ideas/ready --create-repos [--concurrency 5] [--max-usd 10]
  npm run build-farm -- --status
  npm run build-farm -- --farm <id>`,
  );
  process.exit(1);
}

try {
  if (args.status === "true" || args.status === "") {
    const farms = listFarmManifests();
    if (!farms.length) {
      console.log("No farm manifests in .runs/");
      process.exit(0);
    }
    for (const f of farms) console.log(`${formatFarmStatus(f)}\n`);
    process.exit(0);
  }

  if (args.farm) {
    console.log(formatFarmStatus(loadFarmManifest(args.farm)));
    process.exit(0);
  }

  const ideasDir = args["ideas-dir"];
  if (!ideasDir || args["create-repos"] !== "true") usage();

  const specs = loadIdeaSpecs(ideasDir);
  if (!specs.length) {
    console.error(`No idea markdown files in ${ideasDir} (TEMPLATE.md is skipped).`);
    process.exit(1);
  }

  const concurrency = parseConcurrency(args.concurrency ?? process.env.FARM_CONCURRENCY);
  const maxUsd = parseMaxUsd(args["max-usd"] ?? process.env.FARM_MAX_USD);
  console.log(
    `farm: ${specs.length} ideas from ${ideasDir}  concurrency=${concurrency}  cap=$${maxUsd.toFixed(2)}  engine=cursor`,
  );
  console.log("This process must stay awake until the wave finishes. Laptop sleep stops the scheduler, not the VMs.\n");

  const manifest = await runFarm({
    specs,
    ideasDir,
    concurrency,
    maxUsd,
    runJob: async (spec) => {
      const result = await runBuildApp({
        idea: spec.idea,
        ideaFile: spec.ideaFile,
        createRepo: spec.repoName,
        engine: "cursor",
        cursorApp: "require",
        stream: { text: false, tools: true, prefix: `[${spec.repoName}]` },
        costSource: "farm",
        log: (line) => {
          for (const l of line.split("\n")) console.log(`[${spec.repoName}] ${l}`);
        },
      });
      if (result.stopReason === "startup-failed") {
        console.log(`[${spec.repoName}] RESULT: startup-failed ${result.error ?? ""}`);
        return {
          status: "failed",
          repo: result.repo,
          agentId: result.agentId,
          error: result.error,
          cents: result.chargedCents,
        };
      }
      console.log(`[${spec.repoName}] RESULT: ${result.stopReason}${result.prUrl ? ` ${result.prUrl}` : ""}`);
      if (result.costClose) console.log(`[${spec.repoName}]\n${result.costClose}`);
      return {
        status: result.stopReason === "complete" ? "done" : "failed",
        repo: result.repo,
        agentId: result.agentId,
        prUrl: result.prUrl,
        stopReason: result.stopReason,
        cents: result.chargedCents,
        error: result.error,
      };
    },
  });

  console.log(`\n${formatFarmStatus(manifest)}`);
  console.log(`\n${formatCostBoard(loadCostLedger(defaultLedgerPath(buildStateDir())))}`);
  console.log(`\nmanifest: .runs/${manifest.id}.json`);
  console.log("Resume one job: npm run build-app -- --resume <bc-id>");
  process.exit(farmExitCode(manifest));
} catch (err) {
  process.exit(reportStartupFailure(err));
}
