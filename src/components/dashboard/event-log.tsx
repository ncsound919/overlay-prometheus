'use client';

/**
 * SYSTEM EVENT STREAM — mission-control terminal strip.
 * Derives events by diffing consecutive GET /api/engine/state payloads
 * (no new API calls). Rolling in-memory log, capped at 120 lines.
 * First poll sets a silent baseline (seeded with the last 5 reports);
 * subsequent polls emit events for deltas only.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Terminal } from 'lucide-react';
import { Panel } from '@/components/dashboard/shared';
import { usePreferences } from '@/hooks/use-preferences';
import type { EngineStatePayload } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

const MAX_LINES = 120;
const COLLAPSED_LINES = 3;
const ANOMALY_EMIT_THRESHOLD = 0.75;
// Per-poll emission caps keep a single burst (e.g. a full engine tick) from
// flushing the whole rolling buffer.
const CAPS = { signals: 6, anomalies: 4, hypotheses: 6, transitions: 6, breakthroughs: 4, governance: 4, reports: 3 } as const;
// Governance SLA: a pending human review older than this is a breach.
const SLA_BREACH_MS = 10 * 60_000;
const SLA_SEED_MAX = 3; // history lines seeded on the first payload
const SLA_PER_POLL_CAP = 3; // max SLA lines per poll flush
// Auto-triage releases: notes prefixed by the engine's GOV_TRIAGE_NOTE_PREFIX.
const TRIAGE_NOTE_PREFIX = 'AUTO-TRIAGE';
const TRIAGE_SEED_MAX = 2; // history lines seeded on the first payload
const TRIAGE_PER_POLL_CAP = 2; // max release lines per poll flush

/** Once-per-review-id guard for SLA breach lines (globalThis-anchored so the
 *  Set survives dev-server HMR module reloads). */
const slaSeen: Set<string> = (() => {
  const g = globalThis as { __prometheusSlaSeen?: Set<string> };
  g.__prometheusSlaSeen ??= new Set<string>();
  return g.__prometheusSlaSeen;
})();

/** Once-per-review-id guard for auto-triage release lines (same anchoring). */
const triageSeen: Set<string> = (() => {
  const g = globalThis as { __prometheusTriageSeen?: Set<string> };
  g.__prometheusTriageSeen ??= new Set<string>();
  return g.__prometheusTriageSeen;
})();

/** Adds an id to a seen-Set, pruning the oldest entries past the cap so a
 *  long-lived tab cannot grow memory unboundedly (R8 watch item 3). */
const SEEN_SOFT_CAP = 600;
function rememberSeen(set: Set<string>, id: string) {
  set.add(id);
  if (set.size > SEEN_SOFT_CAP) {
    for (const k of set) {
      set.delete(k);
      if (set.size <= SEEN_SOFT_CAP - 100) break;
    }
  }
}

function isAutoTriaged(g: EngineStatePayload['governance'][number]): boolean {
  return typeof g.notes === 'string' && g.notes.startsWith(TRIAGE_NOTE_PREFIX);
}

type Tone = 'zinc' | 'rose' | 'violet' | 'emerald' | 'teal' | 'amber';

const TONE_TEXT: Record<Tone, string> = {
  zinc: 'text-zinc-400',
  rose: 'text-rose-400',
  violet: 'text-violet-400',
  emerald: 'text-emerald-400',
  teal: 'text-teal-400',
  amber: 'text-amber-400',
};

const TONE_BORDER: Record<Tone, string> = {
  zinc: 'border-zinc-700',
  rose: 'border-rose-500/70',
  violet: 'border-violet-500/70',
  emerald: 'border-emerald-500/70',
  teal: 'border-teal-500/70',
  amber: 'border-amber-500/70',
};

interface LogLine {
  /** Stable unique key (entity id based) — survives StrictMode re-renders. */
  key: string;
  ts: string;
  cycle: number;
  tone: Tone;
  text: string;
}

