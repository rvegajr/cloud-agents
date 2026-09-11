/**
 * HTTP control plane for the same mention → job path the Slack bot runs.
 * Pure request parsing lives here so tests do not need a listening server.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";

export interface JobsBody {
  project?: string;
  request?: string;
  text?: string;
  channel?: string;
  thread_ts?: string;
  model?: string;
  /** Post `<@bot> …` with the dispatcher token; do not run the job here. */
  as_mention?: boolean;
}

export interface JobRecord {
  id: string;
  status: "accepted" | "running" | "done" | "failed" | "need-info" | "usage";
  createdAt: string;
  channel?: string;
  threadTs?: string;
  agentId?: string;
  kind?: string;
  posts: string[];
  prUrl?: string;
  error?: string;
}

export class JobStore {
  private records = new Map<string, JobRecord>();

  create(partial: Partial<JobRecord> = {}): JobRecord {
    const rec: JobRecord = {
      id: partial.id ?? `job-${randomBytes(8).toString("hex")}`,
      status: partial.status ?? "accepted",
      createdAt: partial.createdAt ?? new Date().toISOString(),
      posts: partial.posts ?? [],
      channel: partial.channel,
      threadTs: partial.threadTs,
      agentId: partial.agentId,
      kind: partial.kind,
      prUrl: partial.prUrl,
      error: partial.error,
    };
    this.records.set(rec.id, rec);
    return rec;
  }

  get(id: string): JobRecord | undefined {
    return this.records.get(id);
  }

  list(): JobRecord[] {
    return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  patch(id: string, patch: Partial<JobRecord>): JobRecord | undefined {
    const cur = this.records.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, posts: patch.posts ?? cur.posts };
    this.records.set(id, next);
    return next;
  }

  appendPost(id: string, text: string): void {
    const cur = this.records.get(id);
    if (!cur) return;
    cur.posts.push(text);
  }
}

export function authorize(header: string | undefined, token: string): boolean {
  if (!token) return false;
  const raw = header?.trim() ?? "";
  const bearer = raw.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const given = bearer || raw;
  return given.length > 0 && given === token;
}

export function parseJobsBody(raw: unknown): { ok: true; body: JobsBody } | { ok: false; error: string } {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "JSON object required" };
  }
  const o = raw as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : undefined);
  const body: JobsBody = {
    project: str("project"),
    request: str("request"),
    text: str("text"),
    channel: str("channel"),
    thread_ts: str("thread_ts") ?? str("threadTs"),
    model: str("model"),
    as_mention: o.as_mention === true || o.asMention === true,
  };
  return { ok: true, body };
}

/** Build the mention text the Slack CLI already understands. */
export function mentionText(body: JobsBody, botUserId: string): string {
  if (body.text) return body.text;
  const mention = botUserId ? `<@${botUserId}>` : "";
  const project = body.project ? ` ${body.project}` : "";
  const model = body.model ? ` model=${body.model}` : "";
  const request = body.request ? ` ${body.request}` : "";
  return `${mention}${project}${model}${request}`.trim();
}

export function jobsListenPort(): number | undefined {
  const explicit = process.env.JOBS_API_PORT?.trim();
  if (explicit) {
    const n = Number(explicit);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (process.env.JOBS_API_TOKEN?.trim() || process.env.PORT?.trim()) {
    const n = Number(process.env.PORT || "8787");
    return Number.isFinite(n) && n > 0 ? n : 8787;
  }
  return undefined;
}

export interface JobsHttpHandlers {
  token: string;
  store: JobStore;
  health: () => Record<string, unknown>;
  projects: () => unknown;
  startJob: (body: JobsBody, job: JobRecord) => Promise<void>;
  postMention: (body: JobsBody) => Promise<{ ts?: string; channel: string }>;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export async function handleJobsHttp(
  req: IncomingMessage,
  res: ServerResponse,
  handlers: JobsHttpHandlers,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = (req.method ?? "GET").toUpperCase();
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (method === "GET" && (path === "/health" || path === "/")) {
    send(res, 200, path === "/health" ? handlers.health() : { ...handlers.health(), endpoints: [
      "GET /health",
      "GET /v1/projects",
      "GET /v1/jobs",
      "GET /v1/jobs/:id",
      "POST /v1/jobs",
      "POST /v1/mentions",
    ] });
    return;
  }

  if (!authorize(req.headers.authorization, handlers.token)) {
    send(res, 401, { ok: false, error: "Authorization: Bearer $JOBS_API_TOKEN required" });
    return;
  }

  if (method === "GET" && path === "/v1/projects") {
    send(res, 200, { ok: true, projects: handlers.projects() });
    return;
  }

  if (method === "GET" && path === "/v1/jobs") {
    send(res, 200, { ok: true, jobs: handlers.store.list() });
    return;
  }

  const jobMatch = path.match(/^\/v1\/jobs\/([^/]+)$/);
  if (method === "GET" && jobMatch) {
    const rec = handlers.store.get(jobMatch[1]!);
    if (!rec) {
      send(res, 404, { ok: false, error: "unknown job" });
      return;
    }
    send(res, 200, { ok: true, job: rec });
    return;
  }

  if (method === "POST" && (path === "/v1/jobs" || path === "/v1/mentions")) {
    let parsed: ReturnType<typeof parseJobsBody>;
    try {
      parsed = parseJobsBody(await readJson(req));
    } catch (err) {
      send(res, 400, { ok: false, error: err instanceof Error ? err.message : "invalid JSON" });
      return;
    }
    if (!parsed.ok) {
      send(res, 400, { ok: false, error: parsed.error });
      return;
    }
    const body = parsed.body;
    const asMention = path === "/v1/mentions" || body.as_mention;
    if (asMention) {
      if (!body.channel) {
        send(res, 400, { ok: false, error: "channel is required for as_mention / POST /v1/mentions" });
        return;
      }
      try {
        const posted = await handlers.postMention(body);
        send(res, 200, { ok: true, via: "mention", ...posted });
      } catch (err) {
        send(res, 502, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (!body.request && !body.text) {
      send(res, 400, { ok: false, error: "request or text is required" });
      return;
    }
    const job = handlers.store.create({
      status: "accepted",
      channel: body.channel,
      threadTs: body.thread_ts,
    });
    send(res, 202, { ok: true, job });
    void handlers.startJob(body, job).catch((err) => {
      handlers.store.patch(job.id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return;
  }

  send(res, 404, { ok: false, error: `no ${method} ${path}` });
}

export function listenJobsHttp(handlers: JobsHttpHandlers, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    void handleJobsHttp(req, res, handlers).catch((err) => {
      if (!res.headersSent) send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}
