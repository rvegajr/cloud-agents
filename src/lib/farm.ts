import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/**
 * Parallel Cursor factory: N independent idea files, a concurrency pool, a
 * dollar cap, a manifest. The VMs already scale; this is the scheduler that
 * `build-app` did not have. Engine is always Cursor — Max does not multiply.
 */

export type FarmJobStatus = "queued" | "running" | "done" | "failed" | "skipped";

export interface FarmJobSpec {
  ideaFile: string;
  idea: string;
  repoName: string;
}

export interface FarmJob extends FarmJobSpec {
  status: FarmJobStatus;
  repo?: string;
  agentId?: string;
  prUrl?: string;
  stopReason?: string;
  cents?: number;
  error?: string;
}

export interface FarmManifest {
  id: string;
  createdAt: string;
  updatedAt: string;
  ideasDir: string;
  concurrency: number;
  maxUsd: number;
  spentCents: number;
  jobs: FarmJob[];
}

export interface FarmJobOutcome {
  status: "done" | "failed";
  repo?: string;
  agentId?: string;
  prUrl?: string;
  stopReason?: string;
  cents?: number;
  error?: string;
}

export function repoNameFromIdeaFile(file: string): string {
  const base = basename(file).replace(/\.md$/i, "");
  const slug = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return slug || "app";
}

export function isFarmIdeaFile(name: string): boolean {
  if (!name.toLowerCase().endsWith(".md")) return false;
  const base = basename(name).toLowerCase();
  return base !== "template.md" && base !== "readme.md";
}

export function ideaFilesInDir(dir: string): string[] {
  const root = resolve(dir);
  if (!existsSync(root)) throw new Error(`Ideas directory not found: ${root}`);
  return readdirSync(root)
    .filter(isFarmIdeaFile)
    .sort()
    .map((name) => join(root, name));
}

export function loadIdeaSpecs(dir: string): FarmJobSpec[] {
  return ideaFilesInDir(dir).map((ideaFile) => {
    const idea = readFileSync(ideaFile, "utf8").trim();
    if (!idea) throw new Error(`Empty idea file: ${ideaFile}`);
    return { ideaFile, idea, repoName: repoNameFromIdeaFile(ideaFile) };
  });
}

export function parseMaxUsd(raw: string | undefined, fallback = 10): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function parseConcurrency(raw: string | undefined, fallback = 5): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export function budgetAllows(spentCents: number, maxUsd: number): boolean {
  if (maxUsd <= 0) return true;
  return spentCents < Math.round(maxUsd * 100);
}

export function newFarmId(now = new Date()): string {
  return `farm-${now.toISOString().replace(/[:.]/g, "-")}`;
}

export function farmDir(root = process.cwd()): string {
  const dir = resolve(root, ".runs");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function farmPath(id: string, root?: string): string {
  return join(farmDir(root), `${id}.json`);
}

export function saveFarmManifest(manifest: FarmManifest, root?: string): string {
  manifest.updatedAt = new Date().toISOString();
  const path = farmPath(manifest.id, root);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}

export function loadFarmManifest(id: string, root?: string): FarmManifest {
  const path = farmPath(id, root);
  if (!existsSync(path)) throw new Error(`No farm manifest at ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as FarmManifest;
}

export function listFarmManifests(root?: string): FarmManifest[] {
  const dir = farmDir(root);
  return readdirSync(dir)
    .filter((n) => n.startsWith("farm-") && n.endsWith(".json"))
    .sort()
    .reverse()
    .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")) as FarmManifest);
}

export function formatFarmStatus(manifest: FarmManifest): string {
  const spent = `$${(manifest.spentCents / 100).toFixed(2)}`;
  const cap = manifest.maxUsd > 0 ? ` / $${manifest.maxUsd.toFixed(2)} cap` : " (no cap)";
  const lines = [
    `${manifest.id}  concurrency=${manifest.concurrency}  spent ${spent}${cap}  ${manifest.jobs.length} jobs`,
    `ideas: ${manifest.ideasDir}`,
  ];
  for (const j of manifest.jobs) {
    const cents = j.cents != null ? `  $${(j.cents / 100).toFixed(2)}` : "";
    const pr = j.prUrl ? `  ${j.prUrl}` : "";
    const agent = j.agentId ? `  ${j.agentId}` : "";
    const why = j.error ? `  ${j.error}` : j.stopReason ? `  ${j.stopReason}` : "";
    lines.push(`  ${j.status.padEnd(8)} ${j.repoName}${agent}${cents}${pr}${why}`);
  }
  return lines.join("\n");
}

export function farmExitCode(manifest: FarmManifest): number {
  if (manifest.jobs.length === 0) return 1;
  if (manifest.jobs.every((j) => j.status === "done" && j.stopReason === "complete")) return 0;
  if (manifest.jobs.some((j) => j.status === "failed" || j.stopReason === "run-failed")) return 2;
  if (manifest.jobs.some((j) => j.stopReason === "blocked")) return 3;
  return 4;
}

/**
 * In-flight workers finish even after the budget trips; queued work is skipped.
 * Single-threaded shift is enough — each worker awaits the job before taking another.
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  let next = 0;
  const run = async () => {
    while (true) {
      if (shouldStop?.()) return;
      const i = next++;
      const item = items[i];
      if (item === undefined) return;
      await worker(item, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, Math.max(items.length, 1)) }, run));
}

export async function runFarm(opts: {
  specs: FarmJobSpec[];
  ideasDir: string;
  concurrency: number;
  maxUsd: number;
  id?: string;
  root?: string;
  runJob: (spec: FarmJobSpec) => Promise<FarmJobOutcome>;
  onManifest?: (manifest: FarmManifest) => void;
}): Promise<FarmManifest> {
  const createdAt = new Date().toISOString();
  const manifest: FarmManifest = {
    id: opts.id ?? newFarmId(),
    createdAt,
    updatedAt: createdAt,
    ideasDir: opts.ideasDir,
    concurrency: opts.concurrency,
    maxUsd: opts.maxUsd,
    spentCents: 0,
    jobs: opts.specs.map((s) => ({ ...s, status: "queued" })),
  };
  const persist = () => {
    saveFarmManifest(manifest, opts.root);
    opts.onManifest?.(manifest);
  };
  persist();

  if (manifest.jobs.length === 0) return manifest;

  await runPool(
    manifest.jobs,
    opts.concurrency,
    async (job) => {
      if (!budgetAllows(manifest.spentCents, opts.maxUsd)) {
        job.status = "skipped";
        job.error = `FARM_MAX_USD $${opts.maxUsd.toFixed(2)} reached (spent $${(manifest.spentCents / 100).toFixed(2)})`;
        persist();
        return;
      }
      job.status = "running";
      persist();
      try {
        const out = await opts.runJob(job);
        job.status = out.status;
        job.repo = out.repo;
        job.agentId = out.agentId;
        job.prUrl = out.prUrl;
        job.stopReason = out.stopReason;
        job.cents = out.cents;
        job.error = out.error;
        if (typeof out.cents === "number") manifest.spentCents += Math.round(out.cents);
      } catch (err) {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : String(err);
      }
      persist();
    },
    () => !budgetAllows(manifest.spentCents, opts.maxUsd),
  );

  for (const job of manifest.jobs) {
    if (job.status === "queued") {
      job.status = "skipped";
      job.error = `FARM_MAX_USD $${opts.maxUsd.toFixed(2)} reached (spent $${(manifest.spentCents / 100).toFixed(2)})`;
    }
  }
  persist();
  return manifest;
}
