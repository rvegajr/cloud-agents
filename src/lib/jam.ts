/**
 * Pull a jam.dev recording into the Slack prompt so the cloud agent can see
 * console errors, failed requests, and what the reporter actually did.
 * Cloud VMs do not have Jam MCP; this process fetches the evidence first.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const JAM_ID_RE =
  /(?:https?:\/\/)?(?:www\.)?jam\.dev\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

const MAX_EVIDENCE = 40_000;

export function extractJamIds(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(JAM_ID_RE)) {
    const id = m[1]!.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function jamShareUrl(id: string): string {
  return `https://jam.dev/c/${id}`;
}

export async function loadJamEvidence(text: string): Promise<string> {
  const ids = extractJamIds(text);
  if (ids.length === 0) {
    return "(no jam.dev link in this message — if they described a bug in prose only, triage from that)";
  }
  const blocks: string[] = [];
  for (const id of ids.slice(0, 3)) {
    try {
      blocks.push(await fetchOneJam(id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      blocks.push(`## Jam ${jamShareUrl(id)}\nCould not fetch recording details (${msg}). Still treat this URL as the repro: use Jam MCP or \`jam --json get\` if available.`);
    }
  }
  const out = blocks.join("\n\n");
  return out.length > MAX_EVIDENCE ? `${out.slice(0, MAX_EVIDENCE)}\n\n(truncated)` : out;
}

async function fetchOneJam(id: string): Promise<string> {
  const jam = await jamJson(["get", "jam", id]);
  if (jam) return formatCliJam(id, jam);

  const publicPage = await fetchPublicSummary(id);
  if (publicPage) return publicPage;

  return `## Jam ${jamShareUrl(id)}\nNo Jam CLI/token on this host, and the public page had no details. The URL is still the repro — read it with Jam MCP (\`getDetails\`, \`getConsoleLogs\` errors, \`getNetworkRequests\` 4xx/5xx, \`getUserEvents\`, \`analyzeVideo\`) or \`jam --json get\`.`;
}

async function formatCliJam(id: string, jam: Record<string, unknown>): Promise<string> {
  const title = str(jam.title) || id;
  const originalUrl = str(jam.originalUrl);
  const type = str(jam.type);
  const origin = str(jam.origin);
  const description = proseMirrorToText(jam.description);
  const lines = [
    `## Jam ${jamShareUrl(id)}`,
    `Title: ${title}`,
    `Type: ${type || "unknown"}  origin: ${origin || "unknown"}`,
    originalUrl ? `Recorded URL: ${originalUrl}` : "",
    description ? `Notes from reporter:\n${description}` : "Notes from reporter: (none)",
  ];

  const chapters = await jamJson(["get", "chapters", id]);
  if (chapters && Array.isArray(chapters.chapters)) {
    const rows = (chapters.chapters as Array<{ startMs?: number; title?: string }>)
      .slice(0, 12)
      .map((c) => `- ${fmtMs(c.startMs)} ${c.title ?? ""}`.trim());
    if (rows.length) lines.push("Chapters:\n" + rows.join("\n"));
  }

  const intents = await jamJson(["get", "intents", id]);
  const intentList = Array.isArray(intents?.value) ? intents.value : [];
  if (intentList.length) {
    const summaries = intentList.slice(0, 8).map((it) => {
      const row = it as {
        userGoal?: string;
        summary?: string;
        blockers?: string[];
        findings?: Array<{ type?: string; description?: string }>;
        technicalIssues?: string[];
        pageUrl?: string;
      };
      const bits = [
        row.userGoal ? `Goal: ${row.userGoal}` : "",
        row.pageUrl ? `Page: ${row.pageUrl}` : "",
        row.summary ? row.summary : "",
        (row.blockers ?? []).length ? `Blockers: ${row.blockers!.join("; ")}` : "",
        (row.findings ?? [])
          .filter((f) => f.type === "error" || f.type === "bug")
          .map((f) => `Finding: ${f.description}`)
          .join("\n"),
        (row.technicalIssues ?? []).slice(0, 4).map((t) => `Tech: ${t}`).join("\n"),
      ].filter(Boolean);
      return bits.join("\n");
    });
    lines.push("What happened in the recording:\n" + summaries.join("\n\n"));
  }

  const consoleJson = await jamJson(["get", "console", id, "--level", "error", "--limit", "25"]);
  const consoleLines = formatConsole(consoleJson);
  if (consoleLines.length) lines.push(`Console errors (${consoleLines.length}):\n` + consoleLines.join("\n"));

  const networkJson = await jamJson(["get", "network", id, "--status", "4xx,5xx", "--limit", "25"]);
  const netLines = formatNetwork(networkJson);
  if (netLines.length) lines.push(`Failed network (${netLines.length}):\n` + netLines.join("\n"));

  return lines.filter((l) => l !== "").join("\n");
}

function formatConsole(data: Record<string, unknown> | undefined): string[] {
  const items = Array.isArray(data?.items) ? data.items : [];
  const out: string[] = [];
  for (const raw of items.slice(0, 25)) {
    const item = raw as { data?: { payload?: { payload?: unknown; level?: string; trace?: string[] } }; tabInfo?: { url?: string } };
    const payload = item.data?.payload;
    const msg = flattenConsoleMsg(payload?.payload);
    if (!msg) continue;
    const page = item.tabInfo?.url ?? "";
    out.push(`- ${msg.slice(0, 400)}${page ? `  (${page})` : ""}`);
  }
  return out;
}

function formatNetwork(data: Record<string, unknown> | undefined): string[] {
  const items = Array.isArray(data?.items) ? data.items : [];
  const out: string[] = [];
  for (const raw of items.slice(0, 25)) {
    const item = raw as {
      data?: { payload?: { entry?: { name?: string }; fetchDetails?: { method?: string; status?: number; statusText?: string } } };
      tabInfo?: { url?: string };
    };
    const entry = item.data?.payload?.entry;
    const fd = item.data?.payload?.fetchDetails;
    const url = entry?.name ?? "";
    if (!url) continue;
    const method = fd?.method ?? "GET";
    const status = fd?.status ?? "";
    out.push(`- ${method} ${status} ${url}`);
  }
  return out;
}

function flattenConsoleMsg(payload: unknown): string {
  if (typeof payload === "string") return payload.replace(/^"|"$/g, "");
  if (Array.isArray(payload)) return payload.map((p) => String(p).replace(/^"|"$/g, "")).join(" ");
  if (payload && typeof payload === "object") return JSON.stringify(payload).slice(0, 400);
  return "";
}

function proseMirrorToText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") {
    try {
      return proseMirrorToText(JSON.parse(node));
    } catch {
      return node;
    }
  }
  if (Array.isArray(node)) return node.map(proseMirrorToText).filter(Boolean).join("\n");
  if (typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.text) return n.text;
  const inner = (n.content ?? []).map(proseMirrorToText).join(n.type === "paragraph" || n.type === "heading" ? "\n" : "");
  return inner.trim();
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function fmtMs(ms: number | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

async function jamJson(args: string[]): Promise<Record<string, unknown> | undefined> {
  const result = await runJam(["--json", ...args]);
  if (!result.ok || !result.stdout.trim()) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

let jamBinPromise: Promise<string | undefined> | undefined;

/** Install the Jam CLI once if JAM_TOKEN is set and `jam` is not on PATH. */
export function ensureJamBin(): Promise<string | undefined> {
  if (!jamBinPromise) jamBinPromise = installJamIfNeeded();
  return jamBinPromise;
}

