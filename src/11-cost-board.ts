/**
 * Print the factory cost board: each AI provider on its own meter, by day and project.
 *
 *   npm run cost-board
 */
import { loadEnv } from "./lib/env.js";
import { buildStateDir } from "./lib/build-app.js";
import { formatCostBoard, loadFactoryCosts } from "./lib/cost-ledger.js";

loadEnv();
console.log(formatCostBoard(loadFactoryCosts(buildStateDir())));
