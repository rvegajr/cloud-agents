/**
 * Step 0: authenticate once.
 *
 * Opens a browser login and stores a 90-day user API key in ~/.cursor/sdk/auth.json.
 * Every other script in this kit will find it automatically. If you'd rather use
 * a key from cursor.com/dashboard/integrations, put it in .env as CURSOR_API_KEY
 * and skip this.
 */
import { Cursor } from "@cursor/sdk";
import { loadEnv } from "./lib/env.js";
import { resolveApiKey } from "./lib/auth.js";

loadEnv();

const apiKey = await resolveApiKey({ interactive: true });
const me = await Cursor.me({ apiKey });
console.log(`Authenticated as ${me.userEmail ?? "(service account)"} via key "${me.apiKeyName}"`);

const status = await Cursor.auth.status();
if (status.status === "logged-in" && status.apiKeyExpiresAtMs) {
  console.log(`Stored login expires ${new Date(status.apiKeyExpiresAtMs).toLocaleDateString()}`);
}
