import { Cursor } from "@cursor/sdk";

/**
 * Resolve credentials in the order the SDK itself uses:
 *   1. CURSOR_API_KEY
 *   2. A key minted earlier by `Cursor.auth.login()` (~/.cursor/sdk/auth.json)
 *   3. Interactive browser login (only when `interactive` is true)
 *
 * Returns the key when we have one in hand, or undefined to let the SDK fall
 * back to its stored login. Every script passes the result as `apiKey` so the
 * credential dependency is explicit.
 */
export async function resolveApiKey(opts: { interactive?: boolean } = {}): Promise<string | undefined> {
  const fromEnv = process.env.CURSOR_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const status = await Cursor.auth.status();
  if (status.status === "logged-in") {
    const exp = status.apiKeyExpiresAtMs;
    if (exp && exp < Date.now()) {
      console.error("Stored Cursor login has expired.");
    } else {
      return undefined; // SDK will use the stored login
    }
  }

  if (!opts.interactive) {
    throw new Error(
      "Not authenticated. Either set CURSOR_API_KEY (cursor.com/dashboard/integrations) or run `npm run login`.",
    );
  }

  console.error("No credentials found; opening browser login...");
  const { apiKey, email } = await Cursor.auth.login({
    apiKeyName: "cloud-agents kit",
    onLoginUrl: (url) => console.error(`If the browser did not open, visit:\n  ${url}`),
  });
  console.error(`Logged in${email ? ` as ${email}` : ""}. Key stored in ~/.cursor/sdk/auth.json.`);
  return apiKey;
}
