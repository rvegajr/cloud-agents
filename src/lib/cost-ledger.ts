import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Append-only factory ledger. COST is AI-agnostic: each provider is its own
 * meter (`cursor:billed`, `claude:api-eq`, `local:local`, or any future slug).
 * Meters are never summed into one dollar figure.
 */

export type CostKind = "billed" | "api-eq" | "local" | "tracked";
export type CostMeterId = `${string}:${CostKind}` | string;
/** @deprecated use CostMeterId — kept so callers type-check */
export type CostMeter = CostMeterId;

export interface ParsedMeter {
  id: CostMeterId;
  provider: string;
  kind: CostKind;
}

export interface CostEntry {
  at: string;
  day: string;
  project: string;
  meter: CostMeterId;
  cents: number;
  source: "build-app" | "farm" | "slack" | "pipeline" | "quality-review";
  agentId?: string;
  repo?: string;
}

export type MeterSplit = Record<string, number>;

export interface CostClose {
  thisRunCents: number | null;
  thisRunMeter: CostMeterId;
  project: string;
  projectRuns: number;
  todayProjects: number;
  last7DaysWithData: number;
  projectByMeter: MeterSplit;
  todayByMeter: MeterSplit;
  last7ByMeter: MeterSplit;
  outlookByMeter: MeterSplit;
}

const TZ = "America/Chicago";

const ALIASES: Record<string, CostMeterId> = {
  "cursor-charged": "cursor:billed",
  cursor: "cursor:billed",
  "claude-max": "claude:api-eq",
  "max-api-eq": "claude:api-eq",
  claude: "claude:api-eq",
  local: "local:local",
};

const KIND_RANK: Record<CostKind, number> = { billed: 0, "api-eq": 1, local: 2, tracked: 3 };

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

function slug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function parseKind(raw: string): CostKind {
  const k = raw.toLowerCase();
  if (k === "billed" || k === "charged" || k === "invoice") return "billed";
  if (k === "api-eq" || k === "max" || k === "equivalent") return "api-eq";
  if (k === "local" || k === "ollama") return "local";
  return "tracked";
}

export function parseMeter(raw: string | undefined): ParsedMeter {
  const s = (raw ?? "").trim().toLowerCase();
  const aliased = ALIASES[s];
  const id = aliased ?? (() => {
    if (!s) return "unknown:tracked";
    const colon = s.indexOf(":");
    if (colon > 0) return `${slug(s.slice(0, colon))}:${parseKind(s.slice(colon + 1))}`;
    return `${slug(s)}:tracked`;
  })();
  const colon = id.indexOf(":");
  const provider = colon > 0 ? id.slice(0, colon) : id;
  const kind = parseKind(colon > 0 ? id.slice(colon + 1) : "tracked");
  return { id, provider, kind };
}

export function normalizeMeter(meter: string | undefined): CostMeterId {
  return parseMeter(meter).id;
}

export function meterForEngine(engine: string | undefined): CostMeterId {
  const e = (engine ?? "cursor").trim().toLowerCase();
  if (e === "cursor") return "cursor:billed";
  if (e === "claude" || e === "hybrid") return "claude:api-eq";
  if (e === "local") return "local:local";
  return normalizeMeter(`${e}:tracked`);
}

export function meterFromAgentId(agentId: string | undefined): CostMeterId {
  if (agentId?.startsWith("cc-")) return "claude:api-eq";
  if (agentId?.startsWith("bc-")) return "cursor:billed";
  return "unknown:tracked";
}

/** Billed meters use the invoice; everyone else uses API-eq / list. */
export function centsForMeter(
  meter: string,
  u: { chargedCents?: number; rawCostCents?: number },
): number | undefined {
  const { kind } = parseMeter(meter);
  if (kind === "billed") {
    if (u.chargedCents != null) return u.chargedCents;
    if (u.rawCostCents != null) return u.rawCostCents;
    return undefined;
  }
  if (u.rawCostCents != null) return u.rawCostCents;
  if (u.chargedCents != null) return u.chargedCents;
  return undefined;
}

