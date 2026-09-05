/**
 * Stamp the current checkout so the running bot can say which commit it is.
 *
 *   npm run stamp                 write version.json and print the BUILD_INFO pair
 *   npm run stamp -- --railway    also set BUILD_INFO on the linked Railway service
 *   npm run deploy                both of the above, then `railway up`
 *
 * The stamp has to travel as an environment variable, not a file: `railway up`
 * honours `.gitignore`, and `version.json` is ignored on purpose because it
 * describes one build rather than the repo. `--skip-deploys` keeps setting the
 * variable from queueing a second deploy on top of the one `railway up` starts.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { formatVersion, stampEnvPair, stampFromGit, stampPath } from "./lib/version.js";

const toRailway = process.argv.includes("--railway");

let info;
try {
  info = stampFromGit();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

writeFileSync(stampPath(), `${JSON.stringify(info, null, 2)}\n`);
console.log(`stamped ${stampPath()}`);
console.log(`  ${formatVersion(info)}  built ${info.builtAt}`);
if (info.dirty) {
  console.warn("  warning: the working tree is dirty, so this build matches no commit. Commit first, then tag.");
}

const pair = stampEnvPair(info);
if (!toRailway) {
  console.log("\nTo stamp the host, set this variable there:");
  console.log(`  railway variable set '${pair}' --skip-deploys`);
  process.exit(0);
}

const res = spawnSync("railway", ["variable", "set", pair, "--skip-deploys"], { stdio: "inherit" });
if (res.error || res.status !== 0) {
  console.error(`\nCould not set BUILD_INFO on Railway (${res.error?.message ?? `exit ${res.status}`}).`);
  console.error("Is this directory linked? `railway status`. The deploy will still work; the bot just won't know its commit.");
  process.exit(1);
}
console.log("BUILD_INFO set on the linked Railway service");
