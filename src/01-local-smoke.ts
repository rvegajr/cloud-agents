/**
 * Step 1: prove the loop works, locally, against this very folder.
 *
 * `Agent.prompt()` is the one-shot shape: create, run, dispose. Nothing is
 * committed, no repo is cloned. It exists so the first thing you debug is auth
 * and model access, not GitHub permissions.
 *
 *   npm run smoke
 *   npm run smoke -- --prompt "List the prompt templates in this repo and what each is for"
 */
import { Agent } from "@cursor/sdk";
import { loadEnv, env, flags } from "./lib/env.js";
import { resolveApiKey } from "./lib/auth.js";
import { reportResult, reportStartupFailure } from "./lib/report.js";

loadEnv();
const args = flags();

const prompt =
  args.prompt ??
  "Read README.md and the files under prompts/ and briefs/. In five bullets, explain how this kit assembles a prompt for a cloud agent. Do not edit anything.";

try {
  const apiKey = await resolveApiKey();
  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: env("CURSOR_MODEL", "composer-2.5") },
    local: { cwd: process.cwd() },
  });
  console.log(result.result ?? "(no final text)");
  process.exit(reportResult("local smoke", result));
} catch (err) {
  process.exit(reportStartupFailure(err));
}
