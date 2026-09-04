/**
 * Step 8: a Slack @mention becomes a cloud-agent PR.
 *
 * Socket Mode (no public URL). The Slack thread is the database: the first
 * reply contains `agent: bc-...`, and a later @mention in the same thread
 * resumes that agent.
 *
 * Bare mention prints CLI usage. `@Cursor <project>` (or `@Cursor <project> -`)
 * prints that project's options. A channel whose name starts with a project
 * (`#api-fixbot`) selects that project so the name can be omitted.
 * `@Cursor <project> deploy [env=<name>]` kicks a Vercel/Railway deploy from
 * this process (SLACK_DEPLOYS) and reports back to the thread and channel.
 *
 *   npm run slack
 */
import { Agent, type SDKAgent } from "@cursor/sdk";
import { App } from "@slack/bolt";
import { loadEnv, env } from "./lib/env.js";
import { resolveApiKey } from "./lib/auth.js";
import { reportStartupFailure } from "./lib/report.js";
import { printStream } from "./lib/stream.js";
import { ensureJamBin, extractJamIds } from "./lib/jam.js";
import { continueJob, startJob, type AgentHandle, type JobRuntime } from "./lib/slack-fix.js";
import {
  channelProject,
  formatGlobalUsage,
  formatProjectUsage,
  impliedProject,
  isCursorNativeCommand,
  listedProjects,
  mentionsUser,
  parseMentionCli,
  parseProjects,
  resolveRunTarget,
  type SlackProject,
} from "./lib/slack-cli.js";
import {
  credentialsFromEnv,
  formatDeployUsage,
  formatDuration,
  parseDeploys,
  pickDeployTarget,
  startDeploy,
  statusEmoji,
  type DeployProgress,
} from "./lib/slack-deploy.js";
import {
  ConcurrencyGate,
  Deduper,
  findAgentId,
  formatThreadContext,
  findRoute,
  isAllowedChannel,
  parseAllowlist,
  parseChannelRepos,
  type RepoTarget,
} from "./lib/slack-thread.js";

loadEnv();
void ensureJamBin();

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill in the Slack tokens.`);
    process.exit(1);
  }
  return v;
}

const botToken = requireEnv("SLACK_BOT_TOKEN");
const appToken = requireEnv("SLACK_APP_TOKEN");
const defaultRef = process.env.TARGET_REF?.trim() || "main";
const defaultRepo = process.env.TARGET_REPO?.trim();
const fallbackTarget: RepoTarget | undefined = defaultRepo ? { repo: defaultRepo, ref: defaultRef } : undefined;
const routes = parseChannelRepos(process.env.SLACK_CHANNEL_REPOS, defaultRef);
const projects = parseProjects(process.env.SLACK_PROJECTS, defaultRef);
if (!fallbackTarget && routes.size === 0 && projects.size === 0) {
  console.error("Set TARGET_REPO, SLACK_CHANNEL_REPOS, or SLACK_PROJECTS.");
  process.exit(1);
}
const allowlist = parseAllowlist(process.env.SLACK_ALLOWED_CHANNELS);
const maxConcurrent = Number(process.env.SLACK_MAX_CONCURRENT ?? "2") || 2;
const cursorUserId = process.env.SLACK_CURSOR_USER_ID?.trim() || "";
const deploys = parseDeploys(process.env.SLACK_DEPLOYS);
const deployers = new Set(parseAllowlist(process.env.SLACK_DEPLOYERS).map((u) => u.replace(/^<@|>$/g, "")));
const deployCreds = credentialsFromEnv();
const deployable = [...deploys.keys()];

const deduper = new Deduper();
const gate = new ConcurrencyGate(maxConcurrent);
const inflightThreads = new Set<string>();

/**
 * `#name` routes and project-prefix matching need the channel's name;
 * `app_mention` only carries the ID. `conversations.info` needs `channels:read`
 * (+ `groups:read` for private channels). Missing scope is logged once.
 */
const channelNames = new Map<string, string | undefined>();
let nameLookupWarned = false;
async function lookupChannelName(
  client: { conversations: { info: (args: { channel: string }) => Promise<{ channel?: { name?: string } }> } },
  channel: string,
): Promise<string | undefined> {
  if (channelNames.has(channel)) return channelNames.get(channel);
  try {
    const info = await client.conversations.info({ channel });
    const name = info.channel?.name;
    channelNames.set(channel, name);
    return name;
  } catch (err) {
    if (!nameLookupWarned) {
      nameLookupWarned = true;
      console.warn(`conversations.info failed (${err instanceof Error ? err.message : String(err)}). #name routes and channel-prefix projects need the channels:read scope.`);
    }
    return undefined;
  }
}

