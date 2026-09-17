import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Append-only factory ledger. Every job's last written lines are a COST close
 * from this file. Cursor billed dollars and Claude Max API-eq never share a
 * single number — two meters, always tracked.
 */

export type CostMeter = "cursor-charged" | "claude-max" | "local";

export interface CostEntry {
  at: string;
  day: string;
  project: string;
  meter: CostMeter;
  cents: number;
  source: "build-app" | "farm" | "slack" | "pipeline";
  agentId?: string;
  repo?: string;
}

export interface CostClose {
  thisRunCents: number | null;
  thisRunMeter: CostMeter;
  project: string;
  projectRuns: number;
  projectCursorCents: number;
  projectClaudeCents: number;
  projectLocalCents: number;
  todayCursorCents: number;
  todayClaudeCents: number;
  todayLocalCents: number;
  todayProjects: number;
  last7CursorCents: number;
  last7ClaudeCents: number;
  last7LocalCents: number;
  last7DaysWithData: number;
  monthOutlookCursorCents: number;
  monthOutlookClaudeCents: number;
}

const TZ = "America/Chicago";

export function calendarDay(at: Date = new Date(), timeZone = TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function projectFromRepo(repo?: string): string {
  if (!repo?.trim()) return "unknown";
  const parts = repo.replace(/\.git$/, "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "unknown";
}

export function usdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function defaultLedgerPath(stateDir: string): string {
  return resolve(stateDir, "cost-ledger.jsonl");
}

export function normalizeMeter(meter: string | undefined): CostMeter {
  if (meter === "claude-max" || meter === "max-api-eq" || meter === "claude") return "claude-max";
  if (meter === "local") return "local";
  return "cursor-charged";
}

export function meterForEngine(engine: string | undefined): CostMeter {
  if (engine === "claude" || engine === "hybrid") return "claude-max";
  if (engine === "local") return "local";
  return "cursor-charged";
}

export function meterFromAgentId(agentId: string | undefined): CostMeter {
  return agentId?.startsWith("cc-") ? "claude-max" : "cursor-charged";
}

/** Cursor invoice vs Claude API-eq. Do not swap these. */
export function centsForMeter(
  meter: CostMeter,
  u: { chargedCents?: number; rawCostCents?: number },
): number | undefined {
  const m = normalizeMeter(meter);
  if (m === "cursor-charged") {
    if (u.chargedCents != null) return u.chargedCents;
    if (u.rawCostCents != null) return u.rawCostCents;
    return undefined;
  }
  if (u.rawCostCents != null) return u.rawCostCents;
  if (u.chargedCents != null) return u.chargedCents;
  return undefined;
}

export function meterLabel(meter: CostMeter): string {
  const m = normalizeMeter(meter);
  if (m === "claude-max") return "Claude Max API-eq (not a Cursor charge)";
  if (m === "local") return "local (no card charge)";
  return "Cursor billed";
}

function usdMeters(cursor: number, claude: number, local = 0): string {
  const parts = [`Cursor ${usdFromCents(cursor)}`, `Claude ${usdFromCents(claude)}`];
  if (local) parts.push(`local ${usdFromCents(local)}`);
  return parts.join(" · ");
}

function splitCents(xs: CostEntry[]): { cursor: number; claude: number; local: number } {
  let cursor = 0;
  let claude = 0;
  let local = 0;
  for (const e of xs) {
    const m = normalizeMeter(e.meter);
    if (m === "claude-max") claude += e.cents;
    else if (m === "local") local += e.cents;
    else cursor += e.cents;
  }
  return { cursor, claude, local };
}

function monthOutlook(week: CostEntry[], meter: CostMeter): number {
  const rows = week.filter((e) => normalizeMeter(e.meter) === meter);
  if (!rows.length) return 0;
  const days = new Set(rows.map((e) => e.day)).size || 1;
  const sum = rows.reduce((n, e) => n + e.cents, 0);
  return Math.round((sum / days) * 30);
}

export function loadCostLedger(file: string): CostEntry[] {
  if (!existsSync(file)) return [];
  const out: CostEntry[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t) as CostEntry;
      if (typeof e.cents === "number" && e.project && e.day && e.meter) {
        out.push({ ...e, meter: normalizeMeter(e.meter) });
      }
    } catch {
      /* skip a truncated line */
    }
  }
  return out;
}

