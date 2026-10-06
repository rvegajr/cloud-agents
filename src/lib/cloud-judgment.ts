import {
  entryStemsOf,
  judgeDiff,
  JUDGMENT_QUESTIONS,
  logJudgment,
  type Decision,
  type DeciderConfig,
  type FetchFn,
} from "../../architect-crew-gate/src/decider.js";
import { parseGithubRepoUrl, parsePullRequestUrl, type GithubRepoRef } from "./github.js";

/**
 * The judgment rule for engines that own no clone: a Cursor cloud agent pushes to a
 * branch, so the gate in `quality-gate.ts` never sees its work. After each turn that
 * moved the branch, this reads the new commits' diff from GitHub, asks the decision
 * model the same questions, and on a flag sends the same agent ONE fix turn. The fix
 * is never judged as blocking (the gate's first-attempt-only rule), and the turn's own
 * result is returned untouched so the loop still parses the report it asked for.
 */

export interface BranchTurn {
  status: "finished" | "error" | "cancelled";
  result?: string;
  prUrl?: string;
  repoUrl?: string;
  branch?: string;
}

export interface GithubReader {
  /** Unified diff `base...head`; undefined when GitHub cannot answer. */
  diff(repo: GithubRepoRef, base: string, head: string): Promise<string | undefined>;
  /** The commit a ref points at. */
  sha(repo: GithubRepoRef, ref: string): Promise<string | undefined>;
  /** A file's text at a ref. */
  file(repo: GithubRepoRef, path: string, ref: string): Promise<string | undefined>;
  /** The head branch of a pull request. */
  prHead(repo: GithubRepoRef, number: number): Promise<string | undefined>;
}

type HttpFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;

export function githubReader(token: string | undefined, fetchFn: HttpFetch = fetch as unknown as HttpFetch): GithubReader {
  const get = async (path: string, accept: string): Promise<string | undefined> => {
    const headers: Record<string, string> = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "cloud-agents" };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetchFn(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(30_000) });
      return res.ok ? await res.text() : undefined;
    } catch {
      return undefined;
    }
  };
  const repoPath = (r: GithubRepoRef) => `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
  return {
    diff: (r, base, head) => get(`${repoPath(r)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, "application/vnd.github.diff"),
    sha: async (r, ref) => (await get(`${repoPath(r)}/commits/${encodeURIComponent(ref)}`, "application/vnd.github.sha"))?.trim() || undefined,
    file: (r, path, ref) => get(`${repoPath(r)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`, "application/vnd.github.raw+json"),
    prHead: async (r, number) => {
      const raw = await get(`${repoPath(r)}/pulls/${number}`, "application/vnd.github+json");
      try {
        return raw ? ((JSON.parse(raw) as { head?: { ref?: string } }).head?.ref ?? undefined) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

export function judgmentFixPrompt(branch: string, flagged: Decision[]): string {
  const lines = flagged.map((d) => {
    const q = JUDGMENT_QUESTIONS.find((x) => x.id === d.question);
    return `- ${d.file}: ${q?.feedback ?? d.question} [${d.question}, p=${d.p.toFixed(2)}]`;
  });
  return (
    `## Review before you continue\n\n` +
    `An automated reviewer read the commits you just pushed to \`${branch}\` and flagged:\n\n${lines.join("\n")}\n\n` +
    `Fix the cause of each in this branch, then commit and push. Change nothing else, and do not edit ` +
    `tests or config to hide a finding. If a finding is wrong, leave that code as it is and say why in one line. ` +
    `Reply with a short summary of what you changed.`
  );
}

export interface JudgmentWrapOpts {
  decider: DeciderConfig;
  /** The ref the work branched from; the first judged diff is `baseRef...branch`. */
  baseRef: string;
  github: GithubReader;
  log?: (line: string) => void;
  /** Test seam for the decision model's HTTP call. */
  fetchFn?: FetchFn;
}

/**
 * Wrap a cloud engine's send. A no-op when the decider is off or misconfigured, for
 * plan-mode turns, for turns that did not finish, and when the branch has not moved.
 */
export function withJudgment<O extends { mode?: "agent" | "plan" }, T extends BranchTurn>(
  send: (prompt: string, opts?: O) => Promise<T>,
  o: JudgmentWrapOpts,
): (prompt: string, opts?: O) => Promise<T> {
  if (o.decider.provider === "off") return send;
  if (o.decider.problem) {
    o.log?.(`judgment skipped: ${o.decider.problem}`);
    return send;
  }
  const judged = new Map<string, string>(); // repoUrl#branch -> last judged head sha
  const log = o.log ?? (() => {});
  return async (prompt, opts) => {
    const turn = await send(prompt, opts);
    if (turn.status !== "finished" || opts?.mode === "plan") return turn;
    // Cursor's run result may name the PR without the branch (`branch` is optional in the SDK): fall back to the PR's head.
    let branch = turn.branch;
    let repoUrl = turn.repoUrl;
    const pr = turn.prUrl ? parsePullRequestUrl(turn.prUrl) : undefined;
    if ((!branch || !repoUrl) && pr) {
      repoUrl = `https://github.com/${pr.owner}/${pr.repo}`;
      branch = await o.github.prHead({ owner: pr.owner, repo: pr.repo }, pr.number);
    }
    const repo = repoUrl ? parseGithubRepoUrl(repoUrl) : undefined;
    if (!branch || !repo) {
      // Never silent: a skipped judgment is a line in the log.
      log(`judgment skipped: the turn reported no pushed branch${turn.prUrl ? ` (PR ${turn.prUrl} head unreadable)` : " or PR"}`);
      return turn;
    }
    const key = `${repoUrl}#${branch}`;
    const head = await o.github.sha(repo, branch);
    if (!head || head === judged.get(key)) return turn;
    const base = judged.get(key) ?? o.baseRef;
    const diff = await o.github.diff(repo, base, head);
    if (diff === undefined) {
      log(`judgment unavailable: GitHub gave no diff for ${base}...${branch}`);
      return turn;
    }
    let entryStems: Set<string> | undefined;
    try {
      const pkg = await o.github.file(repo, "package.json", head);
      entryStems = pkg ? entryStemsOf(JSON.parse(pkg)) : undefined;
    } catch {
      /* no or unreadable package.json: no entry points to exempt */
    }
    const j = await judgeDiff(diff, o.decider, { entryStems, fetchFn: o.fetchFn });
    logJudgment(o.decider, j, { cwd: key, kind: "cloud", attempt: 0, base, blocking: true });
    judged.set(key, head);
    const flagged = j.decisions.filter((d) => d.flagged);
    const tag = `${o.decider.provider}${j.model ? ` ${j.model}` : ""}`;
    log(`judgment (${tag}): ${j.decisions.length} decision(s) over ${new Set(j.decisions.map((d) => d.file)).size} file(s), ${flagged.length} flagged${j.errors.length ? `, ${j.errors.length} error(s)` : ""}`);
    if (!flagged.length) return turn;
    for (const d of flagged) log(`  flagged ${d.file}: ${d.question} p=${d.p.toFixed(2)}`);
    const fix = await send(judgmentFixPrompt(branch, flagged), { mode: "agent" } as O);
    log(`judgment fix turn: ${fix.status}`);
    // The fix is advisory from here on: mark its commits judged so the next turn's diff starts after it.
    const after = await o.github.sha(repo, branch);
    if (after) judged.set(key, after);
    return { ...turn, prUrl: fix.prUrl ?? turn.prUrl };
  };
}
