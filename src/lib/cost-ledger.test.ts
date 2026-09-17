import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendCostEntry,
  calendarDay,
  centsForMeter,
  closeJobCost,
  formatCostBoard,
  formatCostClose,
  formatRunningCost,
  harvestRunCosts,
  loadCostLedger,
  loadFactoryCosts,
  meterForEngine,
  meterFromAgentId,
  normalizeMeter,
  projectFromRepo,
  recordJobCost,
  summarizeCost,
} from "./cost-ledger.js";

test("projectFromRepo uses the repo name", () => {
  assert.equal(projectFromRepo("https://github.com/rvegajr/sv-cursor"), "sv-cursor");
  assert.equal(projectFromRepo("https://github.com/rvegajr/farm-slugify.git"), "farm-slugify");
  assert.equal(projectFromRepo(undefined), "unknown");
});

test("calendarDay is YYYY-MM-DD in Chicago", () => {
  assert.match(calendarDay(new Date("2026-09-17T18:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
});

test("ledger rolls this run, project, today, and a monthly outlook", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-ledger-"));
  const file = join(dir, "cost-ledger.jsonl");
  appendCostEntry(file, {
    at: "2026-09-16T12:00:00.000Z",
    project: "sv-cursor",
    cents: 120,
    meter: "cursor-charged",
    source: "build-app",
  });
  appendCostEntry(file, {
    at: "2026-09-17T12:00:00.000Z",
    project: "sv-cursor",
    cents: 80,
    meter: "cursor:billed",
    source: "build-app",
  });
  const today = appendCostEntry(file, {
    at: "2026-09-17T18:00:00.000Z",
    project: "farm-slugify",
    cents: 64,
    meter: "cursor:billed",
    source: "farm",
  });
  const entries = loadCostLedger(file);
  assert.equal(entries.length, 3);
  assert.equal(entries[0]?.meter, "cursor:billed");
  const close = summarizeCost(entries, {
    project: "sv-cursor",
    thisRunCents: 80,
    thisRunMeter: "cursor:billed",
    now: new Date("2026-09-17T20:00:00.000Z"),
  });
  assert.equal(close.projectByMeter["cursor:billed"], 200);
  assert.equal(close.projectRuns, 2);
  assert.equal(close.todayByMeter["cursor:billed"], 80 + 64);
  assert.equal(close.todayProjects, 2);
  const text = formatCostClose(close);
  assert.match(text, /^COST\n/);
  assert.match(text, /this run:\s+\$0\.80\s+Cursor billed/);
  assert.match(text, /this project:\s+Cursor billed \$2\.00/);
  assert.doesNotMatch(text, /Claude/);
  assert.doesNotMatch(text, /Cursor billed \$0\.00/);
  assert.match(text, /if this pace holds:/);
  assert.equal(today.project, "farm-slugify");
});

test("each provider stays on its own meter and is never one dollar", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-mix-"));
  const file = join(dir, "cost-ledger.jsonl");
  appendCostEntry(file, {
    at: "2026-09-17T12:00:00.000Z",
    project: "sv-cursor",
    cents: 120,
    meter: "cursor:billed",
    source: "farm",
  });
  appendCostEntry(file, {
    at: "2026-09-17T13:00:00.000Z",
    project: "sv-cursor",
    cents: 80,
    meter: "claude:api-eq",
    source: "build-app",
  });
  appendCostEntry(file, {
    at: "2026-09-17T14:00:00.000Z",
    project: "sv-cursor",
    cents: 15,
    meter: "colibri:tracked",
    source: "pipeline",
  });
  const entries = loadCostLedger(file);
  const close = summarizeCost(entries, {
    project: "sv-cursor",
    thisRunCents: 15,
    thisRunMeter: "colibri:tracked",
    now: new Date("2026-09-17T20:00:00.000Z"),
  });
  assert.equal(close.projectByMeter["cursor:billed"], 120);
  assert.equal(close.projectByMeter["claude:api-eq"], 80);
  assert.equal(close.projectByMeter["colibri:tracked"], 15);
  const text = formatCostClose(close);
  assert.match(text, /this run:\s+\$0\.15\s+Colibri \(tracked\)/);
  assert.match(text, /Cursor billed \$1\.20/);
  assert.match(text, /Claude API-eq \$0\.80/);
  assert.match(text, /Colibri tracked \$0\.15/);
  assert.doesNotMatch(text, /this project:\s+\$2\.15\b/);
  const board = formatCostBoard(entries, new Date("2026-09-17T20:00:00.000Z"));
  assert.match(board, /Each AI provider is its own meter/);
  assert.match(board, /Colibri tracked \$0\.15/);
});

test("legacy max-api-eq lines load as claude:api-eq", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-legacy-"));
  const file = join(dir, "cost-ledger.jsonl");
  appendCostEntry(file, {
    at: "2026-09-17T12:00:00.000Z",
    project: "hybrid-app",
    cents: 40,
    meter: "max-api-eq",
    source: "build-app",
  });
  const entries = loadCostLedger(file);
  assert.equal(entries[0]?.meter, "claude:api-eq");
});

