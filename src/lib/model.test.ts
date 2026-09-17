import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CURSOR_MODEL, selectModel } from "./model.js";

test("selectModel pins Fast off on the default composer id", () => {
  const saved = process.env.CURSOR_MODEL;
  delete process.env.CURSOR_MODEL;
  try {
    const model = selectModel();
    assert.equal(model.id, DEFAULT_CURSOR_MODEL);
    assert.deepEqual(model.params, [{ id: "fast", value: "false" }]);
  } finally {
    if (saved === undefined) delete process.env.CURSOR_MODEL;
    else process.env.CURSOR_MODEL = saved;
  }
});

test("selectModel keeps an explicit override id but still disables Fast", () => {
  const model = selectModel("grok-4.6");
  assert.equal(model.id, "grok-4.6");
  assert.deepEqual(model.params, [{ id: "fast", value: "false" }]);
});
