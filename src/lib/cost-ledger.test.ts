import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
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
  loadCostLedger,
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
  assert.match(close, /this run:\s+unknown\s+Cursor billed/);
  assert.match(close, /this project:\s+Cursor billed \$0\.49/);
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
