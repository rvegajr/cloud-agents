/**
 * Dead-man switch for machines that cannot report their own death.
 *
 * claude-rc on the Mac POSTs a beat every watch run (10 min). This always-on service remembers
 * the last beat per source and, once a source is silent past `staleMs`, texts once ("quiet");
 * when beats resume it texts once more ("back"). A Mac that is asleep, powered off, waiting at
 * the FileVault screen, or offline can only be noticed from outside, which is why this lives here.
 */

export interface Beat {
  host?: string;
  ok?: number;
  total?: number;
  needs_you?: number;
}

export interface HeartbeatAlert {
  kind: "quiet" | "back";
  source: string;
  text: string;
}

interface SourceState {
  at?: number;
  beat?: Beat;
  quiet: boolean;
}

const SOURCE_RE = /^[A-Za-z0-9._@-]{1,64}$/;

export function parseBeat(raw: unknown): { ok: true; source: string; beat: Beat } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "JSON object required" };
  const o = raw as Record<string, unknown>;
  const source = typeof o.source === "string" ? o.source.trim() : "";
  if (!SOURCE_RE.test(source)) return { ok: false, error: "source must be 1-64 of A-Z a-z 0-9 . _ @ -" };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
  const beat: Beat = {};
  if (typeof o.host === "string" && o.host.trim()) beat.host = o.host.trim().slice(0, 64);
  for (const k of ["ok", "total", "needs_you"] as const) {
    const n = num(o[k]);
    if (n !== undefined) beat[k] = n;
  }
  return { ok: true, source, beat };
}

function hhmm(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16) + " UTC";
}

export class HeartbeatMonitor {
  private readonly staleMs: number;
  private readonly startedAt: number;
  private readonly sources = new Map<string, SourceState>();

  constructor(opts: { staleMs: number; expected: string[]; startedAt: number }) {
    this.staleMs = opts.staleMs;
    this.startedAt = opts.startedAt;
    for (const s of opts.expected) this.sources.set(s, { quiet: false });
  }

  beat(source: string, beat: Beat, now: number): void {
    const prev = this.sources.get(source) ?? { quiet: false };
    this.sources.set(source, { ...prev, at: now, beat });
  }

  /** Alerts that became true since the last check; each fires once per transition. */
  check(now: number): HeartbeatAlert[] {
    const out: HeartbeatAlert[] = [];
    for (const [source, st] of this.sources) {
      const since = st.at ?? this.startedAt;
      const silent = now - since > this.staleMs;
      if (silent && !st.quiet) {
        st.quiet = true;
        const min = Math.floor((now - since) / 60_000);
        const last = st.at !== undefined ? ` (last ${hhmm(st.at)}${st.beat?.host ? ` from ${st.beat.host}` : ""})` : " since this service started";
        out.push({
          kind: "quiet",
          source,
          text: `claude-rc: no heartbeat from ${source} for ${min} min${last}: asleep, off, at the FileVault screen, or offline`,
        });
      } else if (!silent && st.quiet && st.at !== undefined) {
        st.quiet = false;
        const b = st.beat ?? {};
        const counts = b.total !== undefined ? ` (${b.ok ?? 0}/${b.total} sessions OK)` : "";
        out.push({ kind: "back", source, text: `claude-rc: heartbeat back from ${b.host ?? source}${counts}` });
      }
    }
    return out;
  }

  status(now: number): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [source, st] of this.sources) {
      out[source] = {
        lastBeat: st.at !== undefined ? new Date(st.at).toISOString() : null,
        agoMin: st.at !== undefined ? Math.floor((now - st.at) / 60_000) : null,
        quiet: st.quiet,
        ...st.beat,
      };
    }
    return out;
  }
}

export type TextSend = (to: string, body: string) => Promise<void>;

/** SMS through the Noctusoft relay (POST /sms/send, product key). Errors carry the status only. */
export function relayTextSender(opts: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }): TextSend {
  const base = (opts.baseUrl ?? "https://api.twilio.noctusoft.com").replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  return async (to, body) => {
    const res = await doFetch(`${base}/sms/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json", "X-App-Env": "production" },
      body: JSON.stringify({ to, body }),
    });
    if (!res.ok) throw new Error(`relay SMS rejected (HTTP ${res.status})`);
  };
}
