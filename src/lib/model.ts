import type { ModelSelection } from "@cursor/sdk";

export const DEFAULT_CURSOR_MODEL = "composer-2.5";

/**
 * Cursor's product default for composer-2.5 (and Grok) is the Fast variant,
 * which bills ~6× regular. Every Agent.create / Agent.prompt in this kit goes
 * through here so Fast stays off unless we deliberately change this file.
 */
export function selectModel(id?: string): ModelSelection {
  const modelId = id?.trim() || process.env.CURSOR_MODEL?.trim() || DEFAULT_CURSOR_MODEL;
  return {
    id: modelId,
    params: [{ id: "fast", value: "false" }],
  };
}
