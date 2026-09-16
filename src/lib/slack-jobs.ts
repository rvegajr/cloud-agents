/**
 * One mention → one job. Slack events and the HTTP API both call `handleMention`.
 */
import { Agent, type SDKAgent } from "@cursor/sdk";
import { markPullRequestReady } from "./github.js";
import { extractJamIds } from "./jam.js";
import { continueJob, startJob, type AgentHandle, type JobRuntime } from "./slack-fix.js";
import {
  channelProject,
  formatGlobalUsage,
  formatProjectUsage,
  impliedProject,
  listedProjects,
  parseMentionCli,
  resolveRunTarget,
  type SlackProject,
} from "./slack-cli.js";
import {
  ConcurrencyGate,
  Deduper,
  findAgentId,
  findRoute,
  formatThreadContext,
  isAllowedChannel,
  type RepoTarget,
} from "./slack-thread.js";
import { formatVersion, formatVersionBlock } from "./version.js";
import { printStream } from "./stream.js";
import type { JobRecord, JobStore, JobsBody } from "./jobs-http.js";
import { mentionText } from "./jobs-http.js";
import { selectModel } from "./model.js";

export interface SlackClient {
  chat: {
    postMessage: (args: { channel: string; thread_ts?: string; text: string }) => Promise<{ ts?: string }>;
  };
  reactions: {
    add: (args: { channel: string; timestamp: string; name: string }) => Promise<unknown>;
    remove: (args: { channel: string; timestamp: string; name: string }) => Promise<unknown>;
  };
  conversations: {
    replies: (args: { channel: string; ts: string; limit: number }) => Promise<{ messages?: Array<{ user?: string; text?: string | null }> }>;
    info?: (args: { channel: string }) => Promise<{ channel?: { name?: string } }>;
  };
}

export interface MentionArgs {
  client: SlackClient;
  channel: string;
  channelName?: string;
  text: string;
  eventTs: string;
  threadTs: string | undefined;
  user: string | undefined;
  eventId: string;
  overlayOnly: boolean;
  bot: string;
  /** When set, every `post` is also stored on this job. */
  jobId?: string;
}