function titleProvider(provider: string): string {
  if (provider === "claude") return "Claude";
  if (provider === "cursor") return "Cursor";
  if (provider === "openai") return "OpenAI";
  return provider.replace(/(^|-)([a-z])/g, (_, d: string, c: string) => `${d}${c.toUpperCase()}`);
}

export function meterLabel(meter: string): string {
  const { provider, kind } = parseMeter(meter);
  const name = titleProvider(provider);
  if (kind === "billed") return `${name} billed`;
  if (kind === "api-eq") return `${name} API-eq (not a card charge)`;
  if (kind === "local") return `${name} (no card charge)`;
  return `${name} (tracked)`;
}

export function shortMeterLabel(meter: string): string {
  const { provider, kind } = parseMeter(meter);
  const name = titleProvider(provider);
  if (kind === "billed") return `${name} billed`;
  if (kind === "api-eq") return `${name} API-eq`;
  if (kind === "tracked") return `${name} tracked`;
  return name;
}

export function formatRunningCost(cents: number | undefined | null, meter: string): string | undefined {
  if (cents == null) return undefined;
  return `COST running: ${usdFromCents(cents)}  ${meterLabel(meter)}`;
}

function sortMeterIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const pa = parseMeter(a);
    const pb = parseMeter(b);
    return pa.provider.localeCompare(pb.provider) || KIND_RANK[pa.kind] - KIND_RANK[pb.kind];
  });
}

export function formatMeterAmounts(split: MeterSplit): string {
  const ids = sortMeterIds(Object.keys(split).filter((id) => (split[id] ?? 0) !== 0));
  if (!ids.length) return "";
  return ids.map((id) => `${shortMeterLabel(id)} ${usdFromCents(split[id] ?? 0)}`).join(" · ");
}

function byMeter(xs: CostEntry[]): MeterSplit {
  const out: MeterSplit = {};
  for (const e of xs) {
    const m = normalizeMeter(e.meter);
    out[m] = (out[m] ?? 0) + e.cents;
  }
  return out;
}

function monthOutlookByMeter(week: CostEntry[]): MeterSplit {
  const grouped = new Map<string, CostEntry[]>();
  for (const e of week) {
    const m = normalizeMeter(e.meter);
    grouped.set(m, [...(grouped.get(m) ?? []), e]);
  }
  const out: MeterSplit = {};
  for (const [m, rows] of grouped) {
    const days = new Set(rows.map((e) => e.day)).size || 1;
    const sum = rows.reduce((n, e) => n + e.cents, 0);
    out[m] = Math.round((sum / days) * 30);
  }
  return out;
}

function totalCents(split: MeterSplit): number {
  return Object.values(split).reduce((n, v) => n + v, 0);
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
  opts: { project: string; thisRunCents: number | null; thisRunMeter: string; now?: Date },
): CostClose {
  const now = opts.now ?? new Date();
  const today = calendarDay(now);
  const start7 = new Date(now);
  start7.setDate(start7.getDate() - 6);
  const day7 = calendarDay(start7);

  const projectEntries = entries.filter((e) => e.project === opts.project);
  const todayEntries = entries.filter((e) => e.day === today);
  const weekEntries = entries.filter((e) => e.day >= day7 && e.day <= today);

  return {
    thisRunCents: opts.thisRunCents,
    thisRunMeter: normalizeMeter(opts.thisRunMeter),
    project: opts.project,
    projectRuns: projectEntries.length,
    todayProjects: new Set(todayEntries.map((e) => e.project)).size,
    last7DaysWithData: new Set(weekEntries.map((e) => e.day)).size,
    projectByMeter: byMeter(projectEntries),
    todayByMeter: byMeter(todayEntries),
    last7ByMeter: byMeter(weekEntries),
    outlookByMeter: monthOutlookByMeter(weekEntries),
  };
}

