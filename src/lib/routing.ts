import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Which model tier runs which turn. Pure functions so the policy is unit-testable
 * and the engines only ask "who takes this turn?".
 *
 * The point of the hybrid engine is that Claude Max pays for judgement (the plan,
 * and a rescue when the local executor fails verification) and a local Ollama
 * model pays for typing (implement, verify). Every Claude turn is also gated on
 * the Max utilization the Agent SDK reports, so the loop backs off before the
 * weekly cap instead of buying extra usage.
 */

export type Tier = "claude" | "local";

export type TurnKind =
  | "plan"
  | "implement"
  | "verify"
  | "spec"
  | "iterate"
  | "finish"
  | "unblock"
  | "triage"
  | "requirements"
  | "blueprint"
  | "task"
  | "qa"
  | "review"
  // polya-craft (polya-craft/PATTERN.md, polya-craft/prompts/). `walk` is the Verifier walking the outer test.
  | "understand"
  | "devise"
  | "carry-out"
  | "walk"
  | "look-back"
  | "other";

export interface RoutingPolicy {
  plan: Tier;
  implement: Tier;
  verify: Tier;
  /** The scripted acceptance run (architect-crew-gate/prompts/qa.md). */
  qa: Tier;
  /** The independent release review (architect-crew-gate/prompts/review.md). */
  review: Tier;
  /** Re-run a failed local verify on Claude (one turn) before giving up. */
  rescue: boolean;
  /** Max utilization (0..1) at or above which Claude turns are diverted. */
  ceiling: number;
  /** What to do with a Claude turn once the ceiling is hit. */
  overCeiling: "local" | "stop";
}

export interface MaxUsage {
  status?: "allowed" | "allowed_warning" | "rejected";
  utilization?: number;
  rateLimitType?: string;
  resetsAt?: number;
  observedAt: string;
}

export interface RouteDecision {
  tier: Tier;
  reason: string;
}

export class MaxCeiling extends Error {
  constructor(public utilization: number, public ceiling: number, public resetsAt?: number) {
    super(
      `Max utilization ${(utilization * 100).toFixed(0)}% is at or above the ${(ceiling * 100).toFixed(0)}% ceiling; ` +
        `not spending more of the plan. ${resetsAt ? `Resets ${new Date(resetsAt * 1000).toISOString()}. ` : ""}` +
        "Set HYBRID_OVER_CEILING=local to plan on the local model instead.",
    );
    this.name = "MaxCeiling";
  }
}

