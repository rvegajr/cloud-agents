/**
 * The one thing the bot does on GitHub: flip a Cloud Agent's PR from draft to
 * ready once the verifier says the work is done.
 *
 * Cloud Agents always open PRs as drafts; the SDK has no switch for it. Most
 * repos' auto-merge (and this kit's target-repo-kit workflow) ignore drafts,
 * so without this step every unattended run parks on "someone click Ready".
 * Doing it here, after verify, means a failed verify leaves the PR a draft
 * and a passed one becomes merge-eligible. That is the policy; the repo's
 * own gate (required checks, protected paths) still decides whether it lands.
 *
 * Token requirement: markPullRequestReadyForReview only accepts user-level
 * OAuth tokens (classic PAT with `repo` scope). Fine-grained PATs and App /
 * Actions installation tokens get FORBIDDEN "Resource not accessible" even with
 * Pull requests: write + Contents: read, and there is no REST equivalent.
 * Verified 2026-09-05 against YOLOVibeCode/scholaracle#17.
 */

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export function parsePullRequestUrl(url: string): PullRequestRef | undefined {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(url.trim());
  if (!m) return undefined;
  return { owner: m[1] ?? "", repo: m[2] ?? "", number: Number(m[3]) };
}

type GraphQlResponse<T> = { data?: T; errors?: Array<{ message: string }> };

async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "cloud-agents-slack-bot",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as GraphQlResponse<T>;
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!res.ok || !json.data) throw new Error(`GitHub GraphQL HTTP ${res.status}`);
  return json.data;
}

export type MarkReadyResult = "marked" | "already-ready";

export async function markPullRequestReady(
  prUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MarkReadyResult> {
  const ref = parsePullRequestUrl(prUrl);
  if (!ref) throw new Error(`Not a github.com pull request URL: ${prUrl}`);

  const lookup = await graphql<{ repository: { pullRequest: { id: string; isDraft: boolean } | null } | null }>(
    token,
    `query($owner: String!, $repo: String!, $number: Int!) {
       repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id isDraft } }
     }`,
    { owner: ref.owner, repo: ref.repo, number: ref.number },
    fetchImpl,
  );
  const pr = lookup.repository?.pullRequest;
  if (!pr) throw new Error(`PR not found: ${prUrl}`);
  if (!pr.isDraft) return "already-ready";

  await graphql(
    token,
    `mutation($id: ID!) {
       markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } }
     }`,
    { id: pr.id },
    fetchImpl,
  );
  return "marked";
}

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

/** https://github.com/owner/repo or …/repo.git — not a PR URL. */
export function parseGithubRepoUrl(url: string): GithubRepoRef | undefined {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!m) return undefined;
  if (m[2] === "pull") return undefined;
  return { owner: m[1]!, repo: m[2]! };
}

export function cursorAppSlugs(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.CURSOR_GITHUB_APP_SLUG?.trim();
  if (raw) return raw.split(/[,\s]+/).map((s) => s.toLowerCase()).filter(Boolean);
  return ["cursor"];
}

export function installationIsCursor(appSlug: string | undefined, slugs: string[]): boolean {
  const s = (appSlug ?? "").toLowerCase();
  if (!s) return false;
  return slugs.some((want) => s === want || s.includes(want));
}

export type GhExec = (file: string, args: string[], opts?: { encoding?: BufferEncoding }) => string;

