import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deciderConfigFromEnv, drainDeciderSpend, type DeciderConfig, type FetchFn } from "../../architect-crew-gate/src/decider.js";
import { githubReader, judgmentFixPrompt, withJudgment, type BranchTurn, type GithubReader } from "./cloud-judgment.js";

const decider = (): DeciderConfig => ({
  ...deciderConfigFromEnv({ DECIDER: "jev", TYPESAFE_API_KEY: "sk-test-not-real" }),
  logFile: join(mkdtempSync(join(tmpdir(), "cloud-judgment-")), "decider.jsonl"),
});

const DIFF = (file: string) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +1 @@\n+export const db = openDatabase();\n`;

/** Flags `import-side-effect` on any file named in `bad`. */
const judge = (bad: string[]): FetchFn => async (_url, init) => {
  const body = JSON.parse(init.body);
  const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { noul: id === "import-side-effect" && bad.includes(body.state.file) ? 0.97 : 0.02 }]));
  return { ok: true, status: 200, json: async () => ({ model: "jev-1.13.0", answers, usage: { input_tokens: 100 } }), text: async () => "" };
};

function fakeGithub(heads: string[], diffs: Record<string, string>, pkg?: string) {
  const calls: string[] = [];
  let h = 0;
  const gh: GithubReader = {
    sha: async (_r, ref) => {
      calls.push(`sha ${ref}`);
      return heads[Math.min(h++, heads.length - 1)];
    },
    diff: async (_r, base, head) => {
      calls.push(`diff ${base}...${head}`);
      return diffs[`${base}...${head}`];
    },
    file: async (_r, path, ref) => {
      calls.push(`file ${path}@${ref}`);
      return pkg;
    },
  };
  return { gh, calls };
}

function fakeAgent(results: BranchTurn[]) {
  const prompts: { prompt: string; mode?: string }[] = [];
  let i = 0;
  const send = async (prompt: string, opts?: { mode?: "agent" | "plan" }) => {
    prompts.push({ prompt, mode: opts?.mode });
    return results[Math.min(i++, results.length - 1)]!;
  };
  return { send, prompts };
}

const PUSHED = { status: "finished" as const, repoUrl: "https://github.com/me/app", branch: "cursor/work-1" };

test("withJudgment is the plain send when the decider is off or misconfigured", () => {
  const { send } = fakeAgent([PUSHED]);
  const { gh } = fakeGithub([], {});
  assert.equal(withJudgment(send, { decider: deciderConfigFromEnv({}), baseRef: "main", github: gh }), send);
  const lines: string[] = [];
  assert.equal(withJudgment(send, { decider: deciderConfigFromEnv({ DECIDER: "jev" }), baseRef: "main", github: gh, log: (l) => lines.push(l) }), send);
  assert.match(lines[0]!, /judgment skipped: TYPESAFE_API_KEY is not set/);
});

test("a flag sends the same agent one fix turn; the loop still gets the turn's own report", async () => {
  drainDeciderSpend();
  const report = { ...PUSHED, result: '```json\n{"remaining": 2}\n```' };
  const { send, prompts } = fakeAgent([report, { ...PUSHED, result: "fixed it", prUrl: "https://github.com/me/app/pull/7" }]);
  const { gh, calls } = fakeGithub(["c1", "c2"], { "main...c1": DIFF("src/db.ts") });
  const lines: string[] = [];
  const wrapped = withJudgment(send, { decider: decider(), baseRef: "main", github: gh, fetchFn: judge(["src/db.ts"]), log: (l) => lines.push(l) });
  const out = await wrapped("iterate");
  assert.equal(out.result, report.result, "the report the loop parses is the original turn's");
  assert.equal(out.prUrl, "https://github.com/me/app/pull/7");
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1]!.mode, "agent");
  assert.match(prompts[1]!.prompt, /cursor\/work-1/);
  assert.match(prompts[1]!.prompt, /src\/db\.ts: a module opens a resource or starts work at import time; move it behind a function the caller invokes \[import-side-effect, p=0\.97\]/);
  assert.deepEqual(calls.filter((c) => c.startsWith("diff")), ["diff main...c1"]);
  assert.ok(lines.some((l) => /1 flagged/.test(l)));
  assert.equal(drainDeciderSpend()[0]?.meter, "typesafe:billed");
});

test("the next turn is judged from where the last judgment (and its fix) ended, and an unmoved branch is not judged again", async () => {
  const { send, prompts } = fakeAgent([PUSHED]);
  const { gh, calls } = fakeGithub(["c1", "c2", "c3", "c3"], { "main...c1": DIFF("src/db.ts"), "c2...c3": DIFF("src/other.ts") });
  const wrapped = withJudgment(send, { decider: decider(), baseRef: "main", github: gh, fetchFn: judge(["src/db.ts"]) });
  await wrapped("turn 1"); // judged main...c1, flagged, fix turn, branch now at c2
  await wrapped("turn 2"); // judged c2...c3, clean
  await wrapped("turn 3"); // still c3: nothing new to judge
  assert.deepEqual(calls.filter((c) => c.startsWith("diff")), ["diff main...c1", "diff c2...c3"]);
  assert.equal(prompts.length, 4, "three turns plus one fix");
  drainDeciderSpend();
});

test("plan turns, unfinished turns, and turns with no branch are never judged", async () => {
  const { gh, calls } = fakeGithub(["c1"], { "main...c1": DIFF("src/db.ts") });
  for (const turn of [{ ...PUSHED, status: "error" as const }, { status: "finished" as const }]) {
    const { send } = fakeAgent([turn]);
    await withJudgment(send, { decider: decider(), baseRef: "main", github: gh, fetchFn: judge(["src/db.ts"]) })("x");
  }
  const { send } = fakeAgent([PUSHED]);
  await withJudgment(send, { decider: decider(), baseRef: "main", github: gh, fetchFn: judge(["src/db.ts"]) })("plan it", { mode: "plan" });
  assert.deepEqual(calls, []);
});

test("entry points from package.json are exempt; GitHub outages pass with a note", async () => {
  const { send, prompts } = fakeAgent([PUSHED]);
  const { gh } = fakeGithub(["c1"], { "main...c1": DIFF("src/server.ts") }, JSON.stringify({ scripts: { start: "node dist/server.js" } }));
  const d = decider();
  await withJudgment(send, { decider: d, baseRef: "main", github: gh, fetchFn: judge(["src/server.ts"]) })("x");
  assert.equal(prompts.length, 1, "starting the server in the start script's file is not a defect");
  assert.ok(readFileSync(d.logFile, "utf8").includes("cursor/work-1"), "decisions are logged with repo#branch");
  assert.ok(!readFileSync(d.logFile, "utf8").includes("sk-test-not-real"));

  const lines: string[] = [];
  const down = fakeGithub(["c1"], {});
  const r = await withJudgment(fakeAgent([PUSHED]).send, { decider: decider(), baseRef: "main", github: down.gh, log: (l) => lines.push(l) })("x");
  assert.equal(r.status, "finished");
  assert.match(lines[0]!, /judgment unavailable: GitHub gave no diff for main\.\.\.cursor\/work-1/);
  drainDeciderSpend();
});

test("githubReader asks the REST API for a diff, a sha, and a raw file, with the token, and swallows failures", async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const reader = githubReader("ghp_test", async (url, init) => {
    seen.push({ url, headers: init.headers });
    if (url.includes("/contents/")) return { ok: false, text: async () => "nope" };
    return { ok: true, text: async () => (url.includes("/compare/") ? "diff --git a/x b/x\n" : "abc123\n") };
  });
  const repo = { owner: "me", repo: "app" };
  assert.equal(await reader.diff(repo, "main", "cursor/x"), "diff --git a/x b/x\n");
  assert.equal(await reader.sha(repo, "cursor/x"), "abc123");
  assert.equal(await reader.file(repo, "package.json", "abc123"), undefined);
  assert.equal(seen[0]!.url, "https://api.github.com/repos/me/app/compare/main...cursor%2Fx");
  assert.equal(seen[0]!.headers.Accept, "application/vnd.github.diff");
  assert.equal(seen[0]!.headers.Authorization, "Bearer ghp_test");
  assert.equal(seen[1]!.headers.Accept, "application/vnd.github.sha");
  const broken = githubReader(undefined, async () => Promise.reject(new Error("offline")));
  assert.equal(await broken.sha(repo, "main"), undefined);
});

test("judgmentFixPrompt names the branch and each finding, and tells the agent not to hide one", () => {
  const p = judgmentFixPrompt("cursor/x", [{ file: "test/a.test.ts", question: "vacuous-test", p: 0.93, flagged: true }]);
  assert.match(p, /`cursor\/x`/);
  assert.match(p, /test\/a\.test\.ts: a test asserts nothing about behavior/);
  assert.match(p, /do not edit tests or config to hide a finding/);
});
