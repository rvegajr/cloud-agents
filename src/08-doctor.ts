/**
 * Preflight for the whole setup: prove every credential, scope, and grant the
 * kit needs before an agent is unleashed on a repo or a bot is left running.
 *
 * Read-only by construction. It never fires a deploy hook, never posts to
 * Slack, never creates or mutates anything — so it is safe to run on a
 * production bot's env whenever something looks wrong.
 *
 * Phases are the ones in IMPLEMENTATION-GUIDE.md:
 *   A bootstrap  B target repo  C Slack app  D local run
 *   E hosting    F deploy       G notifications  H Jam + ready-for-review
 *
 *   npm run doctor
 *   npm run doctor -- --phase C        one phase (also `A,C` or `A-D`)
 *   npm run doctor -- --json           machine-readable, for an agent
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Agent, Cursor } from "@cursor/sdk";
import { loadEnv, flags } from "./lib/env.js";
import { resolveApiKey } from "./lib/auth.js";
import { parseProjects } from "./lib/slack-cli.js";
import { parseAllowlist, parseChannelRepos } from "./lib/slack-thread.js";
import { credentialsFromEnv, parseDeploys, parseRailwaySpec, type DeployTarget } from "./lib/slack-deploy.js";
import {
  classifyGitHubToken,
  collectRepoRefs,
  CRITICAL_BOT_SCOPES,
  diffScopes,
  formatReport,
  hasRepoScope,
  isSlackChannelId,
  isSlackUserId,
  manifestBotScopes,
  normalizeRepoUrl,
  parsePhaseFilter,
  redactHook,
  slackTokenKind,
  summarize,
  validateRailwaySpec,
  validateVercelHook,
  type Check,
  type Phase,
  type Verdict,
} from "./lib/doctor.js";

loadEnv();
const args = flags();
const wanted = parsePhaseFilter(args.phase);
const asJson = args.json === "true" || args.json === "";
const checks: Check[] = [];

function add(phase: Phase, group: string, name: string, verdict: Verdict, detail: string, fix?: string): void {
  checks.push({ phase, group, name, verdict, detail, ...(fix ? { fix } : {}) });
}

/** A phase nobody asked for costs nothing: skip the requests, not just the output. */
function want(...phases: Phase[]): boolean {
  return phases.some((p) => wanted.has(p));
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function envVar(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

async function run(bin: string, argv: string[], timeoutMs = 20_000): Promise<{ ok: boolean; out: string }> {
  const env = { ...process.env, PATH: `${join(homedir(), ".local/bin")}:${process.env.PATH ?? ""}`, GIT_TERMINAL_PROMPT: "0" };
  return await new Promise((resolve) => {
    const child = spawn(bin, argv, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr?.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, out: `cannot spawn ${bin}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out: out.trim() });
    });
  });
}

// ---------------------------------------------------------------------------
// Config read once, so every phase sees the same picture the bot would.

const targetRef = envVar("TARGET_REF") ?? "main";
const targetRepo = envVar("TARGET_REPO");
const projects = parseProjects(process.env.SLACK_PROJECTS, targetRef);
const routes = parseChannelRepos(process.env.SLACK_CHANNEL_REPOS, targetRef);
const repoRefs = collectRepoRefs({ targetRepo, targetRef, projects, routes });
const deploys = parseDeploys(process.env.SLACK_DEPLOYS);
const deployTargets: DeployTarget[] = [...deploys.values()].flat();

// ---------------------------------------------------------------------------
// Phase A — Cursor account, model, and the GitHub grant the VM clones with

async function checkCursor(): Promise<void> {
  // resolveApiKey returns the key, or undefined when the stored browser login is
  // usable, and throws when there is no credential at all.
  let key: string | undefined;
  try {
    key = await resolveApiKey();
  } catch (err) {
    add("A", "cursor", "credentials", "fail", msg(err), "set CURSOR_API_KEY (cursor.com/dashboard/integrations) or run `npm run login`");
    return;
  }
  const creds = key ? { apiKey: key } : {};
  const source = envVar("CURSOR_API_KEY")
    ? "CURSOR_API_KEY"
    : existsSync(join(homedir(), ".cursor/sdk/auth.json"))
      ? "~/.cursor/sdk/auth.json (does not travel to a server — phase E needs a real key)"
      : "unknown";

  try {
    const me = await Cursor.me(creds);
    add("A", "cursor", "account", "pass", `${me.userEmail ?? "(service account)"} via ${source}`);
  } catch (err) {
    add("A", "cursor", "account", "fail", msg(err), "the key is set but rejected; mint a new one at cursor.com/dashboard/integrations");
    return;
  }

  const model = envVar("CURSOR_MODEL") ?? "composer-2.5";
  try {
    const models = await Cursor.models.list(creds);
    const ids = models.map((m) => m.id);
    if (ids.includes(model)) add("A", "cursor", "model", "pass", model);
    else add("A", "cursor", "model", "fail", `CURSOR_MODEL=${model} is not available to this account`, `pick one of: ${ids.slice(0, 8).join(", ")}`);
  } catch (err) {
    add("A", "cursor", "model", "warn", `could not list models (${msg(err)})`, "retry; the key worked for Cursor.me so this is usually transient");
  }

  // The grant that lets a Cloud Agent clone. Distinct from your own git access,
  // which phase B checks — they fail independently and for different reasons.
  try {
    const repos = await Cursor.repositories.list(creds);
    const connected = new Set(repos.map((r) => normalizeRepoUrl(r.url)));
    if (!repoRefs.length) {
      add("A", "cursor", "github grant", "warn", "no repo configured yet", "set TARGET_REPO in .env, then re-run");
    }
    for (const ref of repoRefs) {
      if (connected.has(normalizeRepoUrl(ref.repo))) {
        add("A", "cursor", `github grant ${ref.source}`, "pass", ref.repo);
      } else {
        add(
          "A",
          "cursor",
          `github grant ${ref.source}`,
          "fail",
          `${ref.repo} is not connected to Cursor`,
          "HUMAN GATE: cursor.com/agents → connect GitHub → grant this repo",
        );
      }
    }
  } catch (err) {
    add("A", "cursor", "github grant", "fail", msg(err), "cursor.com/agents → connect GitHub");
  }
}

// ---------------------------------------------------------------------------
// Phase B — your own git access, and the agent-ready files in the target repo

async function checkGit(): Promise<void> {
  if (!repoRefs.length) {
    add("B", "git", "target repo", "skip", "no repo configured");
    return;
  }
  for (const ref of repoRefs) {
    const res = await run("git", ["ls-remote", "--heads", ref.repo, ref.ref], 25_000);
    if (!res.ok) {
      add("B", "git", `${ref.source} access`, "fail", `git ls-remote failed: ${res.out.split("\n").slice(-1)[0] ?? ""}`, "add your SSH key to GitHub, or `gh auth login`");
      continue;
    }
    if (res.out.trim() === "") {
      add("B", "git", `${ref.source} branch`, "fail", `${ref.repo} has no branch "${ref.ref}"`, "TARGET_REF (or the @ref in SLACK_PROJECTS) must name the integration branch");
      continue;
    }
    add("B", "git", `${ref.source} @${ref.ref}`, "pass", ref.repo);
  }
}

/**
 * The kit's guardrails only work if they are in the *target* repo. We can check
 * that for a local checkout; for a remote-only repo it is the human's word.
 */
function checkTargetRepoKit(): void {
  const candidate = envVar("TARGET_REPO_PATH");
  if (!candidate) {
    add("B", "repo kit", "AGENTS.md + .cursor", "skip", "set TARGET_REPO_PATH to a local checkout to check it here", "otherwise confirm by hand: AGENTS.md, .cursor/hooks.json, .cursor/rules/");
    return;
  }
  if (!existsSync(candidate)) {
    add("B", "repo kit", "checkout", "fail", `TARGET_REPO_PATH=${candidate} does not exist`, "point it at a clone of the target repo");
    return;
  }
  for (const rel of ["AGENTS.md", ".cursor/hooks.json", ".cursor/hooks/guard-shell.mjs"]) {
    const path = join(candidate, rel);
    if (existsSync(path)) add("B", "repo kit", rel, "pass", path);
    else add("B", "repo kit", rel, "fail", `missing in ${candidate}`, "cp target-repo-kit/AGENTS.md and cp -R target-repo-kit/.cursor into the target repo");
  }
  const agents = join(candidate, "AGENTS.md");
  if (existsSync(agents)) {
    const body = readFileSync(agents, "utf8");
    // The shipped template's own words; still present means nobody filled it in.
    if (body.includes("One paragraph. What it does, who uses it")) {
      add("B", "repo kit", "AGENTS.md filled in", "warn", "still the unedited template", "fill in Layout, Commands, and Never — the agent reads this before every run");
    } else {
      add("B", "repo kit", "AGENTS.md filled in", "pass", `${body.split("\n").length} lines`);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase C/D — Slack tokens, scopes, channels, members

interface SlackCall {
  ok: boolean;
  body: Record<string, unknown>;
  scopes: string | null;
  error?: string;
}

async function slack(method: string, token: string, params: Record<string, string> = {}): Promise<SlackCall> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: body.ok === true,
      body,
      scopes: res.headers.get("x-oauth-scopes"),
      ...(typeof body.error === "string" ? { error: body.error } : {}),
    };
  } catch (err) {
    return { ok: false, body: {}, scopes: null, error: msg(err) };
  }
}

async function checkSlack(): Promise<void> {
  const botToken = envVar("SLACK_BOT_TOKEN");
  const appToken = envVar("SLACK_APP_TOKEN");

  if (!botToken) {
    add("C", "slack", "SLACK_BOT_TOKEN", "fail", "not set", "HUMAN GATE: api.slack.com/apps → Install App → Bot User OAuth Token (xoxb-)");
  }
  if (!appToken) {
    add("C", "slack", "SLACK_APP_TOKEN", "fail", "not set", "HUMAN GATE: Basic Information → App-Level Tokens, scope connections:write (xapp-)");
  }

  if (appToken) {
    if (slackTokenKind(appToken) !== "app") {
      add("C", "slack", "app token kind", "fail", "SLACK_APP_TOKEN is not an xapp- token", "app-level tokens start with xapp-; the xoxb- one goes in SLACK_BOT_TOKEN");
    } else {
      // Returns a short-lived wss URL. We ask for one and never connect: it is
      // the only way to prove connections:write without starting the bot.
      const conn = await slack("apps.connections.open", appToken);
      if (conn.ok) add("C", "slack", "socket mode", "pass", "apps.connections.open accepted (connections:write)");
      else add("C", "slack", "socket mode", "fail", conn.error ?? "rejected", "regenerate the app-level token with the connections:write scope");
    }
  }

  if (!botToken) return;
  if (slackTokenKind(botToken) !== "bot") {
    add("C", "slack", "bot token kind", "warn", `SLACK_BOT_TOKEN looks like a ${slackTokenKind(botToken)} token`, "the bot wants the xoxb- Bot User OAuth Token");
  }

  const auth = await slack("auth.test", botToken);
  if (!auth.ok) {
    add("C", "slack", "auth.test", "fail", auth.error ?? "rejected", "reinstall the app and copy the Bot User OAuth Token again");
    return;
  }
  const botUser = typeof auth.body.user === "string" ? auth.body.user : "?";
  const botUserId = typeof auth.body.user_id === "string" ? auth.body.user_id : "";
  add("C", "slack", "auth.test", "pass", `@${botUser} in ${String(auth.body.team ?? "?")}`);

  // Diff what the install actually granted against what the manifest asked for.
  let required: string[] = [];
  try {
    required = manifestBotScopes(JSON.parse(readFileSync("slack-app-manifest.json", "utf8")));
  } catch (err) {
    add("C", "slack", "manifest", "warn", `could not read slack-app-manifest.json (${msg(err)})`, "run this from the kit root");
  }
  if (required.length) {
    const diff = diffScopes(auth.scopes, required);
    const criticalMissing = diff.missing.filter((s) => (CRITICAL_BOT_SCOPES as readonly string[]).includes(s));
    if (criticalMissing.length) {
      add("C", "slack", "bot scopes", "fail", `missing ${criticalMissing.join(", ")}`, "add the scopes in api.slack.com/apps → OAuth & Permissions, then reinstall");
    } else if (diff.missing.length) {
      add(
        "C",
        "slack",
        "bot scopes",
        "warn",
        `missing ${diff.missing.join(", ")} (the bot degrades: #name routing and its own display name need channels:read / users:read)`,
        "add them and reinstall, or accept the degraded behaviour",
      );
    } else {
      add("C", "slack", "bot scopes", "pass", `all ${required.length} manifest scopes granted`);
    }
  }

  // Channels: every allowlisted id. Phase F only borrows the token, so skip the
  // per-channel round trips unless phase C is actually being checked.
  const allowlist = want("C") ? parseAllowlist(process.env.SLACK_ALLOWED_CHANNELS) : [];
  if (want("C") && !allowlist.length) {
    add("C", "slack", "channel allowlist", "warn", "SLACK_ALLOWED_CHANNELS is empty — any channel the bot is in can start jobs", "set it to the C… ids you actually want (right-click channel → Copy link)");
  }
  const ids = allowlist.filter(isSlackChannelId);
  for (const bad of allowlist.filter((c) => !isSlackChannelId(c))) {
    add("C", "slack", `channel ${bad}`, "warn", "not a C… id, so it is matched by name only", "prefer the channel id from Copy link");
  }
  for (const id of ids) {
    const info = await slack("conversations.info", botToken, { channel: id });
    if (!info.ok) {
      add("C", "slack", `channel ${id}`, "fail", info.error ?? "not found", info.error === "channel_not_found" ? "wrong id, or the bot is not in a private channel it was never invited to" : "check the id and the bot's scopes");
      continue;
    }
    const ch = (info.body.channel ?? {}) as { name?: string; is_member?: boolean };
    if (ch.is_member === false) {
      add("C", "slack", `channel #${ch.name ?? id}`, "fail", "the bot is not a member", `HUMAN GATE: /invite @${botUser} in #${ch.name ?? id}`);
    } else {
      add("C", "slack", `channel #${ch.name ?? id}`, "pass", id);
    }
  }

  // Deployers and the optional Cursor-app pointer are member ids, not channels.
  const deployers = parseAllowlist(process.env.SLACK_DEPLOYERS).map((u) => u.replace(/^<@|>$/g, ""));
  for (const u of deployers) {
    if (!isSlackUserId(u)) {
      add("F", "slack", `deployer ${u}`, "fail", "not a U… member id", "profile → ⋮ → Copy member ID");
      continue;
    }
    const info = await slack("users.info", botToken, { user: u });
    if (info.ok) {
      const user = (info.body.user ?? {}) as { name?: string };
      add("F", "slack", `deployer ${u}`, "pass", user.name ?? "resolved");
    } else {
      add("F", "slack", `deployer ${u}`, "warn", info.error ?? "not resolved", info.error === "missing_scope" ? "users:read is not granted; the id is still honoured" : "check the member id");
    }
  }
  const cursorUser = envVar("SLACK_CURSOR_USER_ID");
  if (cursorUser) {
    const info = await slack("users.info", botToken, { user: cursorUser });
    if (info.ok) add("C", "slack", "cursor app pointer", "pass", `mentions of ${cursorUser} get a pointer to @${botUser}`);
    else add("C", "slack", "cursor app pointer", "warn", info.error ?? "not resolved", "leave SLACK_CURSOR_USER_ID empty unless Cursor's own app is installed too");
  }

  // Phase D is about routing being answerable at all, not about tokens.
  if (want("D")) {
    if (!repoRefs.length) {
      add("D", "routing", "targets", "fail", "no TARGET_REPO, SLACK_PROJECTS, or SLACK_CHANNEL_REPOS", "the bot exits at startup without one of these");
    } else {
      const names = [...projects.keys()];
      add("D", "routing", "targets", "pass", names.length ? `projects: ${names.join(", ")}` : `default ${targetRepo}@${targetRef}`);
    }
    const max = Number(process.env.SLACK_MAX_CONCURRENT ?? "2");
    if (!Number.isFinite(max) || max <= 0) add("D", "routing", "concurrency", "warn", `SLACK_MAX_CONCURRENT=${process.env.SLACK_MAX_CONCURRENT}`, "must be a positive number; the bot falls back to 2");
    else add("D", "routing", "concurrency", "pass", `SLACK_MAX_CONCURRENT=${max}`);
    if (botUserId) add("D", "routing", "bot user id", "pass", botUserId);
  }
}

// ---------------------------------------------------------------------------
// Phase D — this kit's own cloud agents, as a sign the loop has ever run

async function checkAgents(): Promise<void> {
  try {
    const key = envVar("CURSOR_API_KEY");
    const { items } = await Agent.list({ runtime: "cloud", ...(key ? { apiKey: key } : {}) });
    const mine = items.filter((a) => a.runtime === "cloud" && a.metadata?.kit === "cloud-agents");
    if (!mine.length) {
      add("D", "loop", "cloud agents", "warn", "no agent from this kit has run yet", "run `npm run pipeline -- --plan-only` or mention the bot once; the doctor cannot prove the loop for you");
      return;
    }
    const last = mine[0]!;
    add("D", "loop", "cloud agents", "pass", `${mine.length} from this kit; most recent ${last.agentId} (${last.status ?? "?"})`);
  } catch (err) {
    add("D", "loop", "cloud agents", "warn", msg(err), "phase A must be green first");
  }
}

// ---------------------------------------------------------------------------
// Phase E — the host that keeps the websocket open

async function checkHost(): Promise<void> {
  if (!existsSync("railway.json")) {
    add("E", "host", "railway.json", "warn", "not found", "any host that keeps one Node process alive works; this kit ships a Railway config");
  } else {
    add("E", "host", "railway.json", "pass", "start command runs `npm run slack` and restarts on failure");
  }

  const cli = await run("railway", ["--version"], 10_000);
  if (!cli.ok) {
    add("E", "host", "railway CLI", "skip", "not installed", "brew install railway (only needed to deploy and to SSH)");
    return;
  }
  add("E", "host", "railway CLI", "pass", cli.out.split("\n")[0] ?? "");

  const who = await run("railway", ["whoami"], 15_000);
  if (!who.ok) {
    add("E", "host", "railway login", "warn", "not logged in", "HUMAN GATE: `railway login` (browser flow)");
  } else {
    add("E", "host", "railway login", "pass", who.out.split("\n").slice(-1)[0] ?? "");
    const keys = await run("railway", ["ssh", "keys", "list"], 15_000);
    if (keys.ok && /ssh-|ed25519|rsa/i.test(keys.out)) {
      add("E", "host", "railway ssh key", "pass", "a key is registered, so you can debug the live container");
    } else {
      add("E", "host", "railway ssh key", "warn", "no key registered", "railway ssh keys add -k ~/.ssh/id_ed25519.pub -n \"laptop\"");
    }
  }

  // The one variable that does not travel: a browser login lives in $HOME.
  if (!envVar("CURSOR_API_KEY")) {
    add("E", "host", "CURSOR_API_KEY", "warn", "unset locally, so the stored browser login is in use", "the server needs a real key from cursor.com/dashboard/integrations");
  } else {
    add("E", "host", "CURSOR_API_KEY", "pass", "set, so it can be copied into the host's variables");
  }
}

// ---------------------------------------------------------------------------
// Phase F — deploy targets. Shapes are validated; nothing is ever fired.

async function vercelApi<T>(path: string, token: string, teamId?: string): Promise<T> {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function railwayGql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const creds = credentialsFromEnv();
  if (!creds.railwayToken) throw new Error("no Railway token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (creds.railwayTokenKind === "project") headers["Project-Access-Token"] = creds.railwayToken;
  else headers.Authorization = `Bearer ${creds.railwayToken}`;
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message: string }> };
  if (!res.ok || json.errors?.length) throw new Error(json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`);
  return json.data as T;
}

async function checkDeploys(): Promise<void> {
  if (!deployTargets.length) {
    add("F", "deploy", "SLACK_DEPLOYS", "skip", "no deploy targets configured", "optional: `@<bot> <project> deploy` needs one entry per project/env");
    return;
  }
  add("F", "deploy", "SLACK_DEPLOYS", "pass", `${deployTargets.length} target(s): ${[...deploys.keys()].join(", ")}`);

  const creds = credentialsFromEnv();
  const wantsVercel = deployTargets.some((t) => t.provider === "vercel");
  const wantsRailway = deployTargets.some((t) => t.provider === "railway");

  for (const t of deployTargets) {
    const label = `${t.project}/${t.env}`;
    if (t.provider === "vercel") {
      const v = validateVercelHook(t.spec);
      if (v.ok) add("F", "vercel", `hook ${label}`, "pass", `${v.detail} (${redactHook(t.spec)}) — not fired`);
      else add("F", "vercel", `hook ${label}`, "fail", v.detail, v.fix);
    } else {
      const v = validateRailwaySpec(t.spec);
      if (!v.ok) {
        add("F", "railway", `spec ${label}`, "fail", v.detail, v.fix);
        continue;
      }
      add("F", "railway", `spec ${label}`, "pass", v.detail);
    }
  }

  if (wantsVercel) {
    if (!creds.vercelToken) {
      add("F", "vercel", "VERCEL_TOKEN", "warn", "not set: the hook still fires, but the bot cannot report READY or FAILED", "vercel.com/account/tokens");
    } else {
      try {
        const me = await vercelApi<{ user?: { username?: string; email?: string } }>("/v2/user", creds.vercelToken);
        add("F", "vercel", "VERCEL_TOKEN", "pass", me.user?.username ?? me.user?.email ?? "authenticated");
      } catch (err) {
        add("F", "vercel", "VERCEL_TOKEN", "fail", msg(err), "mint a new token at vercel.com/account/tokens");
      }
      if (creds.vercelTeamId) {
        try {
          const team = await vercelApi<{ name?: string; slug?: string }>(`/v2/teams/${creds.vercelTeamId}`, creds.vercelToken);
          add("F", "vercel", "VERCEL_TEAM_ID", "pass", team.slug ?? team.name ?? creds.vercelTeamId);
        } catch (err) {
          add("F", "vercel", "VERCEL_TEAM_ID", "fail", msg(err), "team projects need the team id the token can see");
        }
      } else {
        add("F", "vercel", "VERCEL_TEAM_ID", "skip", "not set (personal-scope projects do not need it)");
      }
    }
  }

  if (wantsRailway) {
    if (!creds.railwayToken) {
      add("F", "railway", "token", "fail", "no RAILWAY_TOKEN or RAILWAY_API_TOKEN, so railway deploys will fail", "prefer a project token: target project → Settings → Tokens, scoped to one environment");
      return;
    }
    add("F", "railway", "token", "pass", `${creds.railwayTokenKind} token (${creds.railwayTokenKind === "project" ? "Project-Access-Token" : "Authorization: Bearer"})`);
    // Resolve every spec the way startRailway will: names must match real ones.
    for (const t of deployTargets.filter((x) => x.provider === "railway")) {
      const label = `${t.project}/${t.env}`;
      let parsed: { projectId: string; environment: string; services: string[] };
      try {
        parsed = parseRailwaySpec(t.spec);
      } catch {
        continue; // already reported above
      }
      try {
        const info = await railwayGql<{
          project: {
            name: string;
            environments: { edges: Array<{ node: { id: string; name: string } }> };
            services: { edges: Array<{ node: { id: string; name: string } }> };
          };
        }>(
          `query p($id: String!) { project(id: $id) { name
             environments { edges { node { id name } } }
             services { edges { node { id name } } } } }`,
          { id: parsed.projectId },
        );
        const envs = info.project.environments.edges.map((e) => e.node);
        const svcs = info.project.services.edges.map((e) => e.node);
        const env = envs.find((e) => e.id === parsed.environment || e.name.toLowerCase() === parsed.environment.toLowerCase());
        if (!env) {
          add("F", "railway", `resolve ${label}`, "fail", `no environment "${parsed.environment}" in ${info.project.name}`, `have: ${envs.map((e) => e.name).join(", ")}`);
          continue;
        }
        const missing = parsed.services.filter((s) => !svcs.some((x) => x.id === s || x.name.toLowerCase() === s.toLowerCase()));
        if (missing.length) {
          add("F", "railway", `resolve ${label}`, "fail", `no service ${missing.join(", ")} in ${info.project.name}`, `have: ${svcs.map((x) => x.name).join(", ")}`);
          continue;
        }
        add("F", "railway", `resolve ${label}`, "pass", `${info.project.name} / ${env.name} / ${parsed.services.join(" + ")}`);
      } catch (err) {
        add("F", "railway", `resolve ${label}`, "fail", msg(err), "a project token only reaches its own project; check the token and the projectId");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase G — nothing here is verifiable from outside, so print the checklist

function checkNotifications(): void {
  add(
    "G",
    "notifications",
    "vercel for slack",
    "skip",
    "not observable from here",
    "install vercel.com/integrations/slack/new, then per channel: /invite @Vercel, /vercel signin, /vercel subscribe <team>/<project>, tick Deployment Succeeded + Deployment Error",
  );
  add(
    "G",
    "notifications",
    "railway webhook",
    "skip",
    "not observable from here",
    "Slack app → Incoming Webhooks → On → Add to #<project>-fixbot, then Railway target project → Settings → Webhooks → paste; Deployment Deployed + Failed",
  );
  if (envVar("SLACK_DEPLOYS")) {
    add("G", "notifications", "manual vs auto", "pass", "SLACK_DEPLOYS is the manual `deploy` command; auto-deploy status comes from the integrations above, not from the bot");
  }
  add("G", "notifications", "proof", "skip", "a merge is the only real test", "merge to the integration branch and watch #<project>-fixbot for a deploy card");
}

// ---------------------------------------------------------------------------
// Phase H — Jam evidence, and the PAT that takes a PR out of draft

async function checkJam(): Promise<void> {
  const token = envVar("JAM_TOKEN");
  const storedCreds = existsSync(join(homedir(), ".config/jam/credentials.json"));
  if (!token && !storedCreds) {
    add("H", "jam", "JAM_TOKEN", "skip", "not set: the bot passes the URL through and the agent triages from prose", "jam.dev → Settings → MCP, scope mcp:read");
    return;
  }
  const version = await run("jam", ["--version"], 15_000);
  if (!version.ok) {
    add("H", "jam", "jam CLI", "warn", "not on PATH", "the bot self-installs it on first fetch (curl -fsSL https://native.jam.dev/install | bash)");
    return;
  }
  // `jam --version` appends an "Update available" notice, so take the version line.
  const lines = version.out.split("\n").map((l) => l.trim());
  add("H", "jam", "jam CLI", "pass", lines.find((l) => /^\d+\.\d+\.\d+/.test(l)) ?? lines[0] ?? "");
  const doctor = await run("jam", ["doctor"], 20_000);
  const authLine = doctor.out.split("\n").find((l) => l.trim().startsWith("Auth:")) ?? "";
  if (/logged in/i.test(authLine)) {
    add("H", "jam", "auth", "pass", `${authLine.replace(/^\s*Auth:\s*/, "")}${token ? " (JAM_TOKEN set)" : " (stored credentials, not JAM_TOKEN — the host needs the token)"}`);
  } else {
    add("H", "jam", "auth", "warn", authLine || "jam doctor reported no login", "check JAM_TOKEN, or run `jam auth login`");
  }
}

async function checkGitHubToken(): Promise<void> {
  const token = envVar("GITHUB_TOKEN");
  if (!token) {
    add("H", "github", "GITHUB_TOKEN", "skip", "not set: PRs stay drafts until someone clicks Ready", "optional; a classic PAT with `repo` lets the bot flip a verified PR to ready");
    return;
  }
  const kind = classifyGitHubToken(token);
  if (kind === "fine-grained" || kind === "app-installation") {
    add(
      "H",
      "github",
      "token kind",
      "fail",
      `${kind} token: markPullRequestReadyForReview rejects these no matter which permissions are granted`,
      "mint a classic PAT (github.com/settings/tokens → Tokens (classic)) with the `repo` scope",
    );
    return;
  }
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "cloud-agents-doctor" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      add("H", "github", "GITHUB_TOKEN", "fail", `GET /user → ${res.status}`, "the token is expired or revoked; mint a new classic PAT");
      return;
    }
    const user = (await res.json()) as { login?: string };
    const scopes = res.headers.get("x-oauth-scopes");
    if (scopes === null) {
      add("H", "github", "token scopes", "fail", "GitHub reported no OAuth scopes, which means this is not a classic PAT", "mint a classic PAT with `repo`");
      return;
    }
    if (!hasRepoScope(scopes)) {
      add("H", "github", "token scopes", "fail", `has "${scopes || "(none)"}", needs repo`, "edit the token and tick the whole `repo` scope");
      return;
    }
    add("H", "github", "GITHUB_TOKEN", "pass", `classic PAT for ${user.login ?? "?"} with repo`);
  } catch (err) {
    add("H", "github", "GITHUB_TOKEN", "fail", msg(err), "check network access to api.github.com");
  }
}

// ---------------------------------------------------------------------------
// Every phase — the boring failures: a leaked .env, an unignored .runs

async function checkHygiene(): Promise<void> {
  const tracked = await run("git", ["ls-files"], 15_000);
  if (!tracked.ok) {
    add("A", "hygiene", "git", "warn", "not a git checkout", "run the doctor from the kit root");
    return;
  }
  const files = tracked.out.split("\n").map((f) => f.trim());
  if (files.includes(".env")) {
    add("A", "hygiene", ".env not tracked", "fail", ".env is committed to git", "git rm --cached .env, rotate every secret in it, and confirm .gitignore lists .env");
  } else {
    add("A", "hygiene", ".env not tracked", "pass", existsSync(".env") ? ".env exists locally and is ignored" : "no .env yet");
  }
  const ignore = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
  const missing = [".env", ".runs/", "node_modules/"].filter((p) => !ignore.split("\n").some((l) => l.trim() === p));
  if (missing.length) add("A", "hygiene", ".gitignore", "warn", `does not list ${missing.join(", ")}`, "transcripts and secrets should never be committed");
  else add("A", "hygiene", ".gitignore", "pass", ".env, .runs/, node_modules/ ignored");

  if (!existsSync(".env")) {
    add("A", "hygiene", ".env present", "warn", "no .env in the kit root", "cp .env.example .env and fill it in");
  }
}

// ---------------------------------------------------------------------------

const gates = [
  "A: cursor.com/agents → connect GitHub → grant the target repo",
  "C: create the Slack app from slack-app-manifest.json, mint xapp- and xoxb-, /invite the bot",
  "E: railway login, and choosing which workspace pays for the service",
  "F: mint the Vercel deploy hook and the Railway project token",
  "G: install Vercel for Slack and create the Slack incoming webhook Railway posts to",
  "H: mint the classic GitHub PAT and the Jam mcp:read token",
];

if (want("A")) await checkHygiene();
if (want("A")) await checkCursor();
if (want("B")) {
  await checkGit();
  checkTargetRepoKit();
}
if (want("C", "D", "F")) await checkSlack();
if (want("D")) await checkAgents();
if (want("E")) await checkHost();
if (want("F")) await checkDeploys();
if (want("G")) checkNotifications();
if (want("H")) {
  await checkJam();
  await checkGitHubToken();
}

// Some checks share a request (Slack tokens serve C, D, and F), so filter at
// the end rather than pretending each phase is a separate round trip.
const shown = checks.filter((c) => wanted.has(c.phase));
const summary = summarize(shown);

if (asJson) {
  console.log(JSON.stringify({ phases: [...wanted], checks: shown, summary, humanGates: gates }, null, 2));
} else {
  console.log(`doctor: phases ${[...wanted].join("")}  (read-only; nothing is deployed, posted, or created)`);
  console.log(formatReport(shown));
  if (summary.fail || summary.warn) {
    console.log("\nSteps only a human can do:");
    for (const g of gates) console.log(`  ${g}`);
  }
  console.log("\nThe recipe, phase by phase: IMPLEMENTATION-GUIDE.md");
}

process.exit(summary.exitCode);
