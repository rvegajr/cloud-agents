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
  loadCostLedger,
  meterForEngine,
  meterFromAgentId,
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
    meter: "cursor-charged",
    source: "build-app",
  });
  const today = appendCostEntry(file, {
    at: "2026-09-17T18:00:00.000Z",
    project: "farm-slugify",
    cents: 64,
    meter: "cursor-charged",
    source: "farm",
  });
  const entries = loadCostLedger(file);
  assert.equal(entries.length, 3);
  const close = summarizeCost(entries, {
    project: "sv-cursor",
    thisRunCents: 80,
    thisRunMeter: "cursor-charged",
    now: new Date("2026-09-17T20:00:00.000Z"),
  });
  assert.equal(close.projectCursorCents, 200);
  assert.equal(close.projectClaudeCents, 0);
  assert.equal(close.projectRuns, 2);
  assert.equal(close.todayCursorCents, 80 + 64);
  assert.equal(close.todayProjects, 2);
  const text = formatCostClose(close);
  assert.match(text, /^COST\n/);
  assert.match(text, /this run:\s+\$0\.80\s+Cursor billed/);
  assert.match(text, /this project:/);
  assert.match(text, /if this pace holds:/);
  assert.equal(today.project, "farm-slugify");
});

test("Cursor billed and Claude Max never share one dollar figure", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-mix-"));
  const file = join(dir, "cost-ledger.jsonl");
  appendCostEntry(file, {
    at: "2026-09-17T12:00:00.000Z",
    project: "sv-cursor",
    cents: 120,
    meter: "cursor-charged",
    source: "farm",
  });
  appendCostEntry(file, {
    at: "2026-09-17T13:00:00.000Z",
    project: "sv-cursor",
    cents: 80,
    meter: "claude-max",
    source: "build-app",
  });
  const entries = loadCostLedger(file);
  const close = summarizeCost(entries, {
    project: "sv-cursor",
    thisRunCents: 80,
    thisRunMeter: "claude-max",
    now: new Date("2026-09-17T20:00:00.000Z"),
  });
  assert.equal(close.projectCursorCents, 120);
  assert.equal(close.projectClaudeCents, 80);
  const text = formatCostClose(close);
  assert.match(text, /this run:\s+\$0\.80\s+Claude Max API-eq/);
  assert.match(text, /this project:\s+Cursor \$1\.20 · Claude \$0\.80/);
  assert.doesNotMatch(text, /this project:\s+\$2\.00\b/);
  const board = formatCostBoard(entries, new Date("2026-09-17T20:00:00.000Z"));
  assert.match(board, /Cursor \$1\.20 · Claude \$0\.80/);
  assert.match(board, /separate meters/);
});

test("legacy max-api-eq lines load as Claude Max", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-legacy-"));
  const file = join(dir, "cost-ledger.jsonl");
  appendCostEntry(file, {
    at: "2026-09-17T12:00:00.000Z",
    project: "hybrid-app",
    cents: 40,
    meter: "max-api-eq" as never,
    source: "build-app",
  });
  const entries = loadCostLedger(file);
  assert.equal(entries[0]?.meter, "claude-max");
});

test("unknown this run still prints project totals and does not append", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-unknown-"));
  const file = join(dir, "cost-ledger.jsonl");
  appendCostEntry(file, {
    at: "2026-09-17T12:00:00.000Z",
    project: "sv-cursor",
    cents: 49,
    meter: "cursor-charged",
    source: "slack",
  });
  const { close, entry } = closeJobCost({
    stateDir: dir,
    project: "sv-cursor",
    cents: undefined,
    meter: "cursor-charged",
    source: "slack",
  });
  assert.equal(entry, undefined);
  assert.match(close, /this run:\s+unknown\s+Cursor billed/);
  assert.match(close, /this project:\s+Cursor \$0\.49 · Claude \$0\.00/);
  assert.equal(loadCostLedger(file).length, 1);
});

test("recordJobCost appends and returns the close block", () => {
  const dir = mkdtempSync(join(tmpdir(), "cost-rec-"));
  const { close } = recordJobCost({
    stateDir: dir,
    project: "rubriq-flow",
    cents: 49,
    meter: "cursor-charged",
    source: "slack",
    agentId: "bc-test",
    repo: "https://github.com/rvegajr/rubriq-flow",
  });
  assert.match(close, /this run:\s+\$0\.49\s+Cursor billed/);
  assert.match(close, /rubriq-flow/);
  const raw = readFileSync(join(dir, "cost-ledger.jsonl"), "utf8");
  assert.match(raw, /"source":"slack"/);
});

test("meterForEngine and centsForMeter keep Cursor vs Claude distinct", () => {
  assert.equal(meterForEngine("cursor"), "cursor-charged");
  assert.equal(meterForEngine("hybrid"), "claude-max");
  assert.equal(meterForEngine("claude"), "claude-max");
  assert.equal(meterForEngine("local"), "local");
  assert.equal(meterFromAgentId("bc-abc"), "cursor-charged");
  assert.equal(meterFromAgentId("cc-abc"), "claude-max");
  assert.equal(centsForMeter("cursor-charged", { chargedCents: 120, rawCostCents: 999 }), 120);
  assert.equal(centsForMeter("claude-max", { chargedCents: 120, rawCostCents: 80 }), 80);
});