function wrap(agent: SDKAgent): AgentHandle {
  return {
    agentId: agent.agentId,
    send: async (prompt, opts) => {
      const run = await agent.send(prompt, opts?.mode ? { mode: opts.mode } : {});
      console.log(`agent=${agent.agentId} run=${run.id}`);
      await printStream(run, { text: true, tools: true });
      const result = await run.wait();
      return {
        status: result.status,
        result: result.result,
        runId: run.id,
        prUrl: result.git?.branches.find((b) => b.prUrl)?.prUrl,
      };
    },
    getUsage: async () => {
      const u = await agent.getUsage();
      return {
        totalTokens: u.usage.totalTokens,
        chargedCents: u.cost?.chargedCents,
        rawCostCents: u.cost?.rawCostCents,
      };
    },
  };
}

function namedChannelFor(project: SlackProject | undefined, routes: Map<string, { repo: string; ref: string }>): string | undefined {
  if (!project) return undefined;
  for (const key of routes.keys()) {
    if (!key.startsWith("#")) continue;
    const name = key.slice(1);
    if (name === project.name || name.startsWith(`${project.name}-`)) return name;
  }
  return undefined;
}

function usageFor(
  bot: string,
  cli: { kind?: string; project?: SlackProject; unknownProject?: string },
  channelName: string | undefined,
  implied: SlackProject | undefined,
): string {
  if (cli.kind === "project-usage" && cli.project) {
    return formatProjectUsage({
      bot,
      project: cli.project,
      channelName,
      channelProjectName: implied?.name,
      deployEnvs: deploys.get(cli.project.name)?.map((t) => t.env),
    });
  }
  return formatGlobalUsage({
    bot,
    channelName,
    channelProject: implied,
    projects: listedProjects(projects, implied),
    unknownProject: cli.unknownProject,
    deployable,
  });
}

function deployUsageFor(bot: string, project: SlackProject | undefined, implied: SlackProject | undefined, problem?: string): string {
  if (!project) {
    const list = deployable.length ? deployable.join(", ") : "(none — set SLACK_DEPLOYS)";
    return [problem ?? "", "```", `usage: ${bot} <project> deploy [env=<name>]`, "", `deployable: ${list}`, "```"]
      .filter((l, i) => l !== "" || i !== 0)
      .join("\n");
  }
  return formatDeployUsage({
    bot,
    project: project.name,
    targets: deploys.get(project.name) ?? [],
    implied: implied?.name === project.name,
    problem,
  });
}

