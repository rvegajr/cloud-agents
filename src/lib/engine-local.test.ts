import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLocalCommand,
  continuationNote,
  executorNote,
  localConfigFromEnv,
  makeLocalSend,
  modelIsPulled,
  transcriptContext,
  wasInterrupted,
  type ExecFn,
  type LocalConfig,
} from "./engine-local.js";

const cfg: LocalConfig = { host: "http://localhost:11434", model: "qwen3-coder-next", plannerModel: "gpt-oss:120b", runner: "qwen", timeoutMs: 1000, continuations: 2 };

test("localConfigFromEnv defaults and normalisation", () => {
  const d = localConfigFromEnv({});
  assert.equal(d.host, "http://localhost:11434");
  assert.equal(d.model, "qwen3-coder-next");
  assert.equal(d.plannerModel, "qwen3-coder-next");
  assert.equal(d.runner, "qwen");
  assert.equal(d.timeoutMs, 30 * 60_000);
  assert.equal(d.continuations, 2);
  assert.equal(localConfigFromEnv({ LOCAL_TURN_CONTINUATIONS: "0" }).continuations, 0);
  const c = localConfigFromEnv({ OLLAMA_HOST: "box.tail:11434/", LOCAL_MODEL: "qwen3.6:35b-coding", LOCAL_RUNNER: "Aider", LOCAL_PLANNER_MODEL: "gpt-oss:120b", LOCAL_TURN_TIMEOUT_MIN: "5" });
  assert.equal(c.host, "http://box.tail:11434");
  assert.equal(c.runner, "aider");
  assert.equal(c.plannerModel, "gpt-oss:120b");
  assert.equal(c.timeoutMs, 300_000);
});

test("modelIsPulled treats an untagged name as :latest", () => {
  assert.equal(modelIsPulled("qwen3-coder-next", ["qwen3-coder-next:latest"]), true);
  assert.equal(modelIsPulled("qwen3.6:35b-coding", ["qwen3.6:35b-coding"]), true);
  assert.equal(modelIsPulled("qwen3.6:35b-coding", ["qwen3.6:27b-coding"]), false);
});