async function installJamIfNeeded(): Promise<string | undefined> {
  const homeBin = join(homedir(), ".local/bin/jam");
  const candidates = [process.env.JAM_BIN?.trim(), "jam", homeBin].filter((x): x is string => Boolean(x));
  for (const bin of candidates) {
    const probe = await spawnOnce(bin, ["--version"]);
    if (probe.ok) return bin;
  }
  const hasAuth =
    Boolean(process.env.JAM_TOKEN?.trim()) || existsSync(join(homedir(), ".config/jam/credentials.json"));
  if (!hasAuth) return undefined;
  await spawnOnce("bash", ["-lc", "curl -fsSL https://native.jam.dev/install | bash"], 60_000);
  const after = await spawnOnce(homeBin, ["--version"]);
  return after.ok ? homeBin : undefined;
}

async function runJam(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const bin = (await ensureJamBin()) || "jam";
  return spawnOnce(bin, args);
}

async function spawnOnce(
  bin: string,
  args: string[],
  timeoutMs = 25_000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const env = { ...process.env, PATH: `${join(homedir(), ".local/bin")}:${process.env.PATH ?? ""}` };
  return await new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, stdout: "", stderr: `cannot spawn ${bin}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

async function fetchPublicSummary(id: string): Promise<string | undefined> {
  try {
    const res = await fetch(jamShareUrl(id), {
      headers: { Accept: "text/markdown, text/plain, text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return undefined;
    const body = (await res.text()).trim();
    if (!body) return undefined;
    return `## Jam ${jamShareUrl(id)}\nPublic summary (events need Jam CLI/MCP):\n${body.slice(0, 4000)}`;
  } catch {
    return undefined;
  }
}
