import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  budgetAllows,
  farmExitCode,
  formatFarmStatus,
  ideaFilesInDir,
  isFarmIdeaFile,
  loadIdeaSpecs,
  parseConcurrency,
  parseMaxUsd,
  repoNameFromIdeaFile,
  runFarm,
  runPool,
} from "./farm.js";

test("repoNameFromIdeaFile slugs the filename", () => {
  assert.equal(repoNameFromIdeaFile("ideas/ready/JSON Lines.md"), "json-lines");
  assert.equal(repoNameFromIdeaFile("/tmp/farm-slugify.md"), "farm-slugify");
  assert.equal(repoNameFromIdeaFile("..."), "app");
});

test("isFarmIdeaFile skips TEMPLATE and non-markdown", () => {
  assert.equal(isFarmIdeaFile("TEMPLATE.md"), false);
  assert.equal(isFarmIdeaFile("readme.md"), false);
  assert.equal(isFarmIdeaFile("farm-slugify.md"), true);
  assert.equal(isFarmIdeaFile("notes.txt"), false);
});

test("ideaFilesInDir loads markdown except TEMPLATE", () => {
  const dir = mkdtempSync(join(tmpdir(), "farm-ideas-"));
  writeFileSync(join(dir, "TEMPLATE.md"), "# Template\n");
  writeFileSync(join(dir, "a.md"), "# A\n");
  writeFileSync(join(dir, "b.md"), "# B\n");
  writeFileSync(join(dir, "notes.txt"), "nope");
  const files = ideaFilesInDir(dir).map((f) => f.split("/").pop());
  assert.deepEqual(files, ["a.md", "b.md"]);
  const specs = loadIdeaSpecs(dir);
  assert.equal(specs.length, 2);
  assert.equal(specs[0]?.repoName, "a");
});

test("parseMaxUsd and concurrency fallbacks", () => {
  assert.equal(parseMaxUsd(undefined), 10);
  assert.equal(parseMaxUsd("7.5"), 7.5);
  assert.equal(parseMaxUsd("junk"), 10);
  assert.equal(parseConcurrency("3"), 3);
  assert.equal(parseConcurrency("0"), 5);
});

test("budgetAllows: zero cap means unlimited", () => {
  assert.equal(budgetAllows(9999, 0), true);
  assert.equal(budgetAllows(99, 1), true);
  assert.equal(budgetAllows(100, 1), false);
  assert.equal(budgetAllows(101, 1), false);
});

test("runPool caps in-flight workers", async () => {
  let inflight = 0;
  let peak = 0;
  const seen: number[] = [];
  await runPool([0, 1, 2, 3, 4], 2, async (n) => {
    inflight++;
    peak = Math.max(peak, inflight);
    seen.push(n);
    await new Promise((r) => setTimeout(r, 20));
    inflight--;
  });
  assert.equal(peak, 2);
  assert.deepEqual(seen.sort(), [0, 1, 2, 3, 4]);
});

test("runFarm writes a manifest, applies the dollar cap, skips the rest", async () => {
  const root = mkdtempSync(join(tmpdir(), "farm-runs-"));
  const specs = ["one", "two", "three"].map((name) => ({
    ideaFile: `${name}.md`,
    idea: name,
    repoName: name,
  }));
  const started: string[] = [];
  const manifest = await runFarm({
    specs,
    ideasDir: "/tmp/ideas",
    concurrency: 1,
    maxUsd: 0.05,
    id: "farm-test",
    root,
    runJob: async (spec) => {
      started.push(spec.repoName);
      return { status: "done", stopReason: "complete", cents: 10, agentId: `bc-${spec.repoName}`, prUrl: `https://github.com/acme/${spec.repoName}/pull/1` };
    },
  });
  assert.equal(started.length, 1);
  assert.equal(manifest.spentCents, 10);
  assert.equal(manifest.jobs[0]?.status, "done");
  assert.equal(manifest.jobs[0]?.agentId, "bc-one");
  assert.equal(manifest.jobs[1]?.status, "skipped");
  assert.equal(manifest.jobs[2]?.status, "skipped");
  assert.match(manifest.jobs[1]?.error ?? "", /FARM_MAX_USD/);
  assert.equal(farmExitCode(manifest), 4);
  const board = formatFarmStatus(manifest);
  assert.match(board, /farm-test/);
  assert.match(board, /\$0\.10/);
  assert.match(board, /bc-one/);
});

test("runFarm: all complete is exit 0", async () => {
  const root = mkdtempSync(join(tmpdir(), "farm-ok-"));
  const manifest = await runFarm({
    specs: [{ ideaFile: "a.md", idea: "a", repoName: "a" }],
    ideasDir: "/tmp/ideas",
    concurrency: 1,
    maxUsd: 5,
    id: "farm-ok",
    root,
    runJob: async () => ({ status: "done", stopReason: "complete", cents: 120 }),
  });
  assert.equal(farmExitCode(manifest), 0);
  assert.equal(manifest.spentCents, 120);
});

test("runFarm: a thrown job is failed, siblings still run", async () => {
  const root = mkdtempSync(join(tmpdir(), "farm-fail-"));
  const manifest = await runFarm({
    specs: [
      { ideaFile: "a.md", idea: "a", repoName: "a" },
      { ideaFile: "b.md", idea: "b", repoName: "b" },
    ],
    ideasDir: "/tmp/ideas",
    concurrency: 2,
    maxUsd: 50,
    id: "farm-fail",
    root,
    runJob: async (spec) => {
      if (spec.repoName === "a") throw new Error("gh create failed");
      return { status: "done", stopReason: "complete", cents: 50 };
    },
  });
  assert.equal(manifest.jobs.find((j) => j.repoName === "a")?.status, "failed");
  assert.match(manifest.jobs.find((j) => j.repoName === "a")?.error ?? "", /gh create failed/);
  assert.equal(manifest.jobs.find((j) => j.repoName === "b")?.status, "done");
  assert.equal(farmExitCode(manifest), 2);
});