export function resolveGithubToken(
  env: NodeJS.ProcessEnv = process.env,
  exec: GhExec | undefined = undefined,
): string | undefined {
  const fromEnv = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (!exec) return undefined;
  try {
    const t = exec("gh", ["auth", "token"], { encoding: "utf8" }).trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

export type CursorAppGrant =
  | { status: "inherited"; installationId: number }
  | { status: "added"; installationId: number }
  | { status: "already"; installationId: number }
  | { status: "missing-app" }
  | { status: "forbidden"; detail: string }
  | { status: "unknown"; detail: string }
  | { status: "no-token" }
  | { status: "not-a-github-repo"; detail: string };

interface InstallationList {
  installations?: Array<{
    id: number;
    app_slug?: string;
    repository_selection?: string;
  }>;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "cloud-agents-farm",
  };
}

/**
 * After `gh repo create`, new repos are invisible to Cursor unless the GitHub App
 * is installed with "All repositories" or this repo is added to a selected-repo
 * install. Call this before Agent.create so a farm wave does not pay for a VM
 * that cannot clone.
 */
export async function grantCursorGithubApp(
  repoUrl: string,
  opts: {
    token?: string;
    fetchImpl?: typeof fetch;
    slugs?: string[];
  } = {},
): Promise<CursorAppGrant> {
  const token = opts.token?.trim();
  if (!token) return { status: "no-token" };
  const ref = parseGithubRepoUrl(repoUrl);
  if (!ref) return { status: "not-a-github-repo", detail: repoUrl };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const slugs = opts.slugs ?? cursorAppSlugs();

  const listRes = await fetchImpl("https://api.github.com/user/installations?per_page=100", {
    headers: ghHeaders(token),
  });
  if (listRes.status === 401 || listRes.status === 403) {
    const body = await listRes.text();
    return {
      status: "unknown",
      detail: `list installations HTTP ${listRes.status}${body ? `: ${body.slice(0, 180)}` : ""}`,
    };
  }
  if (!listRes.ok) {
    return { status: "unknown", detail: `list installations HTTP ${listRes.status}` };
  }
  const list = (await listRes.json()) as InstallationList;
  const inst = (list.installations ?? []).find((i) => installationIsCursor(i.app_slug, slugs));
  if (!inst) return { status: "missing-app" };
  if (inst.repository_selection === "all") {
    return { status: "inherited", installationId: inst.id };
  }

  const repoRes = await fetchImpl(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
    headers: ghHeaders(token),
  });
  if (!repoRes.ok) {
    return { status: "forbidden", detail: `repo lookup HTTP ${repoRes.status}` };
  }
  const repo = (await repoRes.json()) as { id?: number };
  if (!repo.id) return { status: "forbidden", detail: "repo lookup had no id" };

  const addRes = await fetchImpl(
    `https://api.github.com/user/installations/${inst.id}/repositories/${repo.id}`,
    { method: "PUT", headers: ghHeaders(token) },
  );
  if (addRes.status === 204 || addRes.status === 200) {
    return { status: "added", installationId: inst.id };
  }
  if (addRes.status === 422) {
    return { status: "already", installationId: inst.id };
  }
  const body = await addRes.text();
  return { status: "forbidden", detail: `add repo HTTP ${addRes.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
}

/** True when we *know* Cursor cannot clone this new repo. Unknown/no-token still boot the VM. */
export function cursorAppGrantBlocksCreate(grant: CursorAppGrant): boolean {
  return grant.status === "missing-app" || grant.status === "forbidden" || grant.status === "not-a-github-repo";
}

export function formatCursorAppGrant(grant: CursorAppGrant): string {
  switch (grant.status) {
    case "inherited":
      return "Cursor GitHub App covers this repo (installation is All repositories).";
    case "added":
      return "Added this repo to the Cursor GitHub App installation.";
    case "already":
      return "Repo was already on the Cursor GitHub App installation.";
    case "missing-app":
      return "No Cursor GitHub App installation on this account. Connect GitHub at cursor.com/agents and prefer All repositories so new farm repos inherit access.";
    case "no-token":
      return "No GitHub token; cannot grant the Cursor GitHub App. Set GITHUB_TOKEN or `gh auth login`, then grant the repo at cursor.com/agents.";
    case "unknown":
      return `Could not list GitHub App installations (${grant.detail}). A classic gh token cannot do this. Install the Cursor GitHub App with All repositories so new farm repos inherit access, or grant each repo at cursor.com/agents.`;
    case "not-a-github-repo":
      return `Not a github.com repo URL (${grant.detail}).`;
    case "forbidden":
      return `Could not add this repo to the Cursor GitHub App (${grant.detail}). Grant it at cursor.com/agents or install the app with All repositories.`;
  }
}