export function appendCostEntry(file: string, entry: Omit<CostEntry, "at" | "day"> & { at?: string }): CostEntry {
  const at = entry.at ?? new Date().toISOString();
  const full: CostEntry = {
    ...entry,
    meter: normalizeMeter(entry.meter),
    at,
    day: calendarDay(new Date(at)),
  };
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(full)}\n`);
  return full;
}

export function summarizeCost(
  entries: CostEntry[],
  opts: { project: string; thisRunCents: number | null; thisRunMeter: CostMeter; now?: Date },
): CostClose {
  const now = opts.now ?? new Date();
  const today = calendarDay(now);
  const start7 = new Date(now);
  start7.setDate(start7.getDate() - 6);
  const day7 = calendarDay(start7);

  const projectEntries = entries.filter((e) => e.project === opts.project);
  const todayEntries = entries.filter((e) => e.day === today);
  const weekEntries = entries.filter((e) => e.day >= day7 && e.day <= today);
  const project = splitCents(projectEntries);
  const todaySplit = splitCents(todayEntries);
  const week = splitCents(weekEntries);

  return {
    thisRunCents: opts.thisRunCents,
    thisRunMeter: normalizeMeter(opts.thisRunMeter),
    project: opts.project,
    projectRuns: projectEntries.length,
    projectCursorCents: project.cursor,
    projectClaudeCents: project.claude,
    projectLocalCents: project.local,
    todayCursorCents: todaySplit.cursor,
    todayClaudeCents: todaySplit.claude,
    todayLocalCents: todaySplit.local,
    todayProjects: new Set(todayEntries.map((e) => e.project)).size,
    last7CursorCents: week.cursor,
    last7ClaudeCents: week.claude,
    last7LocalCents: week.local,
    last7DaysWithData: new Set(weekEntries.map((e) => e.day)).size || 1,
    monthOutlookCursorCents: monthOutlook(weekEntries, "cursor-charged"),
    monthOutlookClaudeCents: monthOutlook(weekEntries, "claude-max"),
  };
}

export function formatCostClose(c: CostClose): string {
  const thisRun =
    c.thisRunCents == null
      ? `  this run:     unknown  ${meterLabel(c.thisRunMeter)}`
      : `  this run:     ${usdFromCents(c.thisRunCents)}  ${meterLabel(c.thisRunMeter)}`;
  const outlook = `Cursor ${usdFromCents(c.monthOutlookCursorCents)} / Claude ${usdFromCents(c.monthOutlookClaudeCents)}`;
  return [
    "COST",
    thisRun,
    `  this project: ${usdMeters(c.projectCursorCents, c.projectClaudeCents, c.projectLocalCents)}  (${c.project} · ${c.projectRuns} recorded run${c.projectRuns === 1 ? "" : "s"})`,
    `  today:        ${usdMeters(c.todayCursorCents, c.todayClaudeCents, c.todayLocalCents)}  (${c.todayProjects} project${c.todayProjects === 1 ? "" : "s"})`,
    `  last 7 days:  ${usdMeters(c.last7CursorCents, c.last7ClaudeCents, c.last7LocalCents)}  (${c.last7DaysWithData} day${c.last7DaysWithData === 1 ? "" : "s"} with jobs)`,
    `  if this pace holds: ${outlook} this month`,
  ].join("\n");
}

export function formatCostBoard(entries: CostEntry[], now = new Date()): string {
  if (!entries.length) return "COST board: no recorded factory jobs yet.";
  const today = calendarDay(now);
  const byDay = new Map<string, CostEntry[]>();
  const byProject = new Map<string, CostEntry[]>();
  for (const e of entries) {
    byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
    byProject.set(e.project, [...(byProject.get(e.project) ?? []), e]);
  }
  const days = [...byDay.keys()].sort((a, b) => a.localeCompare(b));
  const projects = [...byProject.entries()].sort((a, b) => {
    const as = splitCents(a[1]);
    const bs = splitCents(b[1]);
    return bs.cursor + bs.claude - (as.cursor + as.claude);
  });
  const lines = ["COST board", "", "Cursor billed and Claude Max stay on separate meters.", "", "By day:"];
  for (const day of days) {
    const s = splitCents(byDay.get(day) ?? []);
    const mark = day === today ? "  (today)" : "";
    lines.push(`  ${day}${mark}  ${usdMeters(s.cursor, s.claude, s.local)}`);
  }
  lines.push("", "By project:");
  for (const [project, rows] of projects) {
    const s = splitCents(rows);
    lines.push(`  ${usdMeters(s.cursor, s.claude, s.local)}  ${project}`);
  }
  const all = splitCents(entries);
  const close = summarizeCost(entries, {
    project: projects[0]?.[0] ?? "unknown",
    thisRunCents: null,
    thisRunMeter: "cursor-charged",
    now,
  });
  lines.push("", `All recorded: ${usdMeters(all.cursor, all.claude, all.local)}`);
  lines.push(
    `If the last ${close.last7DaysWithData}-day pace holds: Cursor ${usdFromCents(close.monthOutlookCursorCents)} / Claude ${usdFromCents(close.monthOutlookClaudeCents)} this month`,
  );
  return lines.join("\n");
}

export function recordJobCost(opts: {
  stateDir: string;
  project: string;
  cents: number;
  meter: CostMeter;
  source: CostEntry["source"];
  agentId?: string;
  repo?: string;
}): { entry: CostEntry; close: string } {
  const file = defaultLedgerPath(opts.stateDir);
  const entry = appendCostEntry(file, {
    project: opts.project,
    cents: opts.cents,
    meter: opts.meter,
    source: opts.source,
    agentId: opts.agentId,
    repo: opts.repo,
  });
  const entries = loadCostLedger(file);
  const close = formatCostClose(
    summarizeCost(entries, {
      project: opts.project,
      thisRunCents: opts.cents,
      thisRunMeter: opts.meter,
    }),
  );
  return { entry, close };
}

/** Record when cents are known; still print a COST close when they are not. */
export function closeJobCost(opts: {
  stateDir: string;
  project: string;
  cents: number | undefined | null;
  meter: CostMeter;
  source: CostEntry["source"];
  agentId?: string;
  repo?: string;
}): { entry?: CostEntry; close: string } {
  if (opts.cents != null) return recordJobCost({ ...opts, cents: opts.cents });
  const entries = loadCostLedger(defaultLedgerPath(opts.stateDir));
  return {
    close: formatCostClose(
      summarizeCost(entries, {
        project: opts.project,
        thisRunCents: null,
        thisRunMeter: opts.meter,
      }),
    ),
  };
}
