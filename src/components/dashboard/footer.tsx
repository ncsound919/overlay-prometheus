'use client';

import { useEffect, useState } from 'react';
import { Cpu, ShieldCheck, Waypoints } from 'lucide-react';
import type { AutoTriagePolicy, Breakthrough, GovernanceCheck, Hypothesis, Signal } from '@/lib/dashboard-types';
import { useFeedStore } from '@/lib/feed-store';
import { useGovernanceBacklog } from '@/hooks/use-engine';
import { fmtScore } from '@/components/dashboard/shared';
import { cn } from '@/lib/utils';

function FooterStat({
  label,
  value,
  title,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5" title={title}>
      <span className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600 sm:inline">
        {label}
      </span>
      <span className="truncate font-mono text-xs font-medium tabular-nums text-zinc-300">{value}</span>
    </div>
  );
}

function hhmmss(ms: number | null): string {
  if (ms === null) return '--:--:--';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── Backlog debt trend — session sparkline of pending human reviews ────────

const BACKLOG_CAP = 240;

/** Session-scoped series (module-anchored so HMR keeps history): one sample
 *  per telemetry payload whose pending count differs from the last sample. */
const backlogHistory: number[] = (() => {
  const g = globalThis as { __prometheusBacklogHistory?: number[] };
  g.__prometheusBacklogHistory ??= [];
  return g.__prometheusBacklogHistory;
})();

function sampleBacklog(pendingCount: number) {
  if (backlogHistory.length > 0 && backlogHistory[backlogHistory.length - 1] === pendingCount) return;
  backlogHistory.push(pendingCount);
  if (backlogHistory.length > BACKLOG_CAP) backlogHistory.splice(0, backlogHistory.length - BACKLOG_CAP);
}

/** Mini SVG sparkline for the footer stat row — amber, gradient area fill. */
function BacklogSpark({ series }: { series: number[] }) {
  const W = 64;
  const H = 18;
  const pad = 2;
  if (series.length < 2) {
    return (
      <svg width={W} height={H} aria-hidden className="opacity-60">
        <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} stroke="#52525b" strokeWidth="1" strokeDasharray="2 3" />
      </svg>
    );
  }
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pts = series.map((v, i) => {
    const x = pad + (i / (series.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / span) * (H - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `M ${pts[0][0].toFixed(1)} ${H - pad} L ${line.split(' ').map((p) => p).join(' L ')} L ${pts[pts.length - 1][0].toFixed(1)} ${H - pad} Z`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={W} height={H} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="backlog-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#backlog-fill)" />
      <polyline points={line} fill="none" stroke="#f59e0b" strokeWidth="1.25" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="1.8" fill="#fbbf24" />
    </svg>
  );
}

/**
 * Right-side telemetry cluster — live-feed throughput at a glance.
 * While `live`, a 5s local interval keeps the last-push stamp fresh between
 * pushes (the store only updates on real pushes).
 */
function FeedTelemetry() {
  const status = useFeedStore((s) => s.status);
  const pushCount = useFeedStore((s) => s.pushCount);
  const clients = useFeedStore((s) => s.clients);
  const lastPushAt = useFeedStore((s) => s.lastPushAt);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (status !== 'live') return;
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => window.clearInterval(id);
  }, [status]);

  const dot =
    status === 'live'
      ? 'bg-emerald-400 mc-led'
      : status === 'connecting'
        ? 'bg-amber-400'
        : 'bg-zinc-500';
  const text =
    status === 'live'
      ? `FEED ${pushCount} · ${clients} CLI · ${hhmmss(lastPushAt)}`
      : status === 'connecting'
        ? 'FEED SYNC'
        : 'FEED POLL';

  return (
    <span
      role="status"
      aria-label="Telemetry feed status"
      className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 sm:inline-flex"
    >
      <span className={cn('size-1.5 rounded-full', dot)} aria-hidden />
      <span className="tabular-nums">{text}</span>
    </span>
  );
}

/** Subtle keyboard hint (desktop only) — opens the ⌘K command palette. */
function PaletteHint() {
  return (
    <span
      aria-hidden
      className="hidden items-center rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500 sm:inline-flex"
    >
      ⌘K Commands
    </span>
  );
}

export function DashboardFooter({
  signals,
  streams,
  hypotheses,
  breakthroughs,
  governance,
  running,
  policy,
}: {
  signals: Signal[];
  streams: { signalCount: number }[];
  hypotheses: Hypothesis[];
  breakthroughs: Breakthrough[];
  governance: GovernanceCheck[];
  running: boolean;
  policy?: AutoTriagePolicy;
}) {
  const totalSignals = streams.reduce((acc, s) => acc + s.signalCount, 0) || signals.length;
  const validated = hypotheses.filter((h) => h.status === 'validated' || h.status === 'promoted').length;
  const validatedPct = hypotheses.length > 0 ? validated / hypotheses.length : 0;
  const deployed = breakthroughs.filter((b) => b.status === 'deployed').length;
  // Pass rate counts only DECIDED reviews; pending reviews are reported separately.
  const decided = governance.filter((g) => g.reviewDecision);
  const approved = decided.filter((g) => g.reviewDecision === 'approved').length;
  const passRate = decided.length > 0 ? approved / decided.length : null;
  const pending = governance.filter((g) => g.humanReview && !g.reviewDecision).length;

  // Whole-table pending (the state payload caps its slice at 120 — R10 fix).
  // Falls back to the payload count while the 8s telemetry query loads.
  const backlogQuery = useGovernanceBacklog();
  const realPending = backlogQuery.data?.pendingTotal ?? null;
  const shownPending = realPending ?? pending;

  // Render-phase sampling (same pattern as EventLog): each new telemetry
  // payload contributes one backlog sample (deduped, capped). Once the
  // whole-table query is live, real-total changes drive the series instead.
  const [prevGov, setPrevGov] = useState<typeof governance | null>(null);
  if (governance !== prevGov) {
    setPrevGov(governance);
    if (realPending === null) sampleBacklog(pending);
  }
  const [prevReal, setPrevReal] = useState<number | null>(null);
  if (realPending !== null && realPending !== prevReal) {
    setPrevReal(realPending);
    sampleBacklog(realPending);
  }

  const govSummary = (
    <>
      {passRate !== null ? fmtScore(passRate, 0) : '—'} · {shownPending} PENDING
      {policy?.enabled ? (
        <span className="ml-1.5 text-amber-400" title={`Standing auto-triage: releases risk ≤ ${policy.maxRisk.toFixed(2)} after ${policy.afterMinutes}m`}>
          · AUTO ≤{policy.maxRisk.toFixed(2)}
        </span>
      ) : null}
      {policy?.enabled && policy.midRisk?.enabled ? (
        <span className="ml-1 text-violet-400" title={`Mid-risk valve: releases ${policy.maxRisk.toFixed(2)} < risk ≤ ${policy.midRisk.maxRisk.toFixed(2)} after ${policy.midRisk.afterMinutes}m`}>
          · MID ≤{policy.midRisk.maxRisk.toFixed(2)}
        </span>
      ) : null}
    </>
  );

  return (
    <footer className="sticky bottom-0 z-30 mt-auto border-t border-zinc-800 bg-zinc-950/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5 sm:px-6">
        <FooterStat label="Signals" value={String(totalSignals)} />
        <FooterStat label="Hyp. validated" value={fmtScore(validatedPct, 0)} />
        <FooterStat label="Breakthroughs deployed" value={String(deployed)} />
        <FooterStat label="Gov. review" value={govSummary} title={realPending !== null ? `${realPending} pending reviews whole-table (payload window caps at 120)` : undefined} />
        <FooterStat
          label="Backlog"
          title={realPending !== null ? `Whole-table pending human reviews — ${backlogHistory.length} session sample${backlogHistory.length === 1 ? '' : 's'} (one per change)` : `Pending human reviews across this session — ${backlogHistory.length} sample${backlogHistory.length === 1 ? '' : 's'} (one per payload change, window-scoped)`}
          value={
            <span className="inline-flex items-center gap-1.5">
              <BacklogSpark series={backlogHistory} />
              <span className="text-amber-400">{shownPending}</span>
            </span>
          }
        />
        <FooterStat
          label="Auto-triaged"
          title="Releases by the standing auto-triage policy visible in the current telemetry window (3 newest are pinned)"
          value={String(governance.filter((g) => typeof g.notes === 'string' && g.notes.startsWith('AUTO-TRIAGE')).length)}
        />

        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          <Cpu className="size-3.5" aria-hidden />
          AURORA-KERNEL v1.0
        </span>
        <FeedTelemetry />
        <PaletteHint />
        <span
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-400"
          role="status"
        >
          {/* Status LED strip — staggered blink, reduced-motion safe */}
          <span className="flex items-center gap-1" aria-hidden>
            {(['bg-emerald-400', 'bg-amber-400', 'bg-emerald-400'] as const).map((led, i) => (
              <span
                key={led + i}
                className={`mc-led size-1.5 rounded-full ${led}`}
                style={{ animationDelay: `${i * 0.35}s` }}
              />
            ))}
          </span>
          <Waypoints className="size-3.5" aria-hidden />
          {running ? 'All systems autonomous' : 'Systems standing by'}
          <ShieldCheck className="size-3.5" aria-hidden />
        </span>
      </div>
    </footer>
  );
}