export interface SlackJobsConfig {
  creds: { apiKey?: string };
  defaultModel: { id: string; params?: Array<{ id: string; value: string }> };
  routes: Map<string, RepoTarget>;
  projects: Map<string, SlackProject>;
  fallbackTarget: RepoTarget | undefined;
  allowlist: string[];
  maxConcurrent: number;
  githubToken: string;
  docsUrl: string;
  lookupChannelName: (client: SlackClient, channel: string) => Promise<string | undefined>;
  store: JobStore;
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

export function createSlackJobs(cfg: SlackJobsConfig) {
  const deduper = new Deduper();
  const gate = new ConcurrencyGate(cfg.maxConcurrent);
  const inflightThreads = new Set<string>();

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
        docsUrl: cfg.docsUrl,
      });
    }
    return formatGlobalUsage({
      bot,
      channelName,
      channelProject: implied,
      projects: listedProjects(cfg.projects, implied),
      unknownProject: cli.unknownProject,
      docsUrl: cfg.docsUrl,
    });
  }

  async function handleMention(args: MentionArgs): Promise<void> {
    if (deduper.seen(args.eventId)) {
      console.log(`duplicate event ${args.eventId}, ignoring`);
      return;
    }

    const channel = args.channel;
    const slackTs = (ts: string | undefined) => (ts && /^\d+\.\d+$/.test(ts) ? ts : undefined);
    let threadTs = slackTs(args.threadTs) ?? slackTs(args.eventTs);
    const inThread = Boolean(threadTs && threadTs !== args.eventTs);
    const jobId = args.jobId;
    const inflightKey = threadTs ?? jobId ?? args.eventId;

    const post = async (text: string) => {
      if (jobId) cfg.store.appendPost(jobId, text);
      if (!channel) return;
      const posted = await args.client.chat.postMessage({
        channel,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        text,
      });
      if (posted.ts && !threadTs) threadTs = posted.ts;
      if (jobId && posted.ts) cfg.store.patch(jobId, { threadTs: threadTs ?? posted.ts });
    };

    const canReact = Boolean(channel && /^\d+\.\d+$/.test(args.eventTs));
    const react = async (name: string, action: "add" | "remove") => {
      if (!canReact) return;
      try {
        if (action === "add") await args.client.reactions.add({ channel, timestamp: args.eventTs, name });
        else await args.client.reactions.remove({ channel, timestamp: args.eventTs, name });
      } catch {
        /* already present or already gone */
      }
    };

    const lookedUp = args.channelName ?? (await cfg.lookupChannelName(args.client, channel));
    const routed = findRoute(channel, lookedUp, cfg.routes);
    const implied =
      impliedProject({ channelId: channel, channelName: lookedUp, routes: cfg.routes, projects: cfg.projects }) ??
      channelProject(lookedUp, cfg.projects, routed);
    const channelName = lookedUp ?? namedChannelFor(implied, cfg.routes);
    const allowed = Boolean(routed) || isAllowedChannel(channel, cfg.allowlist);

    const cli = parseMentionCli(args.text, {
      projects: cfg.projects,
      channelProject: implied,
      fallback: cfg.fallbackTarget,
    });

    const isUsage = cli.kind === "usage" || cli.kind === "project-usage" || cli.kind === "version";
    if (!allowed && !isUsage) {
      await post(`This channel (${channel}) is not on SLACK_ALLOWED_CHANNELS or SLACK_CHANNEL_REPOS. Add it to .env.`);
      if (jobId) cfg.store.patch(jobId, { status: "failed", error: "channel not allowed" });
      return;
    }

    if (cli.kind === "version") {
      await post(`${args.bot} ${formatVersion()}\n${formatVersionBlock()}`);
      if (jobId) cfg.store.patch(jobId, { status: "usage", kind: "version" });
      return;
    }

    if (isUsage) {
      if (args.overlayOnly && inThread && !cli.explicitHelp && cli.kind === "usage") return;
      const note = args.overlayOnly
        ? `That mention goes to Cursor's own Slack app. For the Jam → triage → verify pipeline, mention ${args.bot} instead:\n`
        : "";
      await post(note + usageFor(args.bot, cli, channelName, implied));
      if (jobId) cfg.store.patch(jobId, { status: "usage", kind: cli.kind });
      return;
    }

    if (args.overlayOnly) return;

    const target = resolveRunTarget(cli, routed, cfg.fallbackTarget);
    if (!target) {
      await post(
        `No repo is mapped for this channel (${channel}${channelName ? ` #${channelName}` : ""}). Pass a project name, or add it to SLACK_PROJECTS / SLACK_CHANNEL_REPOS.`,
      );
      await post(usageFor(args.bot, { kind: "usage", unknownProject: cli.unknownProject }, channelName, implied));
      if (jobId) cfg.store.patch(jobId, { status: "failed", error: "no repo mapped" });
      return;
    }
    const { repo, ref } = target;
    const request = cli.request;
    if (!request) {
      await post(usageFor(args.bot, { kind: implied ? "project-usage" : "usage", project: implied }, channelName, implied));
      if (jobId) cfg.store.patch(jobId, { status: "usage", kind: "empty-request" });
      return;
    }

    if (inflightThreads.has(inflightKey)) {
      await post("Already working this thread. I'll take follow-ups when the current run finishes.");
      if (jobId) cfg.store.patch(jobId, { status: "failed", error: "thread in flight" });
      return;
    }
    if (!gate.tryAcquire()) {
      await post(`Already running ${gate.active} job(s) (SLACK_MAX_CONCURRENT=${cfg.maxConcurrent}). Try again in a minute.`);
      if (jobId) cfg.store.patch(jobId, { status: "failed", error: "concurrency" });
      return;
    }
    inflightThreads.add(inflightKey);
    if (jobId) cfg.store.patch(jobId, { status: "running" });

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
            ...cfg.creds,
            model: selectModel(modelId ?? cli.options.model ?? cfg.defaultModel.id),
            mode: "plan",
            cloud: {
              repos: [{ url: r, startingRef }],
              autoCreatePR: autoCreatePR ?? cli.options.autopr ?? true,
              skipReviewerRequest: true,
              metadata: {
                kit: "cloud-agents",
                source: jobId ? "jobs-api" : "slack",
                channel,
                user: args.user ?? "",
                project: cli.project?.name ?? "",
                job: jobId ?? "",
              },
            },
          });
          closer = async () => {
            await agent.close();
          };
          console.log(`created ${agent.agentId} for ${r}@${startingRef} project=${cli.project?.name ?? "(channel)"}`);
          if (jobId) cfg.store.patch(jobId, { agentId: agent.agentId });
          return wrap(agent);
        },
        resume: async (agentId) => {
          const agent = await Agent.resume(agentId, cfg.creds);
          closer = async () => {
            await agent.close();
          };
          console.log(`resumed ${agentId}`);
          if (jobId) cfg.store.patch(jobId, { agentId });
          return wrap(agent);
        },
        post,
        ...(cfg.githubToken
          ? {
              markPrReady: async (prUrl: string) => {
                const result = await markPullRequestReady(prUrl, cfg.githubToken);
                console.log(`pr ${prUrl} ${result}`);
                return result;
              },
            }
          : {}),
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
      console.log(`thread ${threadTs ?? inflightKey} ${outcome.kind} agent=${outcome.agentId ?? "none"}`);
      if (jobId) {
        cfg.store.patch(jobId, {
          status: outcome.kind === "failed" ? "failed" : outcome.kind === "need-info" ? "need-info" : "done",
          kind: outcome.kind,
          agentId: outcome.agentId,
          prUrl: "prUrl" in outcome ? outcome.prUrl : undefined,
          error: outcome.kind === "failed" ? outcome.error : undefined,
        });
      }
    } catch (err) {
      console.error(err);
      await react("hourglass_flowing_sand", "remove");
      await react("x", "add");
      const msg = err instanceof Error ? err.message : String(err);
      await post(`Startup failed: ${msg}`);
      if (jobId) cfg.store.patch(jobId, { status: "failed", error: msg });
    } finally {
      try {
        await closer?.();
      } catch (err) {
        console.error("agent close failed", err);
      }
      inflightThreads.delete(inflightKey);
      gate.release();
    }
  }

  return {
    handleMention,
    usageCatalog: (bot: string) =>
      formatGlobalUsage({
        bot,
        projects: listedProjects(cfg.projects),
      }),
  };
}

export async function postDriverMention(opts: {
  token: string;
  channel: string;
  botUserId: string;
  body: JobsBody;
}): Promise<{ ts: string; channel: string }> {
  const text = mentionText(opts.body, opts.botUserId);
  if (!text) throw new Error("empty mention text");
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: opts.channel,
      text,
      thread_ts: opts.body.thread_ts,
    }),
  });
  const data = (await res.json()) as { ok?: boolean; ts?: string; error?: string };
  if (!data.ok || !data.ts) throw new Error(data.error ?? "chat.postMessage failed");
  return { ts: data.ts, channel: opts.channel };
}