test("unknown this run still prints project totals and does not append", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-unknown-"));
  const file = join(dir, "cost-ledger.jsonl");
  appendCostEntry(file, {
    at: "2026-09-17T12:00:00.000Z",
    project: "sv-cursor",
    cents: 49,
    meter: "cursor:billed",
    source: "slack",
  });
  const { close, entry } = closeJobCost({
    stateDir: dir,
    project: "sv-cursor",
    cents: undefined,
    meter: "cursor:billed",
    source: "slack",
  });
  assert.equal(entry, undefined);
  assert.match(close, /this run:\s+unknown/);
  assert.doesNotMatch(close, /this run:\s+unknown\s+Cursor/);
  assert.match(close, /this project:\s+Cursor billed \$0\.49/);
  assert.doesNotMatch(close, /Claude/);
  assert.equal(loadCostLedger(file).length, 1);
});

test("recordJobCost appends and returns the close block", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-rec-"));
  const { close } = recordJobCost({
    stateDir: dir,
    project: "rubriq-flow",
    cents: 49,
    meter: "cursor:billed",
    source: "slack",
    agentId: "bc-test",
    repo: "https://github.com/rvegajr/rubriq-flow",
  });
  assert.match(close, /this run:\s+\$0\.49\s+Cursor billed/);
  assert.match(close, /rubriq-flow/);
  const raw = readFileSync(join(dir, "cost-ledger.jsonl"), "utf8");
  assert.match(raw, /"source":"slack"/);
  assert.match(raw, /"meter":"cursor:billed"/);
});

test("meters are AI-agnostic: unknown engines are not Cursor", () => {
  assert.equal(normalizeMeter("cursor-charged"), "cursor:billed");
  assert.equal(meterForEngine("cursor"), "cursor:billed");
  assert.equal(meterForEngine("hybrid"), "claude:api-eq");
  assert.equal(meterForEngine("claude"), "claude:api-eq");
  assert.equal(meterForEngine("local"), "local:local");
  assert.equal(meterForEngine("colibri"), "colibri:tracked");
  assert.equal(meterForEngine("openai"), "openai:tracked");
  assert.equal(meterFromAgentId("bc-abc"), "cursor:billed");
  assert.equal(meterFromAgentId("cc-abc"), "claude:api-eq");
  assert.equal(meterFromAgentId("xyz-1"), "unknown:tracked");
  assert.equal(centsForMeter("cursor:billed", { chargedCents: 120, rawCostCents: 999 }), 120);
  assert.equal(centsForMeter("claude:api-eq", { chargedCents: 120, rawCostCents: 80 }), 80);
  assert.equal(formatRunningCost(120, "cursor:billed"), "COST running: $1.20  Cursor billed");
  assert.equal(formatRunningCost(undefined, "cursor:billed"), undefined);
});

test("COST close omits meters with no data", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-empty-"));
  const { close } = closeJobCost({
    stateDir: dir,
    project: "cloud-agents",
    cents: undefined,
    meter: "cursor:billed",
    source: "pipeline",
  });
  assert.equal(close, "COST\n  this run:     unknown");
  assert.doesNotMatch(close, /\$0\.00/);
  assert.doesNotMatch(close, /Claude/);
  assert.doesNotMatch(close, /this project:/);
});

test("harvest reads farm cents and Claude API-eq, skips tmp scratch", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-harvest-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "farm-2026-09-17T14-16-06-393Z.json"),
    JSON.stringify({
      createdAt: "2026-09-17T14:16:06.393Z",
      updatedAt: "2026-09-17T14:27:05.160Z",
      jobs: [
        { repoName: "farm-slugify", repo: "https://github.com/rvegajr/farm-slugify", agentId: "bc-deb", cents: 63.66518 },
        { repoName: "farm-empty", cents: 0 },
      ],
    }),
  );
  writeFileSync(
    join(dir, "claude-cc-sv.json"),
    JSON.stringify({
      agentId: "cc-55f6ec96",
      repo: "https://github.com/rvegajr/sv-claude",
      apiEquivalentUsd: 6.649168,
    }),
  );
  writeFileSync(
    join(dir, "claude-cc-tmp.json"),
    JSON.stringify({
      agentId: "cc-tmp",
      repo: "/private/tmp/claude/scratchpad/e2e/origin",
      apiEquivalentUsd: 0.22,
      engine: "hybrid",
    }),
  );
  writeFileSync(
    join(dir, "build-bc-vault.json"),
    JSON.stringify({
      agentId: "bc-4936ea78",
      repo: "https://github.com/rvegajr/sv-cursor",
      engine: "cursor",
      chargedCents: 120.25,
      updatedAt: "2026-09-17T05:01:34.575Z",
    }),
  );
  const harvested = harvestRunCosts(dir);
  assert.equal(harvested.some((e) => e.agentId === "cc-tmp"), false);
  assert.equal(harvested.find((e) => e.agentId === "bc-deb")?.cents, 64);
  assert.equal(harvested.find((e) => e.agentId === "cc-55f6ec96")?.cents, 665);
  assert.equal(harvested.find((e) => e.agentId === "bc-4936ea78")?.cents, 120);
  const merged = loadFactoryCosts(dir);
  assert.equal(merged.length, harvested.length);
});