test("qwen-code command is headless and reaches Ollama through the OpenAI endpoint only", () => {
  const saved = { ...process.env };
  process.env.SLACK_BOT_TOKEN = "xoxb-secret";
  process.env.GITHUB_TOKEN = "ghp-secret";
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "max-token";
  try {
    const cmd = buildLocalCommand(cfg, "qwen3-coder-next", "do it");
    assert.equal(cmd.file, "qwen");
    assert.deepEqual(cmd.args.slice(0, 4), ["--auth-type", "openai", "--yolo", "--model"]);
    assert.equal(cmd.args.at(-1), "do it");
    assert.equal(cmd.env.OPENAI_BASE_URL, "http://localhost:11434/v1");
    assert.equal(cmd.env.OPENAI_API_KEY, "ollama");
    assert.equal(cmd.env.SLACK_BOT_TOKEN, undefined);
    assert.equal(cmd.env.GITHUB_TOKEN, undefined);
    assert.equal(cmd.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  } finally {
    process.env = saved;
  }
});

test("aider command never auto-commits (the orchestrator commits)", () => {
  const cmd = buildLocalCommand({ ...cfg, runner: "aider" }, "qwen3-coder:30b", "do it");
  assert.equal(cmd.file, "aider");
  assert.ok(cmd.args.includes("--no-auto-commits"));
  assert.ok(cmd.args.includes("--yes-always"));
  assert.equal(cmd.args[cmd.args.indexOf("--model") + 1], "ollama_chat/qwen3-coder:30b");
  assert.equal(cmd.env.OLLAMA_API_BASE, "http://localhost:11434");
});

test("makeLocalSend maps exit codes to turn status and reports timing", async () => {
  const calls: string[] = [];
  const ok: ExecFn = async (cmd) => {
    calls.push(cmd.args.at(-1)!);
    return { stdout: "done\n```json\n{\"done\":true}\n```", stderr: "", code: 0 };
  };
  const infos: number[] = [];
  const send = makeLocalSend({ cwd: "/tmp", cfg, exec: ok, onTurn: (i) => infos.push(i.code) });
  const t = await send("prompt A");
  assert.equal(t.status, "finished");
  assert.match(t.result!, /done/);
  assert.deepEqual(calls, ["prompt A"]);
  assert.deepEqual(infos, [0]);

  const bad: ExecFn = async () => ({ stdout: "partial", stderr: "boom", code: 124 });
  const t2 = await makeLocalSend({ cwd: "/tmp", cfg, exec: bad })("prompt B");
  assert.equal(t2.status, "error");
  assert.equal(t2.result, "partial");
});

test("transcriptContext replays only the last three turns, newest last", () => {
  assert.equal(transcriptContext(undefined), "");
  assert.equal(transcriptContext([]), "");
  const ctx = transcriptContext([
    { kind: "plan", tier: "claude", result: "PLAN" },
    { kind: "implement", tier: "local", result: "IMPL" },
    { kind: "verify", tier: "local", result: "V1" },
    { kind: "verify", tier: "claude", result: "V2" },
  ]);
  assert.ok(!ctx.includes("PLAN"), "oldest turn dropped");
  assert.ok(ctx.indexOf("IMPL") < ctx.indexOf("V1") && ctx.indexOf("V1") < ctx.indexOf("V2"));
  assert.match(ctx, /You have no memory of earlier turns/);
});

test("executorNote names the model and demands verbatim plans", () => {
  const n = executorNote("qwen3-coder-next");
  assert.match(n, /qwen3-coder-next/);
  assert.match(n, /exact code/);
  assert.match(n, /verification commands/);
});

test("wasInterrupted recognises the qwen-code cap and our timeout, not ordinary failures", () => {
  assert.equal(wasInterrupted({ code: 1, stdout: "", stderr: "Loop detection halted the run (turn_tool_call_cap: ...)" }), true);
  assert.equal(wasInterrupted({ code: 124, stdout: "", stderr: "" }), true);
  assert.equal(wasInterrupted({ code: 1, stdout: "", stderr: "No auth type is selected" }), false);
  assert.equal(wasInterrupted({ code: 0, stdout: "", stderr: "" }), false);
});

test("makeLocalSend continues an interrupted turn with a continuation note, up to the limit", async () => {
  const prompts: string[] = [];
  let n = 0;
  const cap: ExecFn = async (cmd) => {
    prompts.push(cmd.args.at(-1)!);
    n++;
    return n < 3
      ? { stdout: "", stderr: "Loop detection halted the run (turn_tool_call_cap)", code: 1 }
      : { stdout: "### Report\ndone", stderr: "", code: 0 };
  };
  const codes: number[] = [];
  const t = await makeLocalSend({ cwd: "/tmp", cfg, exec: cap, onTurn: (i) => codes.push(i.code) })("BASE PROMPT");
  assert.equal(t.status, "finished");
  assert.deepEqual(codes, [1, 1, 0]);
  assert.equal(prompts[0], "BASE PROMPT");
  assert.match(prompts[1]!, /^## Continuation \(attempt 1\)/);
  assert.match(prompts[2]!, /^## Continuation \(attempt 2\)/);
  assert.ok(prompts[2]!.endsWith("BASE PROMPT"));

  n = 0;
  prompts.length = 0;
  const always: ExecFn = async (cmd) => {
    prompts.push(cmd.args.at(-1)!);
    return { stdout: "partial", stderr: "turn_tool_call_cap", code: 1 };
  };
  const t2 = await makeLocalSend({ cwd: "/tmp", cfg, exec: always })("P");
  assert.equal(t2.status, "error");
  assert.equal(prompts.length, 3, "original + 2 continuations");

  prompts.length = 0;
  const auth: ExecFn = async (cmd) => {
    prompts.push(cmd.args.at(-1)!);
    return { stdout: "", stderr: "No auth type is selected", code: 1 };
  };
  const t3 = await makeLocalSend({ cwd: "/tmp", cfg, exec: auth })("P");
  assert.equal(t3.status, "error");
  assert.equal(prompts.length, 1, "ordinary failures are not retried");
  assert.match(continuationNote(1, 870), /870s/);
});

test("a browser turn hands qwen-code the Playwright server with --mcp-config for that turn only; aider and plain turns get nothing", async () => {
  const browser = { command: "npx", args: ["-y", "@playwright/mcp@latest", "--headless", "--isolated"] };
  const withMcp = buildLocalCommand(cfg, "m", "p", { mcpServers: { playwright: browser } });
  const i = withMcp.args.indexOf("--mcp-config");
  assert.ok(i > 0, withMcp.args.join(" "));
  const parsed = JSON.parse(withMcp.args[i + 1]!);
  assert.equal(parsed.mcpServers.playwright.command, "npx");
  assert.equal(parsed.mcpServers.playwright.trust, true);
  assert.equal(withMcp.args.at(-1), "p", "the prompt stays last");
  assert.ok(!buildLocalCommand(cfg, "m", "p").args.includes("--mcp-config"));
  assert.ok(!buildLocalCommand(cfg, "m", "p", { mcpServers: {} }).args.includes("--mcp-config"));
  assert.ok(!buildLocalCommand({ ...cfg, runner: "aider" }, "m", "p", { mcpServers: { playwright: browser } }).args.includes("--mcp-config"));

  const seen: string[][] = [];
  const exec = async (cmd: { args: string[] }) => {
    seen.push(cmd.args);
    return { stdout: "ok", stderr: "", code: 0 };
  };
  const send = makeLocalSend({ cwd: "/tmp", cfg, exec, browser });
  await send("qa turn", { mode: "agent", fresh: true, cwd: "/tmp/clone", browser: true });
  await send("crew turn", { mode: "agent" });
  assert.ok(seen[0]!.includes("--mcp-config"), "QA turn carries the server");
  assert.ok(!seen[1]!.includes("--mcp-config"), "a crew turn does not");
  const noBrowser = makeLocalSend({ cwd: "/tmp", cfg, exec });
  await noBrowser("qa turn", { browser: true });
  assert.ok(!seen[2]!.includes("--mcp-config"), "QA_BROWSER off: asked, none attached");
});
