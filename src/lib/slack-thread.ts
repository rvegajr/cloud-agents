/**
 * Pure helpers for the Slack bot: recover a durable agent id from a thread,
 * honour a channel allowlist, and drop Slack's duplicate deliveries. No SDK
 * and no Bolt — tests can drive these with plain objects.
 */

export const AGENT_ID_RE = /\bagent:\s*(bc-[a-z0-9-]+)/i;

export function findAgentId(messages: Array<{ text?: string | null } | undefined>): string | undefined {
  for (const m of messages) {
    const match = m?.text?.match(AGENT_ID_RE);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** Empty allowlist means every channel is allowed (fine for a first run). */
export function isAllowedChannel(channelId: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const id = channelId.trim();
  const names = new Set(allowlist.map((s) => s.replace(/^#/, "").trim()).filter(Boolean));
  return names.has(id) || names.has(id.replace(/^#/, ""));
}

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface RepoTarget {
  repo: string;
  ref: string;
}

/**
 * Parse `SLACK_CHANNEL_REPOS`: `C123=https://github.com/o/a@develop, #web=https://github.com/o/b`.
 * Keys are channel IDs (`C…`) or names (`#name`, kept with the `#`, lower-cased).
 * One bot process, one Slack app, many repos. A missing `@ref` falls back to `fallbackRef`.
 */
export function parseChannelRepos(raw: string | undefined, fallbackRef: string): Map<string, RepoTarget> {
  const routes = new Map<string, RepoTarget>();
  if (!raw?.trim()) return routes;
  for (const entry of raw.split(/[,\s]+/)) {
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    const rawKey = entry.slice(0, eq).trim();
    const channel = rawKey.startsWith("#") ? rawKey.toLowerCase() : rawKey;
    let repo = entry.slice(eq + 1).trim();
    let ref = fallbackRef;
    const at = repo.lastIndexOf("@");
    if (at > repo.lastIndexOf("/")) {
      ref = repo.slice(at + 1).trim() || fallbackRef;
      repo = repo.slice(0, at);
    }
    if (channel && repo) routes.set(channel, { repo, ref });
  }
  return routes;
}

/** True when at least one route is keyed by `#name` and so needs a name lookup. */
export function hasNamedRoutes(routes: Map<string, RepoTarget>): boolean {
  for (const key of routes.keys()) if (key.startsWith("#")) return true;
  return false;
}

/** Route matched by ID, then by `#name`, else the process-wide TARGET_REPO/TARGET_REF (if any). */
export function findRoute(
  channelId: string,
  channelName: string | undefined,
  routes: Map<string, RepoTarget>,
): RepoTarget | undefined {
  const byId = routes.get(channelId.trim());
  if (byId) return byId;
  if (!channelName) return undefined;
  return routes.get(`#${channelName.replace(/^#/, "").toLowerCase()}`);
}

export function resolveTarget(
  channelId: string,
  channelName: string | undefined,
  routes: Map<string, RepoTarget>,
  fallback: RepoTarget | undefined,
): RepoTarget | undefined {
  return findRoute(channelId, channelName, routes) ?? fallback;
}

/** Strip Slack user mentions (`<@U123>` / `<@U123|name>`) so the rest is the request. */
export function stripMention(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatThreadContext(messages: Array<{ user?: string; text?: string | null } | undefined>): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (!m?.text) continue;
    const body = stripMention(m.text);
    if (!body) continue;
    lines.push(`${m.user ?? "unknown"}: ${body}`);
  }
  return lines.join("\n");
}

export class Deduper {
  private seenAt = new Map<string, number>();
  constructor(private ttlMs = 10 * 60 * 1000) {}

  /** True if this id was already recorded within the TTL (a duplicate). */
  seen(id: string): boolean {
    const now = Date.now();
    for (const [key, exp] of this.seenAt) {
      if (exp <= now) this.seenAt.delete(key);
    }
    if (this.seenAt.has(id)) return true;
    this.seenAt.set(id, now + this.ttlMs);
    return false;
  }
}

export class ConcurrencyGate {
  private n = 0;
  constructor(private max: number) {}
  get active(): number {
    return this.n;
  }
  tryAcquire(): boolean {
    if (this.max <= 0) return false;
    if (this.n >= this.max) return false;
    this.n += 1;
    return true;
  }
  release(): void {
    if (this.n > 0) this.n -= 1;
  }
}
