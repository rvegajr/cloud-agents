import type { Run } from "@cursor/sdk";

export interface StreamOptions {
  /** Print model text as it arrives. Default true. */
  text?: boolean;
  /** Print tool call names/status. Default true. */
  tools?: boolean;
  /** Print reasoning text. Default false: noisy, and cloud models may not emit it. */
  thinking?: boolean;
}

/**
 * Consume `run.stream()` and print a readable transcript. Returns nothing;
 * callers still call `run.wait()` for the terminal result. Streaming is how
 * you observe, waiting is how you get the answer.
 */
export async function printStream(run: Run, opts: StreamOptions = {}): Promise<void> {
  const { text = true, tools = true, thinking = false } = opts;
  let lastWasText = false;

  const nl = () => {
    if (lastWasText) {
      process.stdout.write("\n");
      lastWasText = false;
    }
  };

  for await (const event of run.stream()) {
    switch (event.type) {
      case "assistant":
        if (!text) break;
        for (const block of event.message.content) {
          if (block.type === "text") {
            process.stdout.write(block.text);
            lastWasText = true;
          }
        }
        break;
      case "thinking":
        if (thinking) {
          process.stdout.write(`\x1b[2m${event.text}\x1b[0m`);
          lastWasText = true;
        }
        break;
      case "tool_call":
        if (!tools) break;
        nl();
        console.log(`\x1b[36m[tool]\x1b[0m ${event.name} ${event.status}${summarizeArgs(event.args)}`);
        break;
      case "status":
        nl();
        console.log(`\x1b[33m[status]\x1b[0m ${event.status}${event.message ? ` - ${event.message}` : ""}`);
        break;
      case "usage":
        nl();
        console.log(
          `\x1b[2m[usage] in=${event.usage.inputTokens} out=${event.usage.outputTokens} total=${event.usage.totalTokens}\x1b[0m`,
        );
        break;
      default:
        break;
    }
  }
  nl();
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const hint = a.command ?? a.path ?? a.pattern ?? a.query ?? a.file_path ?? a.filePath;
  if (typeof hint !== "string") return "";
  const one = hint.replace(/\s+/g, " ");
  return `  ${one.length > 80 ? one.slice(0, 77) + "..." : one}`;
}
