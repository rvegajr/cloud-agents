/**
 * `@<bot> <project> deploy [env=<name>]` — the bot process (never the cloud
 * agent; the repo hook blocks agents from deploying) kicks a deploy and reports
 * back to the thread.
 *
 * Providers:
 *   vercel:<deploy-hook-url>                       POST the hook; watch with VERCEL_TOKEN
 *   railway:<projectId>/<environment>/<service>    serviceInstanceDeployV2 via GraphQL;
 *                                                  environment/service may be names or ids;
 *                                                  `svc1+svc2` deploys several
 *
 * `SLACK_DEPLOYS` maps `<project>[/<env>]=<provider>:<spec>`; comma-separated.
 * `web=vercel:…` is the default target; `api/uat=railway:…` is `env=uat`.
 */

export type DeployStatus = "queued" | "building" | "ready" | "failed" | "canceled" | "unknown";

export interface DeployTarget {
  project: string;
  env: string;
  provider: "vercel" | "railway";
  spec: string;
}

export interface DeployProgress {
  status: DeployStatus;
  /** Dashboard / inspector URL for humans. */
  inspectUrl?: string;
  /** Public URL once live. */
  liveUrl?: string;
  detail?: string;
}

export interface DeployStarted {
  label: string;
  inspectUrl?: string;
  /** Poll until terminal; resolves with final state. Undefined when watching is not configured. */
  watch?: (onUpdate: (p: DeployProgress) => Promise<void>) => Promise<DeployProgress>;
  /** Tail of the build log for a failed deploy, if the provider can supply one. */
  failureLog?: () => Promise<string | undefined>;
}

export interface DeployCredentials {
  vercelToken?: string;
  vercelTeamId?: string;
  railwayToken?: string;
  /** Project tokens use a different header than account/workspace tokens. */
  railwayTokenKind?: "account" | "project";
}

export const DEFAULT_ENV = "default";
const TERMINAL: ReadonlySet<DeployStatus> = new Set(["ready", "failed", "canceled"]);

