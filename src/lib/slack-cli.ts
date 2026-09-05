/**
 * Slack mention as a small CLI: `@<bot>` prints usage, `@<bot> <project>`
 * (or `@<bot> <project> -`) prints that project's options, and a channel whose
 * name starts with a project alias (e.g. #api-bugs) selects that project.
 * `@<bot>` is whatever the workspace named the app; nothing here assumes one.
 */
import { stripMention, type RepoTarget } from "./slack-thread.js";

export interface SlackProject {
  name: string;
  repo: string;
  ref: string;
}

export interface MentionOptions {
  branch?: string;
  autopr?: boolean;
  repo?: string;
  model?: string;
}

export type CliKind = "usage" | "project-usage" | "run" | "version";

export interface MentionCli {
  kind: CliKind;
  project?: SlackProject;
  request: string;
  options: MentionOptions;
  unknownProject?: string;
  /** True when the user typed help/usage/`-`, not merely an empty mention. */
  explicitHelp: boolean;
}

const HELP_TOKENS = new Set(["", "help", "--help", "-h", "-?", "?", "-", "usage", "commands", "options"]);
const VERSION_TOKENS = new Set(["version", "--version", "-v"]);

/** Official Cursor Slack commands — we stay silent so Cursor can answer. */
const CURSOR_NATIVE = /^(help|settings|list|agent)\b/i;

const IDENT_RE = /^[a-z][a-z0-9_-]*$/i;
const OPTION_RE = /\b(branch|autopr|repo|model)=(?:"([^"]*)"|'([^']*)'|(\S+))/gi;

export function isVersionToken(text: string): boolean {
  return VERSION_TOKENS.has(text.trim().toLowerCase());
}

export function isHelpToken(text: string): boolean {
  return HELP_TOKENS.has(text.trim().toLowerCase());
}

export function isCursorNativeCommand(text: string): boolean {
  return CURSOR_NATIVE.test(stripMention(text).trim());
}

export function mentionsUser(text: string, userId: string): boolean {
  if (!userId) return false;
  return new RegExp(`<@${userId}(?:\\|[^>]+)?>`, "i").test(text);
}

/**
 * Parse `SLACK_PROJECTS`: `api=https://github.com/you/api@develop,web=https://github.com/you/web`.
 * A missing `@ref` uses `fallbackRef`. Last duplicate name wins.
 */