export function formatCostClose(c: CostClose): string {
  const thisRun =
    c.thisRunCents == null
      ? "  this run:     unknown"
      : `  this run:     ${usdFromCents(c.thisRunCents)}  ${meterLabel(c.thisRunMeter)}`;
  const lines = ["COST", thisRun];
  const project = formatMeterAmounts(c.projectByMeter);
  if (project) {
    lines.push(
      `  this project: ${project}  (${c.project} · ${c.projectRuns} recorded run${c.projectRuns === 1 ? "" : "s"})`,
    );
  }
  const today = formatMeterAmounts(c.todayByMeter);
  if (today) {
    lines.push(
      `  today:        ${today}  (${c.todayProjects} project${c.todayProjects === 1 ? "" : "s"})`,
    );
  }
  const week = formatMeterAmounts(c.last7ByMeter);
  if (week) {
    lines.push(
      `  last 7 days:  ${week}  (${c.last7DaysWithData} day${c.last7DaysWithData === 1 ? "" : "s"} with jobs)`,
    );
  }
  const outlook = formatMeterAmounts(c.outlookByMeter);
  if (outlook) lines.push(`  if this pace holds: ${outlook} this month`);
  return lines.join("\n");
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
  const projects = [...byProject.entries()].sort((a, b) => totalCents(byMeter(b[1])) - totalCents(byMeter(a[1])));
  const lines = ["COST board", "", "Each AI provider is its own meter. Do not add them into one number.", "", "By day:"];
  for (const day of days) {
    const mark = day === today ? "  (today)" : "";
    lines.push(`  ${day}${mark}  ${formatMeterAmounts(byMeter(byDay.get(day) ?? []))}`);
  }
  lines.push("", "By project:");
  for (const [project, rows] of projects) {
    lines.push(`  ${formatMeterAmounts(byMeter(rows))}  ${project}`);
  }
  const close = summarizeCost(entries, {
    project: projects[0]?.[0] ?? "unknown",
    thisRunCents: null,
    thisRunMeter: entries[0]?.meter ?? "unknown:tracked",
    now,
  });
  const all = formatMeterAmounts(byMeter(entries));
  if (all) lines.push("", `All recorded: ${all}`);
  const outlook = formatMeterAmounts(close.outlookByMeter);
  if (outlook) {
    lines.push(`If the last ${close.last7DaysWithData}-day pace holds: ${outlook} this month`);
  }
  return lines.join("\n");
}

function costKey(e: CostEntry): string {
  if (e.agentId) return `${normalizeMeter(e.meter)}:${e.agentId}`;
  return `${normalizeMeter(e.meter)}:${e.project}:${e.at}:${e.cents}`;
}

export function mergeCostEntries(ledger: CostEntry[], harvested: CostEntry[]): CostEntry[] {
  const byId = new Map<string, CostEntry>();
  for (const e of harvested) byId.set(costKey(e), e);
  for (const e of ledger) byId.set(costKey(e), e);
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.project.localeCompare(b.project));
}

function isScratchRepo(repo?: string): boolean {
  if (!repo) return false;
  const n = repo.replace(/\\/g, "/");
  return n.includes("/private/tmp/") || n.startsWith("/tmp/") || n.includes("scratchpad") || n.includes("/var/folders/");
}

function roundCents(n: number): number {
  return Math.round(n);
}

/**
 * Read cents already sitting in .runs (farm manifests, Claude records, build
 * records that stored chargedCents). Slack dated json never stored usage, so
 * those jobs stay out until a live getUsage close writes the ledger.
 */