export function parseDeploys(raw: string | undefined): Map<string, DeployTarget[]> {
  const out = new Map<string, DeployTarget[]>();
  if (!raw?.trim()) return out;
  for (const entry of raw.split(/[,\s]+/)) {
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    const key = entry.slice(0, eq).trim().replace(/^#/, "").toLowerCase();
    const value = entry.slice(eq + 1).trim();
    const colon = value.indexOf(":");
    if (!key || colon === -1) continue;
    const provider = value.slice(0, colon).toLowerCase();
    const spec = value.slice(colon + 1);
    if ((provider !== "vercel" && provider !== "railway") || !spec) continue;
    const slash = key.indexOf("/");
    const project = slash === -1 ? key : key.slice(0, slash);
    const env = slash === -1 ? DEFAULT_ENV : key.slice(slash + 1) || DEFAULT_ENV;
    const list = out.get(project) ?? [];
    const idx = list.findIndex((t) => t.env === env);
    const target: DeployTarget = { project, env, provider, spec };
    if (idx === -1) list.push(target);
    else list[idx] = target;
    out.set(project, list);
  }
  return out;
}

/** `env` omitted → the `default` entry, else the only entry. */
export function pickDeployTarget(
  targets: DeployTarget[] | undefined,
  env: string | undefined,
): { target?: DeployTarget; reason?: "no-targets" | "unknown-env" | "ambiguous" } {
  if (!targets?.length) return { reason: "no-targets" };
  if (env) {
    const found = targets.find((t) => t.env === env.toLowerCase());
    return found ? { target: found } : { reason: "unknown-env" };
  }
  const def = targets.find((t) => t.env === DEFAULT_ENV);
  if (def) return { target: def };
  if (targets.length === 1) return { target: targets[0] };
  return { reason: "ambiguous" };
}

export function describeTarget(t: DeployTarget): string {
  if (t.provider === "vercel") {
    const prj = t.spec.match(/\/deploy\/(prj_[A-Za-z0-9]+)/)?.[1];
    return `vercel${prj ? ` ${prj}` : ""}`;
  }
  const { projectId, environment, services } = parseRailwaySpec(t.spec);
  return `railway ${projectId.slice(0, 8)}… ${environment} ${services.join("+")}`;
}

export function formatDeployUsage(opts: {
  bot: string;
  project: string;
  targets: DeployTarget[];
  implied: boolean;
  problem?: string;
}): string {
  const { bot, project } = opts;
  const name = opts.implied ? "" : `${project} `;
  const lines: string[] = [];
  if (opts.problem) {
    lines.push(opts.problem);
    lines.push("");
  }
  lines.push("```");
  lines.push(`usage: ${bot} ${name}deploy [env=<name>]`);
  lines.push("");
  if (opts.targets.length) {
    lines.push("targets:");
    const width = Math.max(...opts.targets.map((t) => t.env.length));
    for (const t of opts.targets) {
      const mark = t.env === DEFAULT_ENV ? "  (env= omitted)" : "";
      lines.push(`  ${t.env.padEnd(width)}  ${describeTarget(t)}${mark}`);
    }
    lines.push("");
    lines.push("examples:");
    lines.push(`  ${bot} ${name}deploy`);
    const named = opts.targets.find((t) => t.env !== DEFAULT_ENV);
    if (named) lines.push(`  ${bot} ${name}deploy env=${named.env}`);
  } else {
    lines.push(`no deploy targets for ${project}. add one to SLACK_DEPLOYS:`);
    lines.push(`  ${project}=vercel:https://api.vercel.com/v1/integrations/deploy/prj_…/…`);
    lines.push(`  ${project}/uat=railway:<projectId>/uat/web+api`);
  }
  lines.push("```");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Vercel

interface VercelDeployment {
  uid: string;
  url?: string;
  state?: string;
  readyState?: string;
  created?: number;
  createdAt?: number;
  inspectorUrl?: string;
  meta?: Record<string, string>;
}

async function vercelApi<T>(path: string, token: string, teamId: string | undefined): Promise<T> {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`vercel ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function vercelStatus(state: string | undefined): DeployStatus {
  switch ((state ?? "").toUpperCase()) {
    case "QUEUED":
    case "INITIALIZING":
      return "queued";
    case "BUILDING":
      return "building";
    case "READY":
      return "ready";
    case "ERROR":
      return "failed";
    case "CANCELED":
      return "canceled";
    default:
      return "unknown";
  }
}

async function startVercel(target: DeployTarget, creds: DeployCredentials, sleep: Sleep): Promise<DeployStarted> {
  const hookUrl = target.spec;
  const projectId = hookUrl.match(/\/deploy\/(prj_[A-Za-z0-9]+)/)?.[1];
  const startedAt = Date.now();
  const res = await fetch(hookUrl, { method: "POST" });
  if (!res.ok) throw new Error(`vercel deploy hook → ${res.status} ${await res.text()}`);
  const body = (await res.json().catch(() => ({}))) as { job?: { id?: string; state?: string } };
  const label = `vercel${projectId ? ` ${projectId}` : ""}${body.job?.id ? ` job ${body.job.id}` : ""}`;

  if (!creds.vercelToken || !projectId) return { label };

  const token = creds.vercelToken;
  const teamId = creds.vercelTeamId;
  let found: VercelDeployment | undefined;

  const locate = async (): Promise<VercelDeployment | undefined> => {
    const data = await vercelApi<{ deployments?: VercelDeployment[] }>(
      `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=5&since=${startedAt - 60_000}`,
      token,
      teamId,
    );
    const list = (data.deployments ?? []).filter((d) => (d.created ?? d.createdAt ?? 0) >= startedAt - 60_000);
    list.sort((a, b) => (b.created ?? b.createdAt ?? 0) - (a.created ?? a.createdAt ?? 0));
    return list[0];
  };

  const progressOf = (d: VercelDeployment): DeployProgress => ({
    status: vercelStatus(d.readyState ?? d.state),
    inspectUrl: d.inspectorUrl,
    liveUrl: d.url ? `https://${d.url}` : undefined,
    detail: d.meta?.githubCommitRef ? `${d.meta.githubCommitRef}@${(d.meta.githubCommitSha ?? "").slice(0, 7)}` : undefined,
  });

  return {
    label,
    watch: async (onUpdate) => {
      for (let i = 0; i < 12 && !found; i++) {
        await sleep(5_000);
        found = await locate();
      }
      if (!found) return { status: "unknown", detail: "deploy hook accepted, but no deployment appeared within 60s" };
      let last = progressOf(found);
      await onUpdate(last);
      const deadline = Date.now() + 30 * 60_000;
      while (!TERMINAL.has(last.status) && Date.now() < deadline) {
        await sleep(10_000);
        const d = await vercelApi<VercelDeployment>(`/v13/deployments/${found.uid}`, token, teamId);
        const next = progressOf({ ...found, ...d });
        if (next.status !== last.status) await onUpdate(next);
        last = next;
      }
      return last;
    },
    failureLog: async () => {
      if (!found) return undefined;
      const events = await vercelApi<Array<{ type?: string; payload?: { text?: string } }>>(
        `/v3/deployments/${found.uid}/events?limit=400`,
        token,
        teamId,
      ).catch(() => []);
      const lines = events.map((e) => e.payload?.text ?? "").filter(Boolean);
      return lines.length ? lines.slice(-25).join("\n") : undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Railway

export function parseRailwaySpec(spec: string): { projectId: string; environment: string; services: string[] } {
  const [projectId = "", environment = "", servicePart = ""] = spec.split("/");
  const services = servicePart.split("+").map((s) => s.trim()).filter(Boolean);
  if (!projectId || !environment || !services.length) {
    throw new Error(`railway spec must be <projectId>/<environment>/<service>[+<service>], got "${spec}"`);
  }
  return { projectId: projectId.trim(), environment: environment.trim(), services };
}

async function railwayGql<T>(query: string, variables: Record<string, unknown>, creds: DeployCredentials): Promise<T> {
  if (!creds.railwayToken) throw new Error("RAILWAY_API_TOKEN is not set; railway deploys need it.");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (creds.railwayTokenKind === "project") headers["Project-Access-Token"] = creds.railwayToken;
  else headers.Authorization = `Bearer ${creds.railwayToken}`;
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message: string }> };
  if (!res.ok || json.errors?.length) {
    throw new Error(`railway api → ${res.status} ${json.errors?.map((e) => e.message).join("; ") ?? ""}`.trim());
  }
  return json.data as T;
}

function railwayStatus(state: string | undefined): DeployStatus {
  switch ((state ?? "").toUpperCase()) {
    case "QUEUED":
    case "WAITING":
    case "INITIALIZING":
    case "NEEDS_APPROVAL":
      return "queued";
    case "BUILDING":
    case "DEPLOYING":
      return "building";
    case "SUCCESS":
    case "SLEEPING":
      return "ready";
    case "FAILED":
    case "CRASHED":
      return "failed";
    case "REMOVED":
    case "REMOVING":
    case "SKIPPED":
      return "canceled";
    default:
      return "unknown";
  }
}

interface RailwayProjectInfo {
  project: {
    name: string;
    environments: { edges: Array<{ node: { id: string; name: string } }> };
    services: { edges: Array<{ node: { id: string; name: string } }> };
  };
}

async function startRailway(target: DeployTarget, creds: DeployCredentials, sleep: Sleep): Promise<DeployStarted> {
  const { projectId, environment, services } = parseRailwaySpec(target.spec);
  const info = await railwayGql<RailwayProjectInfo>(
    `query p($id: String!) { project(id: $id) { name
       environments { edges { node { id name } } }
       services { edges { node { id name } } } } }`,
    { id: projectId },
    creds,
  );
  const envs = info.project.environments.edges.map((e) => e.node);
  const svcs = info.project.services.edges.map((e) => e.node);
  const env = envs.find((e) => e.id === environment || e.name.toLowerCase() === environment.toLowerCase());
  if (!env) throw new Error(`railway: no environment "${environment}" in ${info.project.name} (have ${envs.map((e) => e.name).join(", ")})`);
  const picked = services.map((s) => {
    const svc = svcs.find((x) => x.id === s || x.name.toLowerCase() === s.toLowerCase());
    if (!svc) throw new Error(`railway: no service "${s}" in ${info.project.name} (have ${svcs.map((x) => x.name).join(", ")})`);
    return svc;
  });

  const deployments: Array<{ service: string; id: string }> = [];
  for (const svc of picked) {
    const data = await railwayGql<{ serviceInstanceDeployV2: string }>(
      `mutation d($serviceId: String!, $environmentId: String!) {
         serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }`,
      { serviceId: svc.id, environmentId: env.id },
      creds,
    );
    deployments.push({ service: svc.name, id: data.serviceInstanceDeployV2 });
  }

  const inspectUrl = `https://railway.com/project/${projectId}?environmentId=${env.id}`;
  const label = `railway ${info.project.name} / ${env.name} / ${picked.map((s) => s.name).join(" + ")}`;
  const lastById = new Map<string, { status: DeployStatus; url?: string }>();

  const fetchOne = async (id: string) => {
    const d = await railwayGql<{ deployment: { status: string; url?: string; staticUrl?: string } }>(
      `query d($id: String!) { deployment(id: $id) { status url staticUrl } }`,
      { id },
      creds,
    );
    const url = d.deployment.staticUrl ?? d.deployment.url;
    return { status: railwayStatus(d.deployment.status), url: url ? (url.startsWith("http") ? url : `https://${url}`) : undefined };
  };

  const combine = (): DeployProgress => {
    const states = deployments.map((d) => lastById.get(d.id)?.status ?? "queued");
    let status: DeployStatus = "ready";
    if (states.includes("failed")) status = "failed";
    else if (states.includes("canceled")) status = "canceled";
    else if (states.some((s) => s === "building")) status = "building";
    else if (states.some((s) => s === "queued" || s === "unknown")) status = "queued";
    const live = deployments.map((d) => lastById.get(d.id)?.url).filter((u): u is string => Boolean(u));
    const detail = deployments
      .map((d) => `${d.service}: ${lastById.get(d.id)?.status ?? "queued"}`)
      .join(", ");
    return { status, inspectUrl, liveUrl: live[0], detail };
  };

  return {
    label,
    inspectUrl,
    watch: async (onUpdate) => {
      let last: DeployProgress = { status: "queued", inspectUrl };
      const deadline = Date.now() + 30 * 60_000;
      while (Date.now() < deadline) {
        await sleep(10_000);
        for (const d of deployments) lastById.set(d.id, await fetchOne(d.id));
        const next = combine();
        if (next.status !== last.status || next.detail !== last.detail) await onUpdate(next);
        last = next;
        if (TERMINAL.has(last.status)) break;
      }
      return last;
    },
    failureLog: async () => {
      const failed = deployments.find((d) => lastById.get(d.id)?.status === "failed");
      if (!failed) return undefined;
      const data = await railwayGql<{ buildLogs: Array<{ message: string }> }>(
        `query l($deploymentId: String!, $limit: Int) { buildLogs(deploymentId: $deploymentId, limit: $limit) { message } }`,
        { deploymentId: failed.id, limit: 200 },
        creds,
      ).catch(() => ({ buildLogs: [] as Array<{ message: string }> }));
      const lines = data.buildLogs.map((l) => l.message).filter(Boolean);
      return lines.length ? `${failed.service}:\n${lines.slice(-25).join("\n")}` : undefined;
    },
  };
}

// ---------------------------------------------------------------------------

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startDeploy(
  target: DeployTarget,
  creds: DeployCredentials,
  sleep: Sleep = realSleep,
): Promise<DeployStarted> {
  return target.provider === "vercel" ? startVercel(target, creds, sleep) : startRailway(target, creds, sleep);
}

/**
 * Same names the Railway CLI uses: `RAILWAY_API_TOKEN` is an account/workspace
 * token (Bearer); `RAILWAY_TOKEN` is a project token (Project-Access-Token header).
 */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): DeployCredentials {
  const account = env.RAILWAY_API_TOKEN?.trim();
  const project = env.RAILWAY_TOKEN?.trim();
  return {
    vercelToken: env.VERCEL_TOKEN?.trim() || undefined,
    vercelTeamId: env.VERCEL_TEAM_ID?.trim() || undefined,
    railwayToken: account || project || undefined,
    railwayTokenKind: account ? "account" : "project",
  };
}

export function statusEmoji(status: DeployStatus): string {
  switch (status) {
    case "ready":
      return "✅";
    case "failed":
      return "❌";
    case "canceled":
      return "⏹️";
    case "building":
      return "🔨";
    case "queued":
      return "⏳";
    default:
      return "❔";
  }
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
