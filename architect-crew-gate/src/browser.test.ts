import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_TOOLS, browserFromEnv, browserToolNote, qwenMcpConfigArg, scenarioNeedsBrowser } from "./browser.js";

test("browserFromEnv: Playwright MCP headless and isolated by default, off on request, custom flags honoured", () => {
  const def = browserFromEnv({})!;
  assert.equal(def.command, "npx");
  assert.deepEqual(def.args, ["-y", "@playwright/mcp@latest", "--headless", "--isolated"]);
  for (const off of ["0", "off", "none", "false"]) assert.equal(browserFromEnv({ QA_BROWSER: off }), undefined, off);
  assert.deepEqual(browserFromEnv({ QA_BROWSER: "playwright", PLAYWRIGHT_MCP_ARGS: "--headless --browser firefox" })!.args, ["-y", "@playwright/mcp@latest", "--headless", "--browser", "firefox"]);
  assert.throws(() => browserFromEnv({ QA_BROWSER: "selenium" }), /only "playwright"/);
});

test("qwenMcpConfigArg: one --mcp-config value, trusted, with a generous start timeout, env only when given", () => {
  const arg = qwenMcpConfigArg({ playwright: browserFromEnv({})!, other: { command: "o", args: ["-x"], env: { A: "1" } } });
  const parsed = JSON.parse(arg);
  assert.equal(parsed.mcpServers.playwright.command, "npx");
  assert.ok(parsed.mcpServers.playwright.args.includes("--headless"));
  assert.equal(parsed.mcpServers.playwright.trust, true);
  assert.equal(parsed.mcpServers.playwright.timeout, 120_000);
  assert.equal(parsed.mcpServers.playwright.env, undefined);
  assert.deepEqual(parsed.mcpServers.other.env, { A: "1" });
});

test("browserToolNote names every tool when a browser is present and forbids inference when it is not", () => {
  const yes = browserToolNote(true);
  for (const t of BROWSER_TOOLS) assert.ok(yes.includes(`\`${t}\``), t);
  assert.match(yes, /never through curl/);
  assert.match(yes, /browser_console_messages/);
  const no = browserToolNote(false);
  assert.match(no, /No browser tool is available/);
  assert.match(no, /no browser available/);
  assert.doesNotMatch(no, /browser_navigate/);
});

test("scenarioNeedsBrowser: page steps yes; shell, HTTP, SQL, and CLI steps no", () => {
  for (const yes of ["open http://localhost:3000/ and click Save", "in a browser with devtools open", "type ids into the search box", "click the button named Copy", "navigate to /settings"]) assert.equal(scenarioNeedsBrowser(yes), true, yes);
  for (const no of ["curl -s -X POST localhost:4571/api/snippets", "run the loader; SELECT count(*) FROM rows", "psql -c 'select 1'", "node dist/cli.js --help exits 0", "restart the server; GET /api/snippets lists it"]) assert.equal(scenarioNeedsBrowser(no), false, no);
  assert.match(browserToolNote("unneeded"), /no browser is attached/);
  assert.equal(browserToolNote("available"), browserToolNote(true));
  assert.equal(browserToolNote("absent"), browserToolNote(false));
});
