/**
 * Step 8: a Slack @mention — or POST /v1/jobs — becomes a cloud-agent PR.
 *
 * Socket Mode (no public URL) plus an optional HTTP control plane on
 * JOBS_API_PORT / PORT. The Slack thread is still the database: the first
 * reply contains `agent: bc-...`, and a later @mention in the same thread
 * resumes that agent.
 *
 * A second Slack app (slack-dispatcher-manifest.json) can post mentions on
 * behalf of automation; those are accepted when SLACK_DRIVER_BOT_IDS lists
 * that app's B… id. This app never answers its own posts.
 *
 *   npm run slack
 */
import { App } from "@slack/bolt";
import { loadEnv, env } from "./lib/env.js";
import { resolveApiKey } from "./lib/auth.js";
import { reportStartupFailure } from "./lib/report.js";
import { ensureJamBin } from "./lib/jam.js";
import { JobStore, jobsListenPort, listenJobsHttp, mentionText } from "./lib/jobs-http.js";
import { createSlackJobs, postDriverMention, type SlackClient } from "./lib/slack-jobs.js";
import {
  isCursorNativeCommand,
  listedProjects,
  mentionsUser,
  parseProjects,
} from "./lib/slack-cli.js";
import { formatVersion } from "./lib/version.js";
import {
  isDriverBot,
  parseAllowlist,
  parseBotIds,
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
const driverBotIds = parseBotIds(process.env.SLACK_DRIVER_BOT_IDS);
const driverToken = process.env.SLACK_DRIVER_TOKEN?.trim() || "";
const jobsToken = process.env.JOBS_API_TOKEN?.trim() || "";
const maxConcurrent = Number(process.env.SLACK_MAX_CONCURRENT ?? "2") || 2;
const cursorUserId = process.env.SLACK_CURSOR_USER_ID?.trim() || "";
const githubToken = process.env.GITHUB_TOKEN?.trim() || "";
const docsUrl =
  process.env.SLACK_DOCS_URL?.trim() || "https://github.com/rvegajr/cloud-agents/blob/main/ARTICLE-SLACK.md";

const store = new JobStore();

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
  if (channel.startsWith("#")) {
    const name = channel.slice(1);
    channelNames.set(channel, name);
    return name;
  }
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

/**
 * The handle usage text prints is whatever this workspace named the app —
 * never hard-coded, so a clone that calls its app "Shipper" prints `@Shipper`.
 */
async function resolveBotHandle(
  client: {
    users: { info: (args: { user: string }) => Promise<{ user?: { profile?: { display_name?: string; real_name?: string }; real_name?: string; name?: string } }> };
  },
  auth: { user_id?: string; user?: string },
): Promise<string> {
  const override = process.env.SLACK_BOT_HANDLE?.trim();
  if (override) return override.startsWith("@") ? override : `@${override}`;
  if (auth.user_id) {
    try {
      const info = await client.users.info({ user: auth.user_id });
      const u = info.user;
      const name = u?.profile?.display_name || u?.profile?.real_name || u?.real_name || u?.name;
      if (name) return `@${name}`;
    } catch {
      /* users:read not granted; fall through to the username */
    }
  }
  if (auth.user) return `@${auth.user}`;
  console.warn("Could not resolve the bot's Slack name; set SLACK_BOT_HANDLE so usage text names the right app.");
  return "@<bot>";
}

try {
  const apiKey = await resolveApiKey();
  const creds = apiKey ? { apiKey } : {};
  const defaultModel = { id: env("CURSOR_MODEL", "composer-2.5") };

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  });

  const auth = await app.client.auth.test();
  const botUserId = typeof auth.user_id === "string" ? auth.user_id : "";
  const ownBotId = typeof auth.bot_id === "string" ? auth.bot_id : "";
  const botHandle = await resolveBotHandle(app.client, auth);

  const jobs = createSlackJobs({
    creds,
    defaultModel,
    routes,
    projects,
    fallbackTarget,
    allowlist,
    maxConcurrent,
    githubToken,
    docsUrl,
    lookupChannelName: async (_client, channel) => lookupChannelName(app.client, channel),
    store,
  });

  type BoltClient = typeof app.client;
  const asSlackClient = (client: BoltClient): SlackClient => client;

  app.event("app_mention", async ({ event, client, body }) => {
    const eventId = ("event_id" in body && typeof body.event_id === "string" && body.event_id) || event.client_msg_id || event.ts;
    const botId = "bot_id" in event && typeof event.bot_id === "string" ? event.bot_id : undefined;
    if (botId && !isDriverBot(botId, ownBotId, driverBotIds)) {
      console.log(`ignore bot mention bot_id=${botId}`);
      return;
    }
    if (botId) console.log(`driver mention bot_id=${botId}`);
    await jobs.handleMention({
      client: asSlackClient(client),
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
    if (event.subtype) return;
    const text = "text" in event && typeof event.text === "string" ? event.text : "";
    const botId = "bot_id" in event && typeof event.bot_id === "string" ? event.bot_id : undefined;
    // Slack often skips app_mention for bot-authored posts. Catch dispatcher
    // mentions on the regular message event instead.
    if (botId && isDriverBot(botId, ownBotId, driverBotIds) && botUserId && mentionsUser(text, botUserId)) {
      const eventId = ("event_id" in body && typeof body.event_id === "string" && body.event_id) || event.ts;
      console.log(`driver message bot_id=${botId}`);
      await jobs.handleMention({
        client: asSlackClient(client),
        channel: event.channel,
        text,
        eventTs: event.ts,
        threadTs: event.thread_ts,
        user: "user" in event ? event.user : undefined,
        eventId: `driver:${eventId}`,
        overlayOnly: false,
        bot: botHandle,
      });
      return;
    }
    if (!cursorUserId) return;
    if (botId) return;
    if (!mentionsUser(text, cursorUserId)) return;
    if (botUserId && mentionsUser(text, botUserId)) return;
    if (isCursorNativeCommand(text)) return;

    const eventId = `cursor-overlay:${("event_id" in body && typeof body.event_id === "string" && body.event_id) || event.client_msg_id || event.ts}`;
    await jobs.handleMention({
      client: asSlackClient(client),
      channel: event.channel,
      text,
      eventTs: event.ts,
      threadTs: event.thread_ts,
      user: "user" in event ? event.user : undefined,
      eventId,
      overlayOnly: true,
      bot: botHandle,
    });
  });

  await app.start();
  const defaultLine = fallbackTarget ? `default=${fallbackTarget.repo}@${fallbackTarget.ref}` : "default=(none)";
  console.log(`cloud-agents ${formatVersion()}`);
  console.log(`Slack CLI running (Socket Mode) as ${botHandle}. ${defaultLine}  maxConcurrent=${maxConcurrent}`);
  for (const [ch, t] of routes) console.log(`  ${ch} -> ${t.repo}@${t.ref}`);
  for (const p of projects.values()) console.log(`  project ${p.name} -> ${p.repo}@${p.ref}`);
  if (cursorUserId) console.log(`  mentions of Cursor's app (${cursorUserId}) get a pointer to ${botHandle}`);
  if (driverBotIds.length) console.log(`  dispatcher bots: ${driverBotIds.join(", ")}`);
  else console.log("  dispatcher bots: none (set SLACK_DRIVER_BOT_IDS to accept API-posted mentions)");
  console.log(
    githubToken
      ? "  PRs: marked ready for review when the verifier passes (GITHUB_TOKEN set)"
      : "  PRs: left as drafts (set GITHUB_TOKEN to mark them ready when the verifier passes)",
  );
  console.log("  deploys: not from here — a merged PR triggers the host, which posts the result to the channel");
  console.log(
    jobs.usageCatalog(botHandle).replace(/```\n?/g, "").trim(),
  );

  const port = jobsListenPort();
  if (port) {
    const slackClient = asSlackClient(app.client);
    await listenJobsHttp(
      {
        token: jobsToken,
        store,
        health: () => ({
          ok: true,
          bot: botHandle,
          version: formatVersion(),
          jobs: store.list().length,
        }),
        projects: () => listedProjects(projects).map((p) => ({ name: p.name, repo: p.repo, ref: p.ref })),
        startJob: async (body, job) => {
          const channel = body.channel ?? "";
          const text = mentionText(body, botUserId);
          await jobs.handleMention({
            client: slackClient,
            channel,
            text,
            eventTs: body.thread_ts ?? "",
            threadTs: body.thread_ts,
            user: "jobs-api",
            eventId: `jobs-api:${job.id}`,
            overlayOnly: false,
            bot: botHandle,
            jobId: job.id,
          });
        },
        postMention: async (body) => {
          if (!driverToken) throw new Error("SLACK_DRIVER_TOKEN is not set");
          if (!body.channel) throw new Error("channel is required");
          return postDriverMention({ token: driverToken, channel: body.channel, botUserId, body });
        },
      },
      port,
    );
    console.log(
      jobsToken
        ? `  jobs API: http://0.0.0.0:${port}  (Bearer JOBS_API_TOKEN)`
        : `  jobs API: http://0.0.0.0:${port}  GET /health only — set JOBS_API_TOKEN to accept POST /v1/jobs`,
    );
  }

  const stop = async () => {
    await app.stop();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch (err) {
  process.exit(reportStartupFailure(err));
}
