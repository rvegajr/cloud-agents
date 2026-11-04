/**
 * "Is my fix live yet?", answered in the job thread.
 *
 * A tester who starts a job from Slack gets a PR, and then nothing: the merge
 * lands on an integration branch, a promotion later carries it to production,
 * and the only way to learn it is there is to ask. This closes the loop. Once a
 * job's PR merges, the bot compares the merge commit against every deploy of
 * that repo in services.json (the same fleet `npm run version-board` reads) and
 * posts in the thread when a deploy is running it. The production post tags
 * the person who started the job so they know to retest.
 *
 *   PR open           keep waiting
 *   PR closed         say so once, stop
 *   PR merged         per deploy: GET /health → commit; GitHub compare says
 *                     whether that commit contains the merge → post once
 *   all deploys live  stop
 *   too old           say which deploys never got it, stop
 *
 * The IO (GitHub, /health, Slack, the state file) lives in `LiveWatchIO`, so the
 * rules can be tested without a network.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parsePullRequestUrl } from "./github.js";
import { commitFromHealth, fetchHealth, type Registry, type Service } from "./freshness.js";

export interface Watch {
  prUrl: string;
  channel: string;
  threadTs: string;
  /** Slack user id of whoever started the job; tagged on the production post. */
  user?: string;
  createdAt: number;
  mergedSha?: string;
  /** `name/env` of each deploy already announced. */
  announced: string[];
}

export type PrState = { state: "open" } | { state: "closed" } | { state: "merged"; sha: string };

/** Does the deployed commit contain the merge commit? */
export type Contains = "yes" | "no" | "unknown";

export interface LiveWatchIO {
  prState: (prUrl: string) => Promise<PrState | undefined>;
  deployedCommit: (service: Service) => Promise<string | undefined>;
  contains: (repo: string, sha: string, deployed: string) => Promise<Contains>;
  post: (channel: string, threadTs: string, text: string) => Promise<void>;
  save?: (watches: Watch[]) => void;
}

export interface LiveWatchOptions {
  registry: Registry;
  io: LiveWatchIO;
  /** Give up after this long, whether or not the PR merged. */
  maxAgeMs?: number;
  initial?: Watch[];
}

const DAY = 86_400_000;
const DEFAULT_MAX_AGE_MS = 14 * DAY;

/** `rvegajr/blessbox` from a PR URL, lowercased so it matches services.json however it was typed. */
export function repoOfPr(prUrl: string): string | undefined {
  const ref = parsePullRequestUrl(prUrl);
  return ref ? `${ref.owner}/${ref.repo}`.toLowerCase() : undefined;
}

export function servicesForRepo(registry: Registry, repo: string): Service[] {
  return registry.services.filter((s) => s.repo.toLowerCase() === repo.toLowerCase());
}

function key(s: Service): string {
  return `${s.name}/${s.env}`;
}

function prLabel(prUrl: string): string {
  const ref = parsePullRequestUrl(prUrl);
  return ref ? `PR #${ref.number}` : prUrl;
}

function siteOf(s: Service): string {
  try {
    return new URL(s.health).host;
  } catch {
    return s.health;
  }
}

function envList(services: Service[]): string {
  return services.map((s) => (s.env === "production" ? `${s.name} production` : `${s.name} ${s.env}`)).join(", ");
}

/** Only real Slack users get tagged; the jobs API posts as "jobs-api". */
function tag(user: string | undefined): string {
  return user && /^[UW][A-Z0-9]+$/.test(user) ? `<@${user}> ` : "";
}

export class LiveWatch {
  private readonly registry: Registry;
  private readonly io: LiveWatchIO;
  private readonly maxAgeMs: number;
  private watches: Watch[];
  private ticking = false;

  constructor(opts: LiveWatchOptions) {
    this.registry = opts.registry;
    this.io = opts.io;
    this.maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.watches = [...(opts.initial ?? [])];
  }

  list(): Watch[] {
    return this.watches.map((w) => ({ ...w, announced: [...w.announced] }));
  }

  /**
   * Start watching a job's PR. Says in the thread what it will do, or that it
   * cannot (no deploy of that repo is in services.json). A follow-up that
   * lands on the same PR in the same thread is not watched twice.
   */
  async add(input: { prUrl: string; channel: string; threadTs: string; user?: string }, now = Date.now()): Promise<boolean> {
    const repo = repoOfPr(input.prUrl);
    if (!repo || !input.channel || !input.threadTs) return false;
    if (this.watches.some((w) => w.prUrl === input.prUrl && w.threadTs === input.threadTs)) return false;
    const services = servicesForRepo(this.registry, repo);
    if (!services.length) {
      await this.io.post(
        input.channel,
        input.threadTs,
        `${prLabel(input.prUrl)}: ${repo} has no /health in services.json, so I can't tell when this is live. Ask the owner before retesting.`,
      );
      return false;
    }
    this.watches.push({ ...input, createdAt: now, announced: [] });
    this.persist();
    await this.io.post(
      input.channel,
      input.threadTs,
      `I'll post here when ${prLabel(input.prUrl)} is live on ${envList(services)}.`,
    );
    return true;
  }