export function classifyPrompt(prompt: string): TurnKind {
  // Retries prepend a note (gate feedback, traceability gaps) before the template; look past it.
  const head = prompt.slice(0, 8000);
  if (/^# Phase 1 of 3: Plan/m.test(head)) return "plan";
  if (/^# Phase 2 of 3: Implement/m.test(head)) return "implement";
  if (/^# Phase 3 of 3: Verify/m.test(head)) return "verify";
  if (/^# Build an app from an idea: phase 1, specification/m.test(head)) return "spec";
  if (/^# Build an app from an idea: iteration/m.test(head)) return "iterate";
  if (/^# Build an app from an idea: final verification/m.test(head)) return "finish";
  if (/^# Loop intervention/m.test(head)) return "unblock";
  if (/^# Triage/im.test(head)) return "triage";
  // Architect–crew–gate (architect-crew-gate/PATTERN.md, architect-crew-gate/prompts/)
  if (/^# Job: phase 0, requirements/m.test(head)) return "requirements";
  if (/^# Job: phase 1, blueprint/m.test(head)) return "blueprint";
  if (/^# Job: task /m.test(head)) return "task";
  if (/^# Job: fix turn/m.test(head)) return "task";
  if (/^# QA: acceptance run/m.test(head)) return "qa";
  if (/^# Review: independent release review/m.test(head)) return "review";
  // polya-craft (polya-craft/prompts/)
  if (/^# Understand the problem/m.test(head)) return "understand";
  if (/^# Devise a plan/m.test(head)) return "devise";
  if (/^# Carry out: unit /m.test(head)) return "carry-out";
  if (/^# Look back: verify/m.test(head)) return "walk";
  if (/^# Look back: review/m.test(head)) return "look-back";
  return "other";
}

function parseCeiling(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0.85;
  return n > 1 ? Math.min(n / 100, 1) : n;
}

export function policyFromEnv(engine: "hybrid" | "local", env: NodeJS.ProcessEnv = process.env): RoutingPolicy {
  if (engine === "local") {
    return { plan: "local", implement: "local", verify: "local", qa: "local", review: "local", rescue: false, ceiling: 1, overCeiling: "local" };
  }
  const tier = (name: string, fallback: Tier): Tier => {
    const v = env[name]?.trim().toLowerCase();
    return v === "claude" || v === "local" ? v : fallback;
  };
  return {
    plan: tier("HYBRID_PLAN", "claude"),
    implement: tier("HYBRID_IMPLEMENT", "local"),
    verify: tier("HYBRID_VERIFY", "local"),
    qa: tier("HYBRID_QA", "local"),
    review: tier("HYBRID_REVIEW", "claude"),
    rescue: (env.HYBRID_RESCUE ?? "1").trim() !== "0",
    ceiling: parseCeiling(env.MAX_UTILIZATION_CEILING),
    overCeiling: env.HYBRID_OVER_CEILING?.trim().toLowerCase() === "stop" ? "stop" : "local",
  };
}

/** Tier the policy wants for a turn kind, before the ceiling is applied. */
export function preferredTier(kind: TurnKind, policy: RoutingPolicy): Tier {
  switch (kind) {
    case "plan":
    case "spec":
    case "triage":
    case "requirements":
    case "blueprint":
    case "understand":
    case "devise":
      return policy.plan;
    case "implement":
    case "iterate":
    case "task":
    case "carry-out":
      return policy.implement;
    case "verify":
    case "finish":
    case "walk":
      return policy.verify;
    case "qa":
      return policy.qa;
    case "review":
    case "look-back":
      return policy.review;
    case "unblock":
      // A stall is a judgement call; the cheap tier already failed to make progress.
      return policy.rescue ? "claude" : policy.implement;
    default:
      return policy.implement;
  }
}

/** A usage sample is stale once its window has reset. */
export function usageIsCurrent(usage: MaxUsage | undefined, nowMs = Date.now()): usage is MaxUsage & { utilization: number } {
  if (!usage || typeof usage.utilization !== "number") return false;
  if (usage.resetsAt && usage.resetsAt * 1000 <= nowMs) return false;
  return true;
}

export function routeTurn(
  kind: TurnKind,
  policy: RoutingPolicy,
  usage: MaxUsage | undefined,
  nowMs = Date.now(),
): RouteDecision {
  const want = preferredTier(kind, policy);
  if (want === "local") return { tier: "local", reason: `${kind}: policy` };
  if (!usageIsCurrent(usage, nowMs)) return { tier: "claude", reason: `${kind}: policy (no current usage sample)` };
  const pct = `${(usage.utilization * 100).toFixed(0)}%`;
  if (usage.status === "rejected" || usage.utilization >= policy.ceiling) {
    if (policy.overCeiling === "stop") throw new MaxCeiling(usage.utilization, policy.ceiling, usage.resetsAt);
    return { tier: "local", reason: `${kind}: Max at ${pct} (ceiling ${(policy.ceiling * 100).toFixed(0)}%), diverted to local` };
  }
  return { tier: "claude", reason: `${kind}: policy (Max at ${pct})` };
}

/** Where the last observed Max rate-limit sample lives, shared by every engine process on this box. */
export function maxUsagePath(root = process.cwd()): string {
  const dir = resolve(root, ".runs");
  mkdirSync(dir, { recursive: true });
  return join(dir, "max-usage.json");
}

export function loadMaxUsage(root?: string): MaxUsage | undefined {
  const path = maxUsagePath(root);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as MaxUsage;
  } catch {
    return undefined;
  }
}

/** Keep the sample for the widest window; a five-hour sample must not hide a seven-day one. */
export function mergeMaxUsage(prev: MaxUsage | undefined, next: MaxUsage, nowMs = Date.now()): MaxUsage {
  if (!usageIsCurrent(prev, nowMs)) return next;
  const weight = (u: MaxUsage) => (u.rateLimitType?.startsWith("seven_day") ? 2 : 1);
  if (weight(next) > weight(prev)) return next;
  if (weight(next) < weight(prev)) return (next.utilization ?? 0) > (prev.utilization ?? 0) ? next : prev;
  return next;
}

export function saveMaxUsage(sample: MaxUsage, root?: string): MaxUsage {
  const merged = mergeMaxUsage(loadMaxUsage(root), sample);
  writeFileSync(maxUsagePath(root), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

export function formatMaxUsage(usage: MaxUsage | undefined): string {
  if (!usageIsCurrent(usage)) return "Max usage: no current sample";
  const pct = `${(usage.utilization * 100).toFixed(0)}%`;
  const win = usage.rateLimitType ? ` of ${usage.rateLimitType.replace(/_/g, " ")}` : "";
  const reset = usage.resetsAt ? `, resets ${new Date(usage.resetsAt * 1000).toISOString().slice(0, 16)}Z` : "";
  return `Max usage: ${pct}${win}${reset}`;
}