try {
  const apiKey = await resolveApiKey();
  // SDK refuses an explicit empty/undefined apiKey; omit the field so it
  // can use ~/.cursor/sdk/auth.json (CURSOR_API_KEY still wins when set).
  const creds = apiKey ? { apiKey } : {};
  const defaultModel = { id: env("CURSOR_MODEL", "composer-2.5") };

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  });

  const auth = await app.client.auth.test();
  const botUserId = typeof auth.user_id === "string" ? auth.user_id : "";
  const botHandle = process.env.SLACK_BOT_HANDLE?.trim() || "@Cursor";

  type SlackClient = typeof app.client;

  const inflightDeploys = new Set<string>();

  /**
   * Progress stays in the thread; the final line is also broadcast to the
   * channel and @-mentions whoever asked, so nobody has to watch the thread.
   */
  async function handleDeploy(args: {
    client: SlackClient;
    cli: { project?: SlackProject; options: { env?: string } };
    channel: string;
    threadTs: string;
    user: string | undefined;
    post: (text: string) => Promise<void>;
    react: (name: string, action: "add" | "remove") => Promise<void>;
    bot: string;
    implied: SlackProject | undefined;
  }): Promise<void> {
    const { cli, post, react } = args;
    const project = cli.project;
    if (!project) {
      await post(deployUsageFor(args.bot, undefined, args.implied, "Which project? Name one, or run this from a `#<project>-…` channel."));
      return;
    }
    if (deployers.size && (!args.user || !deployers.has(args.user))) {
      await post(`Deploys are limited to SLACK_DEPLOYERS (${[...deployers].map((u) => `<@${u}>`).join(", ")}). Ask one of them.`);
      return;
    }
    const targets = deploys.get(project.name);
    const picked = pickDeployTarget(targets, cli.options.env);
    if (!picked.target) {
      const problem =
        picked.reason === "unknown-env"
          ? `no deploy target \`${cli.options.env}\` for ${project.name}.`
          : picked.reason === "ambiguous"
            ? `${project.name} has several targets and none is the default; pass env=<name>.`
            : undefined;
      await post(deployUsageFor(args.bot, project, args.implied, problem));
      return;
    }
    const target = picked.target;
    const key = `${target.project}/${target.env}`;
    if (inflightDeploys.has(key)) {
      await post(`A deploy of ${key} is already running. I'll report when it finishes.`);
      return;
    }
    inflightDeploys.add(key);
    const who = args.user ? `<@${args.user}>` : "someone";
    const started = Date.now();
    const envLabel = target.env === "default" ? "" : ` env=${target.env}`;
    try {
      await react("rocket", "add");
      const run = await startDeploy(target, deployCreds);
      const where = run.inspectUrl ? ` → ${run.inspectUrl}` : "";
      await post(`${statusEmoji("queued")} Deploying *${project.name}*${envLabel} (${run.label})${where}`);
      console.log(`deploy ${key} started by ${args.user ?? "?"}: ${run.label}`);

      if (!run.watch) {
        await react("rocket", "remove");
        await react("white_check_mark", "add");
        await args.client.chat.postMessage({
          channel: args.channel,
          thread_ts: args.threadTs,
          reply_broadcast: true,
          text: `🚀 *${project.name}*${envLabel} deploy triggered by ${who} (${run.label}). No VERCEL_TOKEN set, so I can't watch it; check the dashboard.`,
        });
        return;
      }

      const final: DeployProgress = await run.watch(async (p) => {
        const bits = [p.detail, p.inspectUrl].filter(Boolean).join(" · ");
        await post(`${statusEmoji(p.status)} ${p.status}${bits ? ` — ${bits}` : ""}`);
      });

      await react("rocket", "remove");
      const took = formatDuration(Date.now() - started);
      let summary: string;
      if (final.status === "ready") {
        await react("white_check_mark", "add");
        summary = `✅ *${project.name}*${envLabel} is live (${took}) — ${final.liveUrl ?? final.inspectUrl ?? run.label} ${who}`;
      } else if (final.status === "failed") {
        await react("x", "add");
        summary = `❌ *${project.name}*${envLabel} deploy failed after ${took}${final.inspectUrl ? ` — ${final.inspectUrl}` : ""} ${who}`;
        const log = await run.failureLog?.().catch(() => undefined);
        if (log) await post("```\n" + log.slice(-2800) + "\n```");
      } else {
        await react("warning", "add");
        summary = `${statusEmoji(final.status)} *${project.name}*${envLabel} deploy ended as ${final.status} after ${took}${final.detail ? ` (${final.detail})` : ""}${final.inspectUrl ? ` — ${final.inspectUrl}` : ""} ${who}`;
      }
      await args.client.chat.postMessage({ channel: args.channel, thread_ts: args.threadTs, reply_broadcast: true, text: summary });
      console.log(`deploy ${key} ${final.status} in ${took}`);
    } catch (err) {
      console.error(err);
      await react("rocket", "remove");
      await react("x", "add");
      const msg = err instanceof Error ? err.message : String(err);
      await args.client.chat.postMessage({
        channel: args.channel,
        thread_ts: args.threadTs,
        reply_broadcast: true,
        text: `❌ *${project.name}*${envLabel} deploy could not start: ${msg} ${who}`,
      });
    } finally {
      inflightDeploys.delete(key);
    }
  }

  async function handleCli(args: {
    client: SlackClient;
    channel: string;
    text: string;
    eventTs: string;
    threadTs: string | undefined;
    user: string | undefined;
    eventId: string;
    /** When true, only print usage — never start a job (Cursor overlay). */
    overlayOnly: boolean;
    bot: string;
  }): Promise<void> {
    if (deduper.seen(args.eventId)) {
      console.log(`duplicate event ${args.eventId}, ignoring`);
      return;
    }

    const channel = args.channel;
    const threadTs = args.threadTs ?? args.eventTs;
    const inThread = Boolean(args.threadTs && args.threadTs !== args.eventTs);

    const post = async (text: string) => {
      await args.client.chat.postMessage({ channel, thread_ts: threadTs, text });
    };

    const react = async (name: string, action: "add" | "remove") => {
      try {
        if (action === "add") await args.client.reactions.add({ channel, timestamp: args.eventTs, name });
        else await args.client.reactions.remove({ channel, timestamp: args.eventTs, name });
      } catch {
        /* already present or already gone */
      }
    };

    const lookedUp = await lookupChannelName(args.client, channel);
    const routed = findRoute(channel, lookedUp, routes);
    const implied =
      impliedProject({ channelId: channel, channelName: lookedUp, routes, projects }) ??
      channelProject(lookedUp, projects, routed);
    const channelName = lookedUp ?? namedChannelFor(implied, routes);
    const allowed = Boolean(routed) || isAllowedChannel(channel, allowlist);

    const cli = parseMentionCli(args.text, {
      projects,
      channelProject: implied,
      fallback: fallbackTarget,
    });

    const isUsage = cli.kind === "usage" || cli.kind === "project-usage" || cli.kind === "deploy-usage";
    if (!allowed && !isUsage) {
      await post(`This channel (${channel}) is not on SLACK_ALLOWED_CHANNELS or SLACK_CHANNEL_REPOS. Add it to .env.`);
      return;
    }

    if (cli.kind === "deploy-usage") {
      await post(deployUsageFor(args.bot, cli.project, implied));
      return;
    }

    if (isUsage) {
      if (args.overlayOnly && inThread && !cli.explicitHelp && cli.kind === "usage") return;
      await post(usageFor(args.bot, cli, channelName, implied));
      return;
    }

    if (args.overlayOnly) return;

    if (cli.kind === "deploy") {
      await handleDeploy({ client: args.client, cli, channel, threadTs, user: args.user, post, react, bot: args.bot, implied });
      return;
    }

    const target = resolveRunTarget(cli, routed, fallbackTarget);
    if (!target) {
      await post(
        `No repo is mapped for this channel (${channel}${channelName ? ` #${channelName}` : ""}). Pass a project name, or add it to SLACK_PROJECTS / SLACK_CHANNEL_REPOS.`,
      );
      await post(usageFor(args.bot, { kind: "usage", unknownProject: cli.unknownProject }, channelName, implied));
      return;
    }
    const { repo, ref } = target;
    const request = cli.request;
    if (!request) {
      await post(usageFor(args.bot, { kind: implied ? "project-usage" : "usage", project: implied }, channelName, implied));
      return;
    }

    if (inflightThreads.has(threadTs)) {
      await post("Already working this thread. I'll take follow-ups when the current run finishes.");
      return;
    }
    if (!gate.tryAcquire()) {
      await post(`Already running ${gate.active} job(s) (SLACK_MAX_CONCURRENT=${maxConcurrent}). Try again in a minute.`);
      return;
    }
    inflightThreads.add(threadTs);

    let closer: (() => Promise<void>) | undefined;
    try {
      await react("hourglass_flowing_sand", "add");

      const jamIds = extractJamIds(request);
      if (jamIds.length) {
        await post(
          `Reading Jam ${jamIds.map((id) => `https://jam.dev/c/${id}`).join(", ")} (console, network, click path, video)…`,
        );
      }

      let threadMessages: Array<{ user?: string; text?: string | null }> = [];
      if (args.threadTs) {
        const replies = await args.client.conversations.replies({ channel, ts: args.threadTs, limit: 200 });
        threadMessages = replies.messages ?? [];
      }
      const existingId = findAgentId(threadMessages);

      const runtime: JobRuntime = {
        create: async ({ repo: r, ref: startingRef, autoCreatePR, model: modelId }) => {
          const agent = await Agent.create({
            ...creds,
            model: { id: modelId ?? cli.options.model ?? defaultModel.id },
            mode: "plan",
            cloud: {
              repos: [{ url: r, startingRef }],
              autoCreatePR: autoCreatePR ?? cli.options.autopr ?? true,
              skipReviewerRequest: true,
              metadata: {
                kit: "cloud-agents",
                source: "slack",
                channel,
                user: args.user ?? "",
                project: cli.project?.name ?? "",
              },
            },
          });
          closer = async () => {
            await agent.close();
          };
          console.log(`created ${agent.agentId} for ${r}@${startingRef} project=${cli.project?.name ?? "(channel)"}`);
          return wrap(agent);
        },
        resume: async (agentId) => {
          const agent = await Agent.resume(agentId, creds);
          closer = async () => {
            await agent.close();
          };
          console.log(`resumed ${agentId}`);
          return wrap(agent);
        },
        post,
      };

      const outcome = existingId
        ? await continueJob({ agentId: existingId, message: request, repo, ref }, runtime)
        : await startJob(
            { repo, ref, request, threadContext: formatThreadContext(threadMessages) },
            runtime,
          );

      await react("hourglass_flowing_sand", "remove");
      if (outcome.kind === "failed") await react("x", "add");
      else await react("white_check_mark", "add");
      console.log(`thread ${threadTs} ${outcome.kind} agent=${outcome.agentId ?? "none"}`);
    } catch (err) {
      console.error(err);
      await react("hourglass_flowing_sand", "remove");
      await react("x", "add");
      const msg = err instanceof Error ? err.message : String(err);
      await post(`Startup failed: ${msg}`);
    } finally {
      try {
        await closer?.();
      } catch (err) {
        console.error("agent close failed", err);
      }
      inflightThreads.delete(threadTs);
      gate.release();
    }
  }

  app.event("app_mention", async ({ event, client, body }) => {
    const eventId = ("event_id" in body && typeof body.event_id === "string" && body.event_id) || event.client_msg_id || event.ts;
    if ("bot_id" in event && event.bot_id) return;
    await handleCli({
      client,
      channel: event.channel,
      text: event.text ?? "",
      eventTs: event.ts,
      threadTs: event.thread_ts,
      user: event.user,
      eventId,
      overlayOnly: false,
      bot: botHandle,
    });
  });

  app.event("message", async ({ event, client, body }) => {
    if (!cursorUserId) return;
    if (event.subtype) return;
    if ("bot_id" in event && event.bot_id) return;
    const text = "text" in event && typeof event.text === "string" ? event.text : "";
    if (!mentionsUser(text, cursorUserId)) return;
    if (botUserId && mentionsUser(text, botUserId)) return;
    if (isCursorNativeCommand(text)) return;

    const eventId = `cursor-overlay:${("event_id" in body && typeof body.event_id === "string" && body.event_id) || event.client_msg_id || event.ts}`;
    await handleCli({
      client,
      channel: event.channel,
      text,
      eventTs: event.ts,
      threadTs: event.thread_ts,
      user: "user" in event ? event.user : undefined,
      eventId,
      overlayOnly: true,
      bot: "@Cursor",
    });
  });

  await app.start();
  const defaultLine = fallbackTarget ? `default=${fallbackTarget.repo}@${fallbackTarget.ref}` : "default=(none)";
  console.log(`Slack CLI running (Socket Mode). ${defaultLine}  maxConcurrent=${maxConcurrent}`);
  for (const [ch, t] of routes) console.log(`  ${ch} -> ${t.repo}@${t.ref}`);
  for (const p of projects.values()) console.log(`  project ${p.name} -> ${p.repo}@${p.ref}`);
  for (const [name, targets] of deploys) {
    console.log(`  deploy ${name} -> ${targets.map((t) => `${t.env}:${t.provider}`).join(", ")}`);
  }
  if (deploys.size) {
    const missing: string[] = [];
    if ([...deploys.values()].flat().some((t) => t.provider === "vercel") && !deployCreds.vercelToken) missing.push("VERCEL_TOKEN (vercel deploys will fire but not be watched)");
    if ([...deploys.values()].flat().some((t) => t.provider === "railway") && !deployCreds.railwayToken) missing.push("RAILWAY_API_TOKEN or RAILWAY_TOKEN (railway deploys will fail)");
    for (const m of missing) console.warn(`  missing ${m}`);
    console.log(`  deployers: ${deployers.size ? [...deployers].join(", ") : "anyone in an allowed channel"}`);
  }
  if (cursorUserId) console.log(`  @Cursor overlay help on ${cursorUserId}`);
  console.log(
    formatGlobalUsage({
      bot: botHandle,
      projects: listedProjects(projects),
      deployable,
    }).replace(/```\n?/g, "").trim(),
  );

  const stop = async () => {
    await app.stop();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch (err) {
  process.exit(reportStartupFailure(err));
}
