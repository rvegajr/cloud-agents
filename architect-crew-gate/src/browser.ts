
/**
 * The QA analyst's browser (PATTERN.md section 3, stage 4). A Playwright MCP
 * server gives any tool-using model — local through qwen-code, frontier through
 * the Claude SDK — a real headless browser: navigate, read the accessibility
 * snapshot, click and type by element ref, screenshot. TDD proves the code;
 * this proves the flows a user would actually walk.
 */

export interface McpStdioServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Tool names the Playwright MCP server exposes; the prompt lists them so a small model does not guess. */
export const BROWSER_TOOLS = [
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_press_key",
  "browser_wait_for",
  "browser_evaluate",
  "browser_take_screenshot",
  "browser_console_messages",
  "browser_close",
] as const;

/**
 * `QA_BROWSER=playwright` (the default) gives the QA analyst a headless, isolated
 * Chromium through `@playwright/mcp`; `QA_BROWSER=0|off|none` runs QA without one.
 * `PLAYWRIGHT_MCP_ARGS` replaces the default flags (`--headless --isolated`).
 */
export function browserFromEnv(env: NodeJS.ProcessEnv = process.env): McpStdioServer | undefined {
  const raw = (env.QA_BROWSER ?? "playwright").trim().toLowerCase();
  if (!raw || ["0", "off", "none", "false", "no"].includes(raw)) return undefined;
  if (raw !== "playwright") throw new Error(`QA_BROWSER=${raw}: only "playwright" or off is supported`);
  const extra = (env.PLAYWRIGHT_MCP_ARGS ?? "--headless --isolated").split(/\s+/).filter(Boolean);
  return { command: "npx", args: ["-y", "@playwright/mcp@latest", ...extra] };
}

/**
 * The value for qwen-code's `--mcp-config` flag. Servers given on the command
 * line are session-scoped: not written to any settings file, not subject to the
 * project-server approval store (a `.qwen/settings.json` entry would sit at
 * "Pending approval" until a person accepted it), and gone when the turn ends.
 * `trust` skips per-call confirmation, which `--yolo` does anyway.
 */
export function qwenMcpConfigArg(servers: Record<string, McpStdioServer>): string {
  const mcpServers: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(servers)) {
    mcpServers[name] = { command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}), trust: true, timeout: 120_000 };
  }
  return JSON.stringify({ mcpServers });
}

/**
 * Does a scenario's text describe steps on a page? Only those scenarios get a
 * browser; an ETL, database, CLI, or library job never names one and its QA
 * turns run without the server or the browser section of the prompt.
 */
const BROWSER_STEP = /\b(in (a|the) browser|browser|web ?page|open (the )?page|open https?:\/\/|navigate to|click(s|ed|ing)?\b|type(s|d)? into|button (named|labell?ed)|field (named|labell?ed)|search box|devtools)\b/i;

export function scenarioNeedsBrowser(text: string): boolean {
  return BROWSER_STEP.test(text);
}

/**
 * The `## Browser` section of the QA prompt: `available` (the server is attached),
 * `absent` (a scenario needs one but the run has none), or `unneeded` (nothing in
 * this batch happens on a page).
 */
export function browserToolNote(mode: boolean | "available" | "absent" | "unneeded"): string {
  const m = mode === true ? "available" : mode === false ? "absent" : mode;
  if (m === "unneeded") {
    return "None of these scenarios happens on a page; no browser is attached. Execute them with the commands they name (shell, HTTP, SQL, the CLI).";
  }
  if (m === "absent") {
    return (
      "No browser tool is available in this run. For a scenario whose steps need a browser (a page, a click, typing " +
      "into a field), do what can be verified over HTTP against the same routes and mark its evidence `(no browser; HTTP " +
      "only)`. It passes only if every `Then` is observable that way; a `Then` that is only visible in a browser fails " +
      'with `observed: "no browser available"`. Never claim a browser result you did not see.'
    );
  }
  return (
    "You have a real headless browser through the `playwright` tool server. Its tools: " +
    BROWSER_TOOLS.map((t) => `\`${t}\``).join(", ") +
    ". Any scenario or step that names a page, a URL to open, a click, typing, a button, a field, or \"in a browser\" " +
    "runs in this browser, never through curl:\n\n" +
    "1. `browser_navigate` to the URL the scenario gives (the server you started from the README).\n" +
    "2. `browser_snapshot`: the accessibility tree, one `ref` per interactive element. Find elements by their role and " +
    "name in this tree; do not guess selectors.\n" +
    "3. Act with `browser_click` / `browser_type` / `browser_fill_form` / `browser_press_key` using those refs. For " +
    "\"as the user types\", type one character at a time and snapshot between characters.\n" +
    "4. `browser_snapshot` again (or `browser_wait_for` the expected text first) and compare to `Then`.\n" +
    "5. Evidence for a browser step is the lines of the snapshot that show the state `Then` describes (the card's text, " +
    "the button's label, the count of results), quoted verbatim.\n\n" +
    "Clipboard: after a copy action, read it with `browser_evaluate` and `navigator.clipboard.readText()`; if the headless " +
    "browser refuses, say so and use the button's label change plus the text rendered on the page as the evidence. " +
    "Check `browser_console_messages` once per page: an uncaught error in the console is a defect even when the " +
    "page looks right. `browser_close` when done. The first tool call may take a few seconds while the server starts."
  );
}
