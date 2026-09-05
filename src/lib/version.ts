/**
 * Which build is this? A long-lived bot is the one process where "I fixed that
 * last week" and "the running code" can silently disagree, so the version is
 * stamped at deploy time and reported at startup and on `@<bot> version`.
 *
 * Three sources, in order:
 *   1. `BUILD_INFO`, a JSON blob in the environment. This is what survives to a
 *      host: `railway up` honours `.gitignore`, so a generated file cannot be
 *      shipped, and a deployed container has no `.git` to ask.
 *   2. `version.json`, written by `npm run stamp`, for hosts that take files and
 *      for reading back what the last stamp said.
 *   3. Live git, for a working copy. Marks a dirty tree, so a local run never
 *      claims to be a clean tag.
 *
 * Falls back to the package version alone, which is honest about knowing less.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface VersionInfo {
  /** Semver from package.json, the number releases are tagged with. */
  version: string;
  /** Nearest tag, when the build was made from one (`v0.2.0`, `v0.2.0-3-gabc1234`). */
  tag?: string;
  commit?: string;
  branch?: string;
  /** True when the working tree had uncommitted changes at stamp time. */
  dirty?: boolean;
  /** ISO 8601. Stamp time for a stamped build, commit time for a live checkout. */
  builtAt?: string;
  source: "BUILD_INFO" | "version.json" | "git" | "package.json";
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const STAMP_FILE = "version.json";
export const STAMP_ENV = "BUILD_INFO";

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function git(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** The stamp a deploy set in the host's variables. Malformed JSON is ignored. */
function fromEnv(): VersionInfo | undefined {
  const raw = process.env[STAMP_ENV]?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<VersionInfo>;
    if (!parsed.version) return undefined;
    return { ...parsed, version: parsed.version, source: "BUILD_INFO" };
  } catch {
    return undefined;
  }
}

/** Read the stamp a deploy left behind on disk, ignoring anything malformed. */
function fromStamp(): VersionInfo | undefined {
  const path = join(ROOT, STAMP_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<VersionInfo>;
    if (!raw.version) return undefined;
    return { ...raw, version: raw.version, source: "version.json" };
  } catch {
    return undefined;
  }
}

function fromGit(): VersionInfo | undefined {
  const commit = git(["rev-parse", "--short=12", "HEAD"]);
  if (!commit) return undefined;
  const tag = git(["describe", "--tags", "--always", "--dirty"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const committedAt = git(["log", "-1", "--format=%cI"]);
  return {
    version: packageVersion(),
    ...(tag ? { tag } : {}),
    commit,
    ...(branch ? { branch } : {}),
    dirty: Boolean(git(["status", "--porcelain"])),
    ...(committedAt ? { builtAt: committedAt } : {}),
    source: "git",
  };
}

let cached: VersionInfo | undefined;

export function versionInfo(): VersionInfo {
  if (!cached) cached = fromEnv() ?? fromStamp() ?? fromGit() ?? { version: packageVersion(), source: "package.json" };
  return cached;
}

/** Build the stamp from the current checkout. Used by `npm run stamp`. */
export function stampFromGit(): VersionInfo {
  const live = fromGit();
  if (!live) throw new Error("not a git checkout, so there is nothing to stamp");
  return { ...live, builtAt: new Date().toISOString(), source: "version.json" };
}

export function stampPath(): string {
  return join(ROOT, STAMP_FILE);
}

/** `BUILD_INFO=<json>`, the form the stamp travels to a host in. */
export function stampEnvPair(info: VersionInfo): string {
  const { source: _source, ...rest } = info;
  return `${STAMP_ENV}=${JSON.stringify(rest)}`;
}

/** One line for a log or a Slack reply: `v0.2.0 (abc123def456 on main, dirty)`. */
export function formatVersion(info: VersionInfo = versionInfo()): string {
  const bits: string[] = [];
  if (info.commit) bits.push(info.commit);
  if (info.branch) bits.push(`on ${info.branch}`);
  if (info.dirty) bits.push("dirty");
  const detail = bits.length ? ` (${bits.join(" ")})` : "";
  const tag = info.tag && info.tag !== `v${info.version}` ? ` [${info.tag}]` : "";
  return `v${info.version}${tag}${detail}`;
}

/** The `@<bot> version` reply: enough to tell two deploys apart. */
export function formatVersionBlock(info: VersionInfo = versionInfo()): string {
  const rows: Array<[string, string]> = [["version", `v${info.version}`]];
  if (info.tag) rows.push(["tag", info.tag]);
  if (info.commit) rows.push(["commit", info.commit]);
  if (info.branch) rows.push(["branch", info.branch]);
  if (info.dirty) rows.push(["tree", "dirty (uncommitted changes at build time)"]);
  if (info.builtAt) rows.push([info.source === "git" ? "committed" : "built", info.builtAt]);
  rows.push([
    "stamped",
    info.source === "BUILD_INFO"
      ? `${STAMP_ENV}, set by \`npm run deploy\``
      : info.source === "version.json"
        ? "version.json, written by `npm run stamp`"
        : info.source === "git"
          ? "live git checkout (no stamp — this is not a deployed build)"
          : "package.json only (no stamp, no git)",
  ]);
  const width = Math.max(...rows.map(([k]) => k.length));
  return ["```", ...rows.map(([k, v]) => `${k.padEnd(width)}  ${v}`), "```"].join("\n");
}
