/**
 * Step 6: give it an idea, get an app.
 *
 *   spec  ->  [ iterate: next milestone -> verify -> commit ]*  ->  finish
 *
 * One conversation, one branch, one PR that grows with every milestone.
 * `--engine cursor` (default) uses a Cursor Cloud Agent. `--engine claude`
 * clones locally and runs the Anthropic Agent SDK against Max. `--engine hybrid`
 * plans on Max and iterates on a local Ollama model (LOCAL_MODEL); `--engine local`
 * never touches Max at all.
 *
 *   npm run build-app -- --idea-file ideas/example-snippet-vault.md --repo https://github.com/you/snippet-vault
 *   npm run build-app -- --engine claude --idea-file ideas/example-snippet-vault.md --repo https://github.com/you/snippet-vault
 *   npm run build-app -- --engine hybrid --idea-file ideas/example-snippet-vault.md --repo https://github.com/you/snippet-vault
 *   npm run build-app -- --resume bc-xxxx
 *   npm run build-app -- --resume cc-xxxx
 *
 * For many ideas in parallel, use `npm run build-farm` (Cursor only).
 */
import { loadEnv, flags } from "./lib/env.js";
import { MaxExhausted } from "./lib/engine-claude.js";
import { MaxCeiling } from "./lib/routing.js";
import { reportStartupFailure } from "./lib/report.js";
import { exitCodeForStopReason, printBuildResult, runBuildApp } from "./lib/build-app.js";

loadEnv();
const args = flags();

try {
  const result = await runBuildApp({
    idea: args.idea,
    ideaFile: args["idea-file"],
    repo: args.repo,
    createRepo: args["create-repo"],
    ref: args.ref,
    engine: args.engine,
    resume: args.resume,
    maxIterations: args["max-iterations"] ? Number(args["max-iterations"]) : undefined,
    maxMilestones: args["max-milestones"] ? Number(args["max-milestones"]) : undefined,
  });
  if (result.stopReason === "startup-failed" && result.error?.startsWith("usage:")) {
    console.error(result.error);
    process.exit(1);
  }
  printBuildResult(result);
  process.exit(exitCodeForStopReason(result.stopReason));
} catch (err) {
  if (err instanceof MaxExhausted) {
    console.error(err.message);
    if (err.resetsAt) console.error(`resets at ${new Date(err.resetsAt * 1000).toISOString()}`);
    console.error("Resume on Cursor: npm run build-app -- --engine cursor --idea-file <same idea>");
    process.exit(4);
  }
  if (err instanceof MaxCeiling) {
    console.error(err.message);
    process.exit(4);
  }
  process.exit(reportStartupFailure(err));
}
