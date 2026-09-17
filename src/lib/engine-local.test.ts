import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLocalCommand,
  executorNote,
  localConfigFromEnv,
  makeLocalSend,
  modelIsPulled,
  transcriptContext,
  type ExecFn,
  type LocalConfig,
} from "./engine-local.js";

const cfg: LocalConfig = { host: "http://localhost:11434", model: "qwen3-coder-next", plannerModel: "gpt-oss:120b", runner: "qwen", timeoutMs: 1000 };

test("localConfigFromEnv defaults and normalisation", () => {
  const d = localConfigFromEnv({});
  assert.equal(d.host, "http://localhost:11434");
  assert.equal(d.model, "qwen3-coder-next");
  assert.equal(d.plannerModel, "qwen3-coder-next");
  assert.equal(d.runner, "qwen");
  assert.equal(d.timeoutMs, 30 * 60_000);
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