export function harvestRunCosts(stateDir: string): CostEntry[] {
  if (!existsSync(stateDir)) return [];
  const out: CostEntry[] = [];
  for (const name of readdirSync(stateDir)) {
    if (!name.endsWith(".json") || name === "max-usage.json") continue;
    const file = join(stateDir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const data = raw as Record<string, unknown>;
    const mtime = statSync(file).mtime.toISOString();

    if (name.startsWith("farm-") && Array.isArray(data.jobs)) {
      const at = typeof data.updatedAt === "string" ? data.updatedAt : typeof data.createdAt === "string" ? data.createdAt : mtime;
      for (const job of data.jobs) {
        if (!job || typeof job !== "object") continue;
        const j = job as Record<string, unknown>;
        if (typeof j.cents !== "number" || !Number.isFinite(j.cents) || j.cents <= 0) continue;
        const repo = typeof j.repo === "string" ? j.repo : undefined;
        const project =
          (typeof j.repoName === "string" && j.repoName) || projectFromRepo(repo);
        out.push({
          at,
          day: calendarDay(new Date(at)),
          project,
          meter: "cursor:billed",
          cents: roundCents(j.cents),
          source: "farm",
          agentId: typeof j.agentId === "string" ? j.agentId : undefined,
          repo,
        });
      }
      continue;
    }

    if (name.startsWith("claude-") && typeof data.apiEquivalentUsd === "number" && data.apiEquivalentUsd > 0) {
      const repo = typeof data.repo === "string" ? data.repo : undefined;
      if (isScratchRepo(repo)) continue;
      const cents = roundCents(data.apiEquivalentUsd * 100);
      if (cents <= 0) continue;
      const engine = typeof data.engine === "string" ? data.engine : "claude";
      out.push({
        at: mtime,
        day: calendarDay(new Date(mtime)),
        project: projectFromRepo(repo),
        meter: meterForEngine(engine),
        cents,
        source: "build-app",
        agentId: typeof data.agentId === "string" ? data.agentId : undefined,
        repo,
      });
      continue;
    }

    if (name.startsWith("build-") && typeof data.chargedCents === "number" && data.chargedCents > 0) {
      const repo = typeof data.repo === "string" ? data.repo : undefined;
      const engine = typeof data.engine === "string" ? data.engine : undefined;
      const at = typeof data.updatedAt === "string" ? data.updatedAt : mtime;
      const agentId = typeof data.agentId === "string" ? data.agentId : undefined;
      out.push({
        at,
        day: calendarDay(new Date(at)),
        project: projectFromRepo(repo),
        meter: meterForEngine(engine ?? (agentId?.startsWith("cc-") ? "claude" : "cursor")),
        cents: roundCents(data.chargedCents),
        source: "build-app",
        agentId,
        repo,
      });
    }
  }
  return out;
}

export function loadFactoryCosts(stateDir: string): CostEntry[] {
  return mergeCostEntries(loadCostLedger(defaultLedgerPath(stateDir)), harvestRunCosts(stateDir));
}

export function recordJobCost(opts: {
  stateDir: string;
  project: string;
  cents: number;
  meter: string;
  source: CostEntry["source"];
  agentId?: string;
  repo?: string;
}): { entry: CostEntry; close: string } {
  const file = defaultLedgerPath(opts.stateDir);
  const entry = appendCostEntry(file, {
    project: opts.project,
    cents: opts.cents,
    meter: normalizeMeter(opts.meter),
    source: opts.source,
    agentId: opts.agentId,
    repo: opts.repo,
  });
  // Entries are cumulative per agent (getUsage semantics), so a resumed job
  // appends a newer total for the same agent; summarise the latest per agent,
  // as the board does, or every resume counts the past again.
  const entries = mergeCostEntries(loadCostLedger(file), []);
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
  meter: string;
  source: CostEntry["source"];
  agentId?: string;
  repo?: string;
}): { entry?: CostEntry; close: string } {
  if (opts.cents != null) return recordJobCost({ ...opts, cents: opts.cents });
  const entries = loadFactoryCosts(opts.stateDir);
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
