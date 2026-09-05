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