  /** One pass over every watch. Safe to call on a timer; overlapping calls are skipped. */
  async tick(now = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const keep: Watch[] = [];
      for (const w of this.watches) {
        let done = false;
        try {
          done = await this.step(w, now);
        } catch (err) {
          console.warn(`live-watch ${w.prUrl}: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!done) keep.push(w);
      }
      this.watches = keep;
      this.persist();
    } finally {
      this.ticking = false;
    }
  }

  /** True when this watch is finished and should be dropped. */
  private async step(w: Watch, now: number): Promise<boolean> {
    const repo = repoOfPr(w.prUrl);
    const services = repo ? servicesForRepo(this.registry, repo) : [];
    if (!repo || !services.length) return true;
    const pending = () => services.filter((s) => !w.announced.includes(key(s)));

    if (!w.mergedSha) {
      const pr = await this.io.prState(w.prUrl);
      if (pr?.state === "closed") {
        await this.io.post(w.channel, w.threadTs, `${prLabel(w.prUrl)} was closed without merging, so there is nothing new to retest.`);
        return true;
      }
      if (pr?.state === "merged") w.mergedSha = pr.sha;
    }

    if (w.mergedSha) {
      for (const s of pending()) {
        const deployed = await this.io.deployedCommit(s);
        if (!deployed) continue;
        if ((await this.io.contains(repo, w.mergedSha, deployed)) !== "yes") continue;
        w.announced.push(key(s));
        const last = pending().length === 0;
        const who = s.env === "production" || last ? tag(w.user) : "";
        const ask = who ? `${who}please retest.` : "";
        await this.io.post(
          w.channel,
          w.threadTs,
          `Live on ${s.name} ${s.env} (${siteOf(s)}): ${prLabel(w.prUrl)} is in the running build ${deployed.slice(0, 8)}. ${ask}`.trim(),
        );
      }
      if (!pending().length) return true;
    }

    if (now - w.createdAt > this.maxAgeMs) {
      const days = Math.round(this.maxAgeMs / DAY);
      const why = w.mergedSha
        ? `merged, but not live on ${envList(pending())} yet`
        : "still not merged";
      await this.io.post(
        w.channel,
        w.threadTs,
        `Stopped watching ${prLabel(w.prUrl)} after ${days} days: ${why}. \`npm run version-board\` shows what each deploy is running.`,
      );
      return true;
    }
    return false;
  }

  private persist(): void {
    try {
      this.io.save?.(this.list());
    } catch (err) {
      console.warn(`live-watch: could not save state (${err instanceof Error ? err.message : String(err)})`);
    }
  }
}

// ---------------------------------------------------------------- IO below --

export function loadWatches(file: string): Watch[] {
  try {
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return Array.isArray(raw) ? (raw as Watch[]).filter((w) => w && typeof w.prUrl === "string") : [];
  } catch {
    return [];
  }
}

export function saveWatches(file: string, watches: Watch[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(watches, null, 2)}\n`);
}

async function githubJson<T>(token: string, path: string, fetchImpl: typeof fetch): Promise<T | undefined> {
  const res = await fetchImpl(`https://api.github.com/${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "cloud-agents-slack-bot",
    },
  });
  if (!res.ok) return undefined;
  return (await res.json()) as T;
}

/** GitHub + /health + a Slack poster. The token needs read access to the watched repos. */
export function liveWatchIO(opts: {
  githubToken: string;
  post: LiveWatchIO["post"];
  file?: string;
  fetchImpl?: typeof fetch;
}): LiveWatchIO {
  const f = opts.fetchImpl ?? fetch;
  return {
    prState: async (prUrl) => {
      const ref = parsePullRequestUrl(prUrl);
      if (!ref) return undefined;
      const pr = await githubJson<{ state?: string; merged?: boolean; merge_commit_sha?: string | null }>(
        opts.githubToken,
        `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
        f,
      );
      if (!pr) return undefined;
      if (pr.merged && pr.merge_commit_sha) return { state: "merged", sha: pr.merge_commit_sha };
      return pr.state === "closed" ? { state: "closed" } : { state: "open" };
    },
    deployedCommit: async (service) => {
      const health = await fetchHealth(service.health);
      return health.reachable ? commitFromHealth(health.payload) : undefined;
    },
    contains: async (repo, sha, deployed) => {
      const cmp = await githubJson<{ status?: string }>(opts.githubToken, `repos/${repo}/compare/${sha}...${deployed}`, f);
      if (!cmp?.status) return "unknown";
      return cmp.status === "identical" || cmp.status === "ahead" ? "yes" : "no";
    },
    post: opts.post,
    ...(opts.file ? { save: (watches: Watch[]) => saveWatches(opts.file!, watches) } : {}),
  };
}
