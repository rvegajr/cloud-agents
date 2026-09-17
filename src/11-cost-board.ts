/**
 * Print the factory cost board: each AI provider on its own meter, by day and project.
 *
 *   npm run cost-board
 */
import { loadEnv } from "./lib/env.js";
import { buildStateDir } from "./lib/build-app.js";
import { defaultLedgerPath, formatCostBoard, loadCostLedger } from "./lib/cost-ledger.js";

loadEnv();
console.log(formatCostBoard(loadCostLedger(defaultLedgerPath(buildStateDir()))));
