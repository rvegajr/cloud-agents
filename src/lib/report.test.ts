import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJsonBlock } from "./report.js";

test("extractJsonBlock: plain fenced block", () => {
  const text = 'Done.\n\n```json\n{ "ready": true, "title": "x" }\n```\n';
  assert.deepEqual(extractJsonBlock(text), { ready: true, title: "x" });
});

test("extractJsonBlock: takes the last block when several are present", () => {
  const text = '```json\n{ "n": 1 }\n```\ntext\n```json\n{ "n": 2 }\n```';
  assert.deepEqual(extractJsonBlock(text), { n: 2 });
});

test("extractJsonBlock: a fenced code block inside a JSON string does not truncate the block", () => {
  // What triage actually returned: the brief is Markdown and carries its own
  // ```bash fence. A non-greedy ``` match stops at that inner fence.
  const brief = "# Title\n\n## Verification\n\nFrom repo root:\n\n```bash\npnpm test\n```\n\n- [ ] exits 0";
  const text = `Here is the brief.\n\n\`\`\`json\n${JSON.stringify({ ready: true, brief })}\n\`\`\`\n`;
  const out = extractJsonBlock<{ ready: boolean; brief: string }>(text);
  assert.ok(out, "block should parse");
  assert.equal(out.ready, true);
  assert.equal(out.brief, brief);
});

test("extractJsonBlock: nested fences with a later, unrelated json block still returns the last valid one", () => {
  const inner = "```json\n{ \"ignored\": true }\n```";
  const text =
    `\`\`\`json\n${JSON.stringify({ first: true, note: inner })}\n\`\`\`\n` +
    `and then\n\`\`\`json\n{ "second": true }\n\`\`\``;
  assert.deepEqual(extractJsonBlock(text), { second: true });
});

test("extractJsonBlock: unterminated or invalid block returns undefined", () => {
  assert.equal(extractJsonBlock("```json\n{ not json"), undefined);
  assert.equal(extractJsonBlock("no block here"), undefined);
  assert.equal(extractJsonBlock(undefined), undefined);
});