function hhmmss(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function isoToHhmmss(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? hhmmss(new Date()) : hhmmss(d);
}

function clip(text: string, max = 64): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Pending human reviews (humanReview && !reviewDecision). */
function isPendingReview(g: EngineStatePayload['governance'][number]): boolean {
  return g.humanReview && !g.reviewDecision;
}

/** Baseline seeding: last 5 reports + up to 3 already-breached SLA reviews. */
function seedHistory(data: EngineStatePayload): LogLine[] {
  const lines: LogLine[] = data.reports
    .slice(0, 5)
    .reverse()
    .map((r) => ({
      key: `rep-${r.id}`,
      ts: isoToHhmmss(r.createdAt),
      cycle: r.cycle,
      tone: 'zinc' as const,
      text: `L8 ▸ report ▸ ${clip(r.title)}`,
    }));

  // Reviews already past the SLA threshold at mount become SYS history —
  // timestamped at the review's createdAt, not the boot moment.
  const now = Date.now();
  const breached = data.governance
    .filter(isPendingReview)
    .map((g) => ({ g, ageMs: now - Date.parse(g.createdAt) }))
    .filter(({ ageMs }) => Number.isFinite(ageMs) && ageMs > SLA_BREACH_MS)
    .slice(0, SLA_SEED_MAX);
  for (const { g, ageMs } of breached) {
    rememberSeen(slaSeen, g.id); // never re-emit while watching
    lines.push({
      key: `sla-seed-${g.id}`,
      ts: isoToHhmmss(g.createdAt),
      cycle: g.cycle,
      tone: 'rose',
      text: `SLA BREACH ▸ ${clip(g.targetTitle)} pending ${Math.floor(ageMs / 60000)}m`,
    });
  }

  // Recent auto-triage releases become SYS history too — timestamped at the
  // release row's createdAt so the terminal shows when the policy acted.
  const released = data.governance
    .filter((g) => g.reviewDecision && isAutoTriaged(g))
    .slice(0, TRIAGE_SEED_MAX);
  for (const g of released) {
    rememberSeen(triageSeen, g.id);
    lines.push({
      key: `tri-seed-${g.id}`,
      ts: isoToHhmmss(g.createdAt),
      cycle: g.cycle,
      tone: 'amber',
      text: `AUTO-TRIAGE ▸ ${clip(g.targetTitle)} released (risk ${g.riskScore.toFixed(2)})`,
    });
  }
  return lines;
}

/**
 * Diff two payloads → new log lines (no RNG; the only clock uses are the
 * provided stamp plus SLA age computation against Date.now()).
 */
function diffEvents(prev: EngineStatePayload, next: EngineStatePayload, ts: string): LogLine[] {
  const cycle = next.engine.cycles;
  const out: LogLine[] = [];
  const push = (key: string, tone: Tone, text: string) => {
    out.push({ key, ts, cycle, tone, text });
  };

  // L1 — new signals ingested (+ L2 anomalies ≥ threshold)
  const prevSignalIds = new Set(prev.signals.map((s) => s.id));
  const newSignals = next.signals.filter((s) => !prevSignalIds.has(s.id));
  for (const s of newSignals.slice(0, CAPS.signals)) {
    push(`sig-${s.id}`, 'zinc', `L1 ▸ ingest [${s.category}] ${clip(s.title)}…`);
  }
  const anomalies = newSignals.filter((s) => s.anomalyScore >= ANOMALY_EMIT_THRESHOLD);
  for (const s of anomalies.slice(0, CAPS.anomalies)) {
    push(`ano-${s.id}`, 'rose', `L2 ▸ anomaly ${s.anomalyScore.toFixed(2)} ▸ ${clip(s.title)}`);
  }

  // L4 — new hypotheses + validated/rejected transitions
  const prevHypById = new Map(prev.hypotheses.map((h) => [h.id, h]));
  let hyps = 0;
  let transitions = 0;
  for (const h of next.hypotheses) {
    const before = prevHypById.get(h.id);
    if (!before) {
      if (hyps++ < CAPS.hypotheses) {
        push(`hyp-${h.id}`, 'violet', `L4 ▸ hypothesis [${h.generator}] ${clip(h.title)}`);
      }
      continue;
    }
    if (before.status !== h.status && (h.status === 'validated' || h.status === 'rejected')) {
      if (transitions++ < CAPS.transitions) {
        const p = h.validation?.pValue ?? 0;
        push(
          `trn-${h.id}-${h.status}`,
          h.status === 'validated' ? 'emerald' : 'rose',
          `L4 ▸ ${h.status} ▸ p=${p.toFixed(3)}`,
        );
      }
    }
  }

  // L5 — new breakthroughs (+ L7 deploy transitions)
  const prevBtById = new Map(prev.breakthroughs.map((b) => [b.id, b]));
  let bts = 0;
  for (const b of next.breakthroughs) {
    const before = prevBtById.get(b.id);
    if (!before) {
      if (bts++ < CAPS.breakthroughs) {
        push(`bt-${b.id}`, 'teal', `L5 ▸ breakthrough ▸ impact ${b.impactRank.toFixed(2)}`);
      }
      continue;
    }
    if (before.status !== b.status && b.status === 'deployed') {
      push(`dep-${b.id}`, 'emerald', `L7 ▸ DEPLOYED ▸ ${clip(b.title)}`);
    }
  }

  // L7 — new governance flags routed to human review
  const prevGovIds = new Set(prev.governance.map((g) => g.id));
  let govs = 0;
  for (const g of next.governance) {
    if (prevGovIds.has(g.id) || !g.humanReview || g.reviewDecision) continue;
    if (govs++ < CAPS.governance) {
      push(
        `gov-${g.id}`,
        'amber',
        `L7 ▸ flagged ${g.riskScore.toFixed(2)} ▸ ${g.ethicalFlags.slice(0, 3).join(',') || 'human review'}`,
      );
    }
  }

  // L8 — new reports
  const prevReportIds = new Set(prev.reports.map((r) => r.id));
  let reps = 0;
  for (const r of next.reports) {
    if (prevReportIds.has(r.id)) continue;
    if (reps++ < CAPS.reports) {
      push(`rep-${r.id}`, 'zinc', `L8 ▸ report ▸ ${clip(r.title)}`);
    }
  }

  // SYS — governance SLA breaches: pending human reviews crossing the 10-min
  // threshold between polls. Once per review id (Set guard, seeded on the
  // first payload); capped at 3 lines per flush — capped reviews stay
  // unguarded so they surface on the next poll instead of vanishing.
  const nowMs = Date.now();
  let sla = 0;
  for (const g of next.governance) {
    if (!isPendingReview(g) || slaSeen.has(g.id)) continue;
    const ageMs = nowMs - Date.parse(g.createdAt);
    if (!Number.isFinite(ageMs) || ageMs <= SLA_BREACH_MS) continue;
    if (sla >= SLA_PER_POLL_CAP) continue;
    rememberSeen(slaSeen, g.id);
    sla++;
    push(
      `sla-${g.id}`,
      'rose',
      `SYS SLA BREACH ▸ ${clip(g.targetTitle)} pending ${Math.floor(ageMs / 60000)}m`,
    );
  }

  // SYS — auto-triage releases: decided rows carrying the policy marker that
  // just appeared in the payload. Once per review id; capped at 2 lines per
  // flush — capped rows stay unguarded so they surface on the next poll.
  let tris = 0;
  for (const g of next.governance) {
    if (prevGovIds.has(g.id) || !g.reviewDecision || triageSeen.has(g.id)) continue;
    if (!isAutoTriaged(g)) continue;
    if (tris >= TRIAGE_PER_POLL_CAP) continue;
    rememberSeen(triageSeen, g.id);
    tris++;
    push(
      `tri-${g.id}`,
      'amber',
      `SYS AUTO-TRIAGE ▸ ${clip(g.targetTitle)} released (risk ${g.riskScore.toFixed(2)})`,
    );
  }

  // SYS — engine pause / resume
  if (prev.engine.status !== next.engine.status) {
    push(
      `sys-${next.engine.status}-${next.engine.lastTickAt}`,
      'amber',
      next.engine.status === 'paused' ? 'SYS ▸ engine paused' : 'SYS ▸ engine resumed',
    );
  }

  return out;
}

export function EventLog({ data }: { data: EngineStatePayload }) {
  const [prefs, setPrefs] = usePreferences();
  const expanded = prefs.logExpanded === true;
  const [lines, setLines] = useState<LogLine[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Session counters — monotonic unique-id totals (the rolling line buffer
  // would lose seeded/breached entries as old lines scroll out).
  const slaCount = slaSeen.size;
  const triCount = triageSeen.size;

  // Render-phase state adjustment (React "derive state from props" pattern):
  // keeps a rolling log bounded without timers, intervals or set-state-in-effect.
  const [prevData, setPrevData] = useState<EngineStatePayload | null>(null);
  if (data !== prevData) {
    setPrevData(data);
    const emitted = prevData
      ? diffEvents(prevData, data, hhmmss(new Date()))
      : seedHistory(data);
    if (emitted.length > 0) {
      // Direct value (not an updater) so StrictMode double-renders converge.
      setLines([...lines, ...emitted].slice(-MAX_LINES));
    }
  }

  // Terminal autoscroll: keep the newest line visible while expanded.
  useEffect(() => {
    if (!expanded) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, expanded]);

  const toggle = () => setPrefs({ logExpanded: !expanded });
  const visible = expanded ? lines : lines.slice(-COLLAPSED_LINES);

  return (
    <Panel
      title="System Event Stream"
      icon={Terminal}
      ariaLabel="System event stream terminal"
      actions={
        <>
          <span
            className="hidden items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0 font-mono text-[10px] uppercase tracking-wider text-rose-300 sm:inline-flex"
            title="Unique reviews that breached the 10-min SLA while this tab was open (session total)"
          >
            SLA {slaCount}
          </span>
          <span
            className="hidden items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0 font-mono text-[10px] uppercase tracking-wider text-amber-300 sm:inline-flex"
            title="Unique auto-triage releases observed while this tab was open (session total)"
          >
            AUTO {triCount}
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-wider text-zinc-600 sm:inline">
            {lines.length}/{MAX_LINES} evts
          </span>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse event stream' : 'Expand event stream'}
            className="inline-flex size-8 max-sm:size-11 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <ChevronDown
              className={cn('size-4 transition-transform duration-200', expanded && 'rotate-180')}
              aria-hidden
            />
          </button>
        </>
      }
      bodyClassName="px-3 py-2.5"
    >
      {visible.length === 0 ? (
        <p className="px-2 py-1 font-mono text-[11px] text-zinc-600" role="log" aria-live="polite">
          ▸ awaiting engine telemetry…
        </p>
      ) : (
        <div
          ref={scrollRef}
          className={cn(expanded && 'mc-scroll max-h-64 overflow-y-auto')}
        >
          <ul role="log" aria-live="polite" aria-label="System event stream" className="flex flex-col">
            {visible.map((line, i) => {
              const isLast = i === visible.length - 1;
              return (
                <li
                  key={line.key}
                  className={cn(
                    'flex items-baseline gap-2 border-l-2 py-0.5 pl-2 pr-1 font-mono text-[11px] leading-5',
                    TONE_BORDER[line.tone],
                  )}
                >
                  <span className="shrink-0 tabular-nums text-zinc-600">{line.ts}</span>
                  <span className="shrink-0 tabular-nums text-zinc-700">c{line.cycle}</span>
                  <span className={cn('min-w-0 flex-1 truncate', TONE_TEXT[line.tone])}>
                    {line.text}
                  </span>
                  {isLast ? (
                    <span className="mc-cursor-blink shrink-0 text-emerald-400" aria-hidden>
                      ▊
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}