export function parseProjects(raw: string | undefined, fallbackRef: string): Map<string, SlackProject> {
  const projects = new Map<string, SlackProject>();
  if (!raw?.trim()) return projects;
  for (const entry of raw.split(/[,\s]+/)) {
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    const name = entry.slice(0, eq).trim().replace(/^#/, "").toLowerCase();
    let repo = entry.slice(eq + 1).trim();
    let ref = fallbackRef;
    const at = repo.lastIndexOf("@");
    if (at > repo.lastIndexOf("/")) {
      ref = repo.slice(at + 1).trim() || fallbackRef;
      repo = repo.slice(0, at);
    }
    if (name && repo) projects.set(name, { name, repo, ref });
  }
  return projects;
}

/**
 * Leading segment of a channel name: `#api-bugs` → `api`, `#web-agent-test` →
 * `web`, `#api` → `api`. Only meaningful for a channel that is already routed
 * to a repo (SLACK_CHANNEL_REPOS); the suffix is the team's habit, not ours.
 */
export function aliasFromChannelName(channelName: string | undefined): string | undefined {
  if (!channelName) return undefined;
  const name = channelName.replace(/^#/, "").toLowerCase();
  const m = name.match(/^([a-z][a-z0-9]*)(?:[-_]|$)/);
  return m?.[1];
}

/** Longest known project alias that is the channel name, or the name plus `-` / `_`. */
export function matchChannelProject(
  channelName: string | undefined,
  projects: Map<string, SlackProject>,
): SlackProject | undefined {
  if (!channelName) return undefined;
  const name = channelName.replace(/^#/, "").toLowerCase();
  let best: SlackProject | undefined;
  for (const project of projects.values()) {
    const alias = project.name.toLowerCase();
    if (name === alias || name.startsWith(`${alias}-`) || name.startsWith(`${alias}_`)) {
      if (!best || alias.length > best.name.length) best = project;
    }
  }
  return best;
}

/**
 * Channel-implied project: known alias at the front of the name, else — for a
 * channel routed to a repo — the leading segment of the name becomes the alias.
 * When the name lookup fails, named keys in SLACK_CHANNEL_REPOS
 * (`#api-bugs=...`) still count.
 */
export function channelProject(
  channelName: string | undefined,
  projects: Map<string, SlackProject>,
  routed?: RepoTarget,
): SlackProject | undefined {
  const matched = matchChannelProject(channelName, projects);
  if (matched) return matched;
  if (!routed) return undefined;
  const alias = aliasFromChannelName(channelName);
  if (!alias) return undefined;
  return projects.get(alias) ?? { name: alias, repo: routed.repo, ref: routed.ref };
}

/** Prefer the live channel name; fall back to `#name` keys that share this channel's repo. */
export function impliedProject(opts: {
  channelId: string;
  channelName: string | undefined;
  routes: Map<string, RepoTarget>;
  projects: Map<string, SlackProject>;
}): SlackProject | undefined {
  const routed = opts.routes.get(opts.channelId.trim()) ?? matchNamedRoute(opts.channelName, opts.routes);
  const fromName = channelProject(opts.channelName, opts.projects, routed);
  if (fromName) return fromName;
  if (!routed) return undefined;
  for (const key of opts.routes.keys()) {
    if (!key.startsWith("#")) continue;
    const target = opts.routes.get(key);
    if (!target || target.repo !== routed.repo || target.ref !== routed.ref) continue;
    const fromKey = channelProject(key.slice(1), opts.projects, routed);
    if (fromKey) return fromKey;
  }
  const matches = [...opts.projects.values()].filter((p) => p.repo === routed.repo);
  return matches.length === 1 ? matches[0] : undefined;
}

function matchNamedRoute(channelName: string | undefined, routes: Map<string, RepoTarget>): RepoTarget | undefined {
  if (!channelName) return undefined;
  return routes.get(`#${channelName.replace(/^#/, "").toLowerCase()}`);
}

export function parseOptions(text: string): { text: string; options: MentionOptions } {
  const options: MentionOptions = {};
  const cleaned = text.replace(OPTION_RE, (_whole, key: string, dqc?: string, sqc?: string, bare?: string) => {
    const value = (dqc ?? sqc ?? bare ?? "").trim();
    if (key === "branch") options.branch = value;
    else if (key === "repo") options.repo = value;
    else if (key === "model") options.model = value;
    else if (key === "autopr") options.autopr = parseBool(value);
    return " ";
  });
  return { text: cleaned.replace(/\s+/g, " ").trim(), options };
}

function parseBool(raw: string): boolean {
  return !/^(false|0|no|off)$/i.test(raw);
}

export function parseMentionCli(
  rawText: string,
  ctx: {
    projects: Map<string, SlackProject>;
    channelProject?: SlackProject;
    fallback?: RepoTarget;
  },
): MentionCli {
  const stripped = stripMention(rawText);
  const { text, options } = parseOptions(stripped);
  const explicitHelp = isHelpToken(text) && text !== "";
  const empty = text === "";

  if (empty || isHelpToken(text)) {
    return { kind: "usage", project: ctx.channelProject, request: "", options, explicitHelp };
  }

  // `version` on its own: which build of the bot is answering.
  if (isVersionToken(text)) {
    return { kind: "version", project: ctx.channelProject, request: "", options, explicitHelp: true };
  }

  const space = text.search(/\s/);
  const first = (space === -1 ? text : text.slice(0, space)).toLowerCase();
  const rest = space === -1 ? "" : text.slice(space).trim();
  const named = IDENT_RE.test(first) ? ctx.projects.get(first) : undefined;

  if (named) {
    if (isHelpToken(rest)) {
      return { kind: "project-usage", project: named, request: "", options, explicitHelp: rest !== "" };
    }
    return { kind: "run", project: named, request: rest, options, explicitHelp: false };
  }

  if (IDENT_RE.test(first) && isHelpToken(rest) && rest !== "") {
    return {
      kind: "usage",
      project: ctx.channelProject,
      request: "",
      options,
      unknownProject: first,
      explicitHelp: true,
    };
  }

  const implied = ctx.channelProject ?? (ctx.fallback ? { name: "default", ...ctx.fallback } : undefined);
  return { kind: "run", project: implied, request: text, options, explicitHelp: false };
}

export function resolveRunTarget(
  cli: MentionCli,
  routed: RepoTarget | undefined,
  fallback: RepoTarget | undefined,
): RepoTarget | undefined {
  const fromProject = cli.project
    ? { repo: cli.options.repo ?? cli.project.repo, ref: cli.options.branch ?? cli.project.ref }
    : undefined;
  const base = fromProject ?? routed ?? fallback;
  if (!base) return undefined;
  return {
    repo: cli.options.repo ?? base.repo,
    ref: cli.options.branch ?? base.ref,
  };
}

export function formatGlobalUsage(opts: {
  bot: string;
  channelName?: string;
  channelProject?: SlackProject;
  projects: SlackProject[];
  unknownProject?: string;
  /** Where the long-form instructions live; printed as a clickable line after the usage block. */
  docsUrl?: string;
}): string {
  const bot = opts.bot;
  const lines: string[] = [];
  if (opts.unknownProject) {
    lines.push(`unknown project \`${opts.unknownProject}\`. pick one from the list.`);
    lines.push("");
  }
  lines.push("```");
  lines.push(`usage: ${bot} [<project>] [options] <request>`);
  lines.push("");
  if (opts.channelProject) {
    const ch = opts.channelName ? `#${opts.channelName.replace(/^#/, "")}` : "(this channel)";
    lines.push(`this channel: ${ch}  →  ${opts.channelProject.name}`);
    lines.push(`  repo    ${opts.channelProject.repo}`);
    lines.push(`  branch  ${opts.channelProject.ref}`);
    lines.push("");
  }
  const projects = [...opts.projects].sort((a, b) => a.name.localeCompare(b.name));
  if (projects.length) {
    lines.push("projects:");
    const width = Math.max(...projects.map((p) => p.name.length));
    for (const p of projects) {
      const mark = p.name === opts.channelProject?.name ? "  ← this channel" : "";
      lines.push(`  ${p.name.padEnd(width)}  ${p.repo} @ ${p.ref}${mark}`);
    }
    lines.push("");
  }
  lines.push("examples:");
  if (opts.channelProject) {
    lines.push(`  ${bot} https://jam.dev/c/<id>`);
    lines.push(`  ${bot} On hosted, the settings page 500s after logout. Add a unit test.`);
    const other = projects.find((p) => p.name !== opts.channelProject?.name);
    if (other) {
      lines.push(`  ${bot} ${other.name} -`);
      lines.push(`  ${bot} ${other.name} <request>`);
    }
  } else {
    const sample = projects[0]?.name ?? "<project>";
    lines.push(`  ${bot} ${sample} https://jam.dev/c/<id>`);
    lines.push(`  ${bot} ${sample} On hosted, the settings page 500s after logout.`);
    lines.push(`  ${bot} ${sample} -`);
  }
  lines.push("");
  lines.push("options:");
  lines.push("  branch=<name>        base branch (default: the project's)");
  lines.push("  autopr=true|false    open a PR when done (default: true)");
  lines.push("  model=<id>           override CURSOR_MODEL");
  lines.push("");
  lines.push(`${bot}                 this usage`);
  lines.push(`${bot} <project>       options for that project`);
  lines.push(`${bot} <project> -     same`);
  lines.push(`${bot} version         which build of the bot is answering`);
  lines.push("");
  lines.push("deploys happen when a PR merges, not from here.");
  lines.push("```");
  if (opts.docsUrl) lines.push(docsLine(opts.docsUrl));
  return lines.join("\n");
}

/** Outside the code block so Slack renders it as a link. */
export function docsLine(url: string): string {
  return `Full instructions: ${url}`;
}

export function formatProjectUsage(opts: {
  bot: string;
  project: SlackProject;
  channelName?: string;
  channelProjectName?: string;
  docsUrl?: string;
}): string {
  const { bot, project } = opts;
  const implied = opts.channelProjectName === project.name;
  const channel = opts.channelName ? `#${opts.channelName.replace(/^#/, "")}` : undefined;
  const lines = ["```", `usage: ${bot} ${project.name} [options] <request>`];
  lines.push("", `  repo    ${project.repo}`, `  branch  ${project.ref}`, "  autopr  true");
  lines.push("");
  if (implied && channel) {
    lines.push(`${channel} already selects ${project.name}; you can omit the name.`);
    lines.push("");
  }
  lines.push("examples:");
  if (implied) {
    lines.push(`  ${bot} https://jam.dev/c/<id>`);
    lines.push(`  ${bot} On hosted, a student hits /settings after logout and gets a 500.`);
  }
  lines.push(`  ${bot} ${project.name} https://jam.dev/c/<id>`);
  lines.push(`  ${bot} ${project.name} autopr=true On hosted, the submissions page 500s.`);
  lines.push("");
  lines.push("options: branch=<name>  autopr=true|false  model=<id>");
  lines.push("hooks:   force-push, push to develop/main, deploys, and --no-verify are blocked");
  lines.push("deploy:  merge the PR — the host builds and posts the result here");
  lines.push("```");
  if (opts.docsUrl) lines.push(docsLine(opts.docsUrl));
  return lines.join("\n");
}

export function listedProjects(projects: Map<string, SlackProject>, extra?: SlackProject): SlackProject[] {
  const out = new Map(projects);
  if (extra && !out.has(extra.name)) out.set(extra.name, extra);
  return [...out.values()];
}
