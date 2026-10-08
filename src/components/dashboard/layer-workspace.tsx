'use client';

/**
 * LAYERS WORKSPACE — per-layer drilldown.
 * A selector rail across the 8 inference layers; the selected layer expands
 * into a full-width workspace: live metrics grid, per-cycle sparkline (honest
 * series derived from the polled payload), and a scrollable entity ledger.
 * Shares the `layerKey` preference with the Layer Stack detail panel, so a
 * selection here follows the operator across workspaces.
 * Accent rules: zinc dark base, emerald/amber/rose/violet/teal only.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Boxes,
  ChevronRight,
  GitBranch,
  ScrollText,
  ShieldCheck,
  Signal as SignalIcon,
  Trophy,
  Wrench,
  type LucideProps,
} from 'lucide-react';
import { Panel, Meter, EmptyState, fmtNum, fmtScore, labelKey, timeAgo, type MeterTone } from '@/components/dashboard/shared';
import { hypothesisStatusClass, riskBadgeClass, solutionMeta } from '@/components/dashboard/meta';
import { usePreferences } from '@/hooks/use-preferences';
import type {
  Breakthrough,
  EngineInfo,
  EngineLayer,
  EngineStatePayload,
  GovernanceCheck,
  Hypothesis,
  InsightReport,
  Signal,
} from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

// ─── Layer registry (client-side mirror of the engine's 8 layers) ────────────

interface LayerSpec {
  layer: number;
  name: string;
  icon: ComponentType<LucideProps>;
  tone: MeterTone;
  /** One-line description of what the entity ledger shows for this layer. */
  ledgerLabel: string;
}

const LAYER_SPECS: LayerSpec[] = [
  { layer: 1, name: 'Input Universe', icon: SignalIcon, tone: 'teal', ledgerLabel: 'Domain streams' },
  { layer: 2, name: 'Preprocessing', icon: Activity, tone: 'amber', ledgerLabel: 'Raw signals (newest first)' },
  { layer: 3, name: 'Cross-Domain Analysis', icon: GitBranch, tone: 'violet', ledgerLabel: 'Inter-domain links' },
  { layer: 4, name: 'Discovery', icon: Boxes, tone: 'violet', ledgerLabel: 'Hypotheses (newest first)' },
  { layer: 5, name: 'Breakthrough', icon: Trophy, tone: 'emerald', ledgerLabel: 'Synthesized solutions' },
  { layer: 6, name: 'Self-Optimization', icon: Wrench, tone: 'emerald', ledgerLabel: 'Optimization telemetry' },
  { layer: 7, name: 'Governance', icon: ShieldCheck, tone: 'amber', ledgerLabel: 'Review queue (pendings pinned first)' },
  { layer: 8, name: 'Insight Output', icon: ScrollText, tone: 'rose', ledgerLabel: 'Published reports' },
];

const TONE_BORDER: Record<MeterTone, string> = {
  emerald: 'border-emerald-500/50 bg-emerald-500/10',
  amber: 'border-amber-500/50 bg-amber-500/10',
  rose: 'border-rose-500/50 bg-rose-500/10',
  violet: 'border-violet-500/50 bg-violet-500/10',
  teal: 'border-teal-500/50 bg-teal-500/10',
  zinc: 'border-zinc-700 bg-zinc-800/60',
};

const TONE_TEXT: Record<MeterTone, string> = {
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  rose: 'text-rose-400',
  violet: 'text-violet-400',
  teal: 'text-teal-400',
  zinc: 'text-zinc-400',
};

const TONE_STROKE: Record<MeterTone, string> = {
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  violet: '#8b5cf6',
  teal: '#14b8a6',
  zinc: '#a1a1aa',
};

const TONE_GLOW: Record<MeterTone, string> = {
  emerald: 'shadow-[0_0_16px_-6px_rgba(16,185,129,0.55)]',
  amber: 'shadow-[0_0_16px_-6px_rgba(245,158,11,0.55)]',
  rose: 'shadow-[0_0_16px_-6px_rgba(244,63,94,0.55)]',
  violet: 'shadow-[0_0_16px_-6px_rgba(139,92,246,0.55)]',
  teal: 'shadow-[0_0_16px_-6px_rgba(20,184,166,0.55)]',
  zinc: '',
};

// ─── Sparkline (pure SVG, non-scaling stroke, gradient area) ─────────────────

function Sparkline({
  series,
  tone,
  height = 72,
  label,
  sub,
}: {
  series: number[];
  tone: MeterTone;
  height?: number;
  label: string;
  sub?: string;
}) {
  const W = 300;
  const H = height;
  const color = TONE_STROKE[tone];
  const gradId = `lw-spark-${tone}-${label.replace(/[^a-z0-9]/gi, '')}`;

  if (series.length < 2) {
    return (
      <div className="flex h-[72px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-[11px] text-zinc-600">
        history accumulating — need ≥2 cycles
      </div>
    );
  }

  const max = Math.max(...series, 0.0001);
  const min = Math.min(...series);
  const span = max - min || 1;
  const step = W / (series.length - 1);
  const pts = series.map((v, i) => [i * step, H - 6 - ((v - min) / span) * (H - 14)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `0,${H} ${line} ${W},${H}`;
  const last = pts[pts.length - 1];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[72px] w-full"
        role="img"
        aria-label={`${label} — ${series.length} points, latest ${fmtNum(series[series.length - 1], series[series.length - 1] < 10 ? 2 : 0)}`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* min/max guide rails */}
        <line x1="0" y1="6" x2={W} y2="6" stroke="#3f3f46" strokeDasharray="3 5" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={H - 6} x2={W} y2={H - 6} stroke="#3f3f46" strokeDasharray="3 5" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <polygon points={area} fill={`url(#${gradId})`} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* last-point marker (r fixed — preserveAspectRatio=none would distort circles) */}
        <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
      </svg>
      <div className="pointer-events-none absolute inset-x-0 -top-0.5 flex items-center justify-between font-mono text-[9px] tabular-nums text-zinc-600">
        <span>{sub ?? `max ${fmtNum(max, max < 10 ? 2 : 0)}`}</span>
        <span className={TONE_TEXT[tone]}>{fmtNum(series[series.length - 1], series[series.length - 1] < 10 ? 2 : 0)}</span>
      </div>
    </div>
  );
}

// ─── Per-layer series (honest data from the payload) ─────────────────────────

function layerSeries(
  layer: number,
  data: EngineStatePayload,
): { label: string; series: number[]; tone: MeterTone; sub?: string } | null {
  const spc = data.analytics?.signalsPerCycle ?? [];
  switch (layer) {
    case 1:
      return spc.length
        ? { label: 'signals / cycle', series: spc.map((p) => p.signals), tone: 'teal' as const }
        : null;
    case 2:
      return spc.length
        ? { label: 'anomalies / cycle', series: spc.map((p) => p.anomalies), tone: 'amber' as const, sub: `≥ ${0.75} score` }
        : null;
    case 3: {
      // Correlations carry no cycle — render the strength spectrum instead.
      const bands = [0, 0, 0];
      for (const c of data.correlations) {
        if (c.strength >= 0.8) bands[2]++;
        else if (c.strength >= 0.6) bands[1]++;
        else bands[0]++;
      }
      return { label: 'link strength spectrum', series: bands, tone: 'violet' as const, sub: '0.4–0.6 / 0.6–0.8 / 0.8+' };
    }
    case 4: {
      const byCycle = new Map<number, number>();
      for (const h of data.hypotheses) byCycle.set(h.cycle, (byCycle.get(h.cycle) ?? 0) + 1);
      const series = [...byCycle.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
      return series.length >= 2 ? { label: 'hypotheses / cycle', series, tone: 'violet' as const } : null;
    }
    case 5: {
      const byCycle = new Map<number, number>();
      for (const b of data.breakthroughs) byCycle.set(b.cycle, (byCycle.get(b.cycle) ?? 0) + 1);
      const series = [...byCycle.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
      return series.length >= 2 ? { label: 'breakthroughs / cycle', series, tone: 'emerald' as const } : null;
    }
    case 6:
      return (data.analytics?.optimizationTrend ?? []).length >= 2
        ? {
            label: 'success rate trend',
            series: data.analytics.optimizationTrend.map((t) => Math.round(t.successRate * 100)),
            tone: 'emerald' as const,
            sub: '% validated',
          }
        : null;
    case 7: {
      const byCycle = new Map<number, number>();
      for (const g of data.governance) byCycle.set(g.cycle, (byCycle.get(g.cycle) ?? 0) + 1);
      const series = [...byCycle.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
      return series.length >= 2 ? { label: 'checks / cycle', series, tone: 'amber' as const } : null;
    }
    default: {
      const byCycle = new Map<number, number>();
      for (const r of data.reports) byCycle.set(r.cycle, (byCycle.get(r.cycle) ?? 0) + 1);
      const series = [...byCycle.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
      return series.length >= 2 ? { label: 'reports / cycle', series, tone: 'rose' as const } : null;
    }
  }
}

// ─── Entity ledger rows ──────────────────────────────────────────────────────

const ROW =
  'flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5 transition-colors duration-200 hover:border-zinc-700 hover:bg-zinc-900/60';

function CycleChip({ cycle }: { cycle: number | null }) {
  if (cycle === null || cycle === undefined) return null;
  return (
    <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">
      c{String(cycle).padStart(3, '0')}
    </span>
  );
}

function Chip({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'shrink-0 rounded border px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider tabular-nums',
        className,
      )}
    >
      {children}
    </span>
  );
}

function StreamRows({ data }: { data: EngineStatePayload }) {
  return (
    <>
      {data.streams.map((s) => (
        <li key={s.id} className={ROW}>
          <span className={cn('size-1.5 shrink-0 rounded-full', s.status === 'active' ? 'bg-teal-400' : 'bg-zinc-600')} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{s.name}</span>
          <Chip className="border-zinc-700 bg-zinc-800/60 text-zinc-400">{s.category}</Chip>
          <span className="hidden w-20 shrink-0 sm:block">
            <Meter value={s.health} tone={s.health >= 0.6 ? 'teal' : s.health >= 0.35 ? 'amber' : 'rose'} height="h-1" />
          </span>
          <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-zinc-500">
            {fmtNum(s.itemsIngested)} in
          </span>
        </li>
      ))}
    </>
  );
}

function SignalRows({ signals }: { signals: Signal[] }) {
  return (
    <>
      {signals.map((s) => (
        <li key={s.id} className={ROW}>
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{s.title}</span>
          <span className="hidden shrink-0 font-mono text-[10px] text-zinc-600 md:inline">{s.streamName}</span>
          <Chip className={s.anomalyScore >= 0.75 ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'}>
            anom {s.anomalyScore.toFixed(2)}
          </Chip>
          <Chip className="border-teal-500/40 bg-teal-500/10 text-teal-300">nov {s.noveltyScore.toFixed(2)}</Chip>
          <CycleChip cycle={s.cycle} />
          <span className="hidden w-16 shrink-0 text-right font-mono text-[9px] text-zinc-600 sm:inline">{timeAgo(s.createdAt)}</span>
        </li>
      ))}
    </>
  );
}

function LinkRows({ data }: { data: EngineStatePayload }) {
  const links = [...data.correlations].sort((a, b) => b.strength - a.strength);
  return (
    <>
      {links.map((c) => (
        <li key={c.id} className={ROW}>
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">
            <span className="text-violet-300">{c.sourceDomain}</span>
            <span className="text-zinc-600"> ↔ </span>
            <span className="text-teal-300">{c.targetDomain}</span>
          </span>
          <span className="hidden min-w-0 flex-1 truncate text-[11px] text-zinc-500 lg:block">{c.mechanism}</span>
          <span className="w-16 shrink-0">
            <Meter value={c.strength} tone="violet" height="h-1" />
          </span>
          <Chip className="border-violet-500/40 bg-violet-500/10 text-violet-300">str {c.strength.toFixed(2)}</Chip>
        </li>
      ))}
      <li className="px-2.5 pt-1 font-mono text-[10px] text-zinc-600" aria-hidden>
        {links.length} links · strongest first
      </li>
    </>
  );
}

function HypothesisRows({ hypotheses }: { hypotheses: Hypothesis[] }) {
  return (
    <>
      {hypotheses.map((h) => (
        <li key={h.id} className={ROW}>
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{h.title}</span>
          <Chip className={hypothesisStatusClass(h.status)}>{h.status}</Chip>
          <Chip className="border-violet-500/40 bg-violet-500/10 text-violet-300">N {h.novelty.toFixed(2)}</Chip>
          <Chip className="border-teal-500/40 bg-teal-500/10 text-teal-300">I {h.impact.toFixed(2)}</Chip>
          <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-wider text-zinc-600 md:inline">
            {h.generator === 'llm' ? 'LLM' : 'TPL'}
          </span>
          <CycleChip cycle={h.cycle} />
        </li>
      ))}
    </>
  );
}

function BreakthroughRows({ breakthroughs }: { breakthroughs: Breakthrough[] }) {
  return (
    <>
      {breakthroughs.map((b) => {
        const meta = solutionMeta(b.solutionType);
        const Icon = meta.icon;
        return (
          <li key={b.id} className={ROW}>
            <Icon className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{b.title}</span>
            <Chip className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">imp {b.impactRank.toFixed(2)}</Chip>
            <Chip className={riskBadgeClass(b.riskScore)}>risk {b.riskScore.toFixed(2)}</Chip>
            <Chip className="border-zinc-700 bg-zinc-800/60 text-zinc-400">{b.status}</Chip>
            <CycleChip cycle={b.cycle} />
          </li>
        );
      })}
    </>
  );
}

function OptimizationRows({ data }: { data: EngineStatePayload }) {
  const trend = (data.analytics?.optimizationTrend ?? []).slice().reverse();
  return (
    <>
      {trend.map((t) => (
        <li key={t.cycle} className={cn(ROW, 'font-mono text-[11px] tabular-nums')}>
          <span className="shrink-0 text-zinc-600">c{String(t.cycle).padStart(3, '0')}</span>
          <span className="flex-1" aria-hidden />
          <Chip className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">SR {fmtScore(t.successRate, 0)}</Chip>
          <Chip className="border-teal-500/40 bg-teal-500/10 text-teal-300">NOV {fmtScore(t.avgNovelty, 2)}</Chip>
        </li>
      ))}
    </>
  );
}

function isAutoTriaged(g: GovernanceCheck): boolean {
  return typeof g.notes === 'string' && g.notes.startsWith('AUTO-TRIAGE');
}

function decisionChip(g: GovernanceCheck): { label: string; cls: string } {
  if (g.reviewDecision === 'approved') {
    return isAutoTriaged(g)
      ? { label: 'auto ✓', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' }
      : { label: 'approved ✓', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' };
  }
  if (g.reviewDecision === 'rejected') {
    return { label: 'rejected ✗', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' };
  }
  return { label: 'pending…', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' };
}

function GovernanceRows({ governance }: { governance: GovernanceCheck[] }) {
  // Pendings pinned first (oldest breach at top), then decided rows newest-first.
  const pend = governance.filter((g) => g.humanReview && !g.reviewDecision).slice().reverse();
  const decided = governance.filter((g) => !g.humanReview || g.reviewDecision);
  const ordered = [...pend, ...decided];
  return (
    <>
      {ordered.map((g) => {
        const d = decisionChip(g);
        return (
          <li key={g.id} className={ROW}>
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{g.targetTitle}</span>
            <Chip className={riskBadgeClass(g.riskScore)}>risk {g.riskScore.toFixed(2)}</Chip>
            <Chip className={d.cls}>{d.label}</Chip>
            {g.ethicalFlags.length > 0 ? (
              <Chip className="border-rose-500/40 bg-rose-500/10 text-rose-300" title={g.ethicalFlags.join(', ')}>
                ⚑ {g.ethicalFlags.length}
              </Chip>
            ) : null}
            <CycleChip cycle={g.cycle} />
          </li>
        );
      })}
    </>
  );
}

function ReportRows({ reports }: { reports: InsightReport[] }) {
  return (
    <>
      {reports.map((r) => (
        <li key={r.id} className={ROW}>
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{r.title}</span>
          <Chip
            className={
              r.reportType === 'alert'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : r.reportType === 'deep-dive'
                  ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
            }
          >
            {r.reportType}
          </Chip>
          <CycleChip cycle={r.cycle} />
          <span className="hidden w-16 shrink-0 text-right font-mono text-[9px] text-zinc-600 sm:inline">{timeAgo(r.createdAt)}</span>
        </li>
      ))}
    </>
  );
}

// ─── Citation web (L4): evidence signals → hypotheses ────────────────────────

const CITE_ROW_H = 26;
const CITE_W = 640;
const CITE_MAX_SIGNALS = 12;
const CITE_MAX_HYPS = 7;

function clipTitle(t: string, max = 26): string {
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Bipartite citation web for Layer 4: cited evidence signals (left, teal,
 * ranked by how many of the rendered hypotheses cite them) vs the newest
 * hypotheses (right, violet). Bezier edges = one citation each. Pure SVG,
 * horizontally scrollable on narrow screens.
 */
function CitationWeb({ data }: { data: EngineStatePayload }) {
  const hypos = data.hypotheses.slice(0, CITE_MAX_HYPS);
  if (hypos.length === 0) return null;

  const citeCount = new Map<string, number>();
  for (const h of hypos) {
    for (const t of h.sourceSignals ?? []) citeCount.set(t, (citeCount.get(t) ?? 0) + 1);
  }
  const ranked = [...citeCount.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const shown = ranked.slice(0, CITE_MAX_SIGNALS);
  const overflow = ranked.length - shown.length;
  const signalIndex = new Map(shown.map(([t], i) => [t, i]));

  const leftCy = (i: number) => 10 + i * CITE_ROW_H;
  const rightCy = (i: number) => 10 + i * CITE_ROW_H;
  const rows = Math.max(shown.length, hypos.length);
  const H = rows * CITE_ROW_H + 14;

  const edges: Array<{ key: string; d: string; tip: string }> = [];
  hypos.forEach((h, hi) => {
    for (const t of h.sourceSignals ?? []) {
      const si = signalIndex.get(t);
      if (si === undefined) continue;
      const x1 = 306;
      const y1 = leftCy(si);
      const x2 = 334;
      const y2 = rightCy(hi);
      const mx = (x1 + x2) / 2;
      edges.push({
        key: `${h.id}::${si}::${t.slice(0, 16)}`,
        d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
        tip: `${t} → ${h.title}`,
      });
    }
  });

  return (
    <Panel
      title="Citation Web · Evidence → Hypotheses"
      icon={GitBranch}
      ariaLabel="Citation web — evidence signals to hypotheses"
      actions={
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {shown.length} signals · {hypos.length} hyps · {edges.length} edges
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-3 pb-2 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm border border-teal-500/40 bg-teal-500/10" aria-hidden /> cited signal
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm border border-violet-500/40 bg-violet-500/10" aria-hidden /> hypothesis
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <path d="M 0 3 C 6 3, 12 3, 18 3" stroke="#8b5cf6" strokeWidth="1.5" fill="none" opacity="0.6" />
          </svg>
          citation
        </span>
      </div>
      <div className="mc-scroll overflow-x-auto">
        <svg
          viewBox={`0 0 ${CITE_W} ${H}`}
          className="w-full min-w-[560px]"
          role="img"
          aria-label={`Citation web: ${shown.length} evidence signals linked to ${hypos.length} hypotheses via ${edges.length} citations`}
        >
          {/* edges */}
          {edges.map((e) => (
            <path
              key={e.key}
              d={e.d}
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="1.25"
              opacity="0.3"
              className="transition-opacity duration-200 hover:opacity-90"
            >
              <title>{e.tip}</title>
            </path>
          ))}
          {/* left nodes — cited signals */}
          {shown.map(([title], i) => {
            const y = leftCy(i);
            return (
              <g key={`sig-${i}`} className="cursor-default">
                <rect
                  x="2"
                  y={y - 9}
                  width="304"
                  height="18"
                  rx="4"
                  className="fill-zinc-950/80 stroke-teal-500/30 transition-colors duration-200 hover:stroke-teal-400/70"
                >
                  <title>{title}</title>
                </rect>
                <circle cx="10" cy={y} r="2" fill="#14b8a6" />
                <text x="17" y={y + 3.5} fontSize="10" fontFamily="ui-monospace, monospace" fill="#a1a1aa">
                  {clipTitle(title)}
                </text>
              </g>
            );
          })}
          {/* right nodes — hypotheses */}
          {hypos.map((h, i) => {
            const y = rightCy(i);
            return (
              <g key={h.id} className="cursor-default">
                <rect
                  x="334"
                  y={y - 9}
                  width="304"
                  height="18"
                  rx="4"
                  className="fill-zinc-950/80 stroke-violet-500/30 transition-colors duration-200 hover:stroke-violet-400/70"
                >
                  <title>{h.title}</title>
                </rect>
                <circle cx="342" cy={y} r="2" fill="#8b5cf6" />
                <text x="349" y={y + 3.5} fontSize="10" fontFamily="ui-monospace, monospace" fill="#d4d4d8">
                  {clipTitle(h.title)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {overflow > 0 ? (
        <p className="pt-1.5 font-mono text-[10px] text-zinc-600" aria-hidden>
          +{overflow} lower-cited signal{overflow === 1 ? '' : 's'} not rendered
        </p>
      ) : null}
    </Panel>
  );
}

// ─── Synthesis map (L5): component concepts → breakthroughs ─────────────────

const SYN_ROW_H = 26;
const SYN_W = 640;
const SYN_MAX_COMPONENTS = 14;
const SYN_MAX_BREAKTHROUGHS = 8;

/** Status → dot color (SVG-safe hex; zinc-950 theme accents only). */
function btStatusColor(status: string): string {
  switch (status) {
    case 'deployed': return '#10b981'; // emerald
    case 'flagged': return '#f59e0b';  // amber
    case 'blocked': return '#f43f5e';  // rose
    default: return '#71717a';         // zinc
  }
}

/**
 * Bipartite synthesis map for Layer 5: reusable component concepts (left,
 * teal, ranked by how many rendered breakthroughs compose them) vs the newest
 * breakthroughs (right, emerald frame, status-tinted dot + impact rank).
 * Bezier edges = one synthesis contribution each. Pure SVG, horizontally
 * scrollable on narrow screens — mirrors the L4 CitationWeb pattern.
 */
function SynthesisMap({ data }: { data: EngineStatePayload }) {
  // Hover state for cross-highlighting: which node kind + its identity.
  const [hover, setHover] = useState<{ kind: 'comp' | 'bt'; key: string } | null>(null);

  const bts = data.breakthroughs.slice(0, SYN_MAX_BREAKTHROUGHS);
  if (bts.length === 0) return null;

  const reuseCount = new Map<string, number>();
  for (const b of bts) {
    for (const c of b.synthesis?.components ?? []) reuseCount.set(c, (reuseCount.get(c) ?? 0) + 1);
  }
  const ranked = [...reuseCount.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const shown = ranked.slice(0, SYN_MAX_COMPONENTS);
  const overflow = ranked.length - shown.length;
  const compIndex = new Map(shown.map(([c], i) => [c, i]));

  const leftCy = (i: number) => 10 + i * SYN_ROW_H;
  const rightCy = (i: number) => 10 + i * SYN_ROW_H;
  const rows = Math.max(shown.length, bts.length);
  const H = rows * SYN_ROW_H + 14;

  // Adjacency for cross-highlighting: concept → breakthrough ids, id → concepts.
  const compToBts = new Map<string, string[]>();
  const btToComps = new Map<string, Set<string>>();
  for (const b of bts) {
    const comps = (b.synthesis?.components ?? []).filter((c) => compIndex.has(c));
    btToComps.set(b.id, new Set(comps));
    for (const c of comps) {
      const arr = compToBts.get(c);
      if (arr) arr.push(b.id);
      else compToBts.set(c, [b.id]);
    }
  }

  const edges: Array<{ key: string; d: string; tip: string; concept: string; btId: string }> = [];
  bts.forEach((b, bi) => {
    for (const c of b.synthesis?.components ?? []) {
      const ci = compIndex.get(c);
      if (ci === undefined) continue;
      const x1 = 306;
      const y1 = leftCy(ci);
      const x2 = 334;
      const y2 = rightCy(bi);
      const mx = (x1 + x2) / 2;
      edges.push({
        key: `${b.id}::${ci}::${c.slice(0, 16)}`,
        d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
        tip: `${c} → ${b.title}`,
        concept: c,
        btId: b.id,
      });
    }
  });

  // Reuse-weighted edge width: the more breakthroughs reuse a concept, the
  // heavier its composition links render (0.9 base, +0.35 per extra reuse, cap +1.4).
  const edgeWidth = (concept: string) => {
    const reuse = reuseCount.get(concept) ?? 1;
    return 0.9 + Math.min(reuse - 1, 4) * 0.35;
  };

  // Cross-highlight predicates (null = no hover → neutral rendering).
  const edgeLit = (e: { concept: string; btId: string }): boolean | null => {
    if (!hover) return null;
    return hover.kind === 'comp' ? hover.key === e.concept : hover.key === e.btId;
  };
  const compLit = (concept: string): boolean | null => {
    if (!hover) return null;
    if (hover.kind === 'comp') return hover.key === concept;
    return btToComps.get(hover.key)?.has(concept) ?? false;
  };
  const btLit = (btId: string): boolean | null => {
    if (!hover) return null;
    if (hover.kind === 'bt') return hover.key === btId;
    return compToBts.get(hover.key)?.includes(btId) ?? false;
  };

  const newest = bts[0];

  return (
    <Panel
      title="Synthesis Map · Components → Breakthroughs"
      icon={Trophy}
      ariaLabel="Synthesis map — component concepts composed into breakthroughs"
      actions={
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {shown.length} components · {bts.length} bt{bts.length === 1 ? '' : 's'} · {edges.length} links
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-3 pb-2 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm border border-teal-500/40 bg-teal-500/10" aria-hidden /> component concept
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm border border-emerald-500/40 bg-emerald-500/10" aria-hidden /> breakthrough
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <path d="M 0 3 C 6 3, 12 3, 18 3" stroke="#10b981" strokeWidth="1.5" fill="none" opacity="0.6" />
          </svg>
          composition
        </span>
        <span title="Edge weight scales with how many breakthroughs reuse the concept">
          width ∝ reuse
        </span>
        <span className="flex items-center gap-2.5" aria-hidden>
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: '#10b981' }} /> deployed</span>
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: '#f59e0b' }} /> flagged</span>
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: '#71717a' }} /> other</span>
        </span>
      </div>
      <div className="mc-scroll overflow-x-auto">
        <svg
          viewBox={`0 0 ${SYN_W} ${H}`}
          className="w-full min-w-[560px]"
          role="img"
          aria-label={`Synthesis map: ${shown.length} component concepts composed into ${bts.length} breakthroughs via ${edges.length} links`}
        >
          {/* edges — reuse-weighted, cross-highlighted on node hover */}
          {edges.map((e) => {
            const lit = edgeLit(e);
            const active = lit === true;
            const dimmed = lit === false;
            return (
              <path
                key={e.key}
                d={e.d}
                fill="none"
                stroke="#10b981"
                strokeWidth={edgeWidth(e.concept) + (active ? 0.7 : 0)}
                opacity={active ? 0.95 : dimmed ? 0.06 : 0.3}
                className="transition-[opacity,stroke-width] duration-200"
              >
                <title>{e.tip}</title>
              </path>
            );
          })}
          {/* left nodes — component concepts (reuse-counted, hoverable) */}
          {shown.map(([concept, count], i) => {
            const y = leftCy(i);
            const lit = compLit(concept);
            const dimmed = lit === false;
            return (
              <g
                key={`cmp-${i}`}
                className="cursor-default transition-opacity duration-200"
                opacity={dimmed ? 0.35 : 1}
                onMouseEnter={() => setHover({ kind: 'comp', key: concept })}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x="2"
                  y={y - 9}
                  width="304"
                  height="18"
                  rx="4"
                  className={cn(
                    'fill-zinc-950/80 transition-colors duration-200',
                    lit === true ? 'stroke-teal-400/80' : 'stroke-teal-500/30 hover:stroke-teal-400/70',
                  )}
                >
                  <title>{count > 1 ? `${concept} — reused by ${count} breakthroughs` : concept}</title>
                </rect>
                <circle cx="10" cy={y} r={lit === true ? 3 : 2} className="transition-all duration-200" fill="#14b8a6" />
                <text x="17" y={y + 3.5} fontSize="10" fontFamily="ui-monospace, monospace" fill={lit === true ? '#5eead4' : '#a1a1aa'}>
                  {clipTitle(concept)}
                </text>
                {count > 1 ? (
                  <text
                    x="296"
                    y={y + 3.5}
                    fontSize="9"
                    textAnchor="end"
                    fontFamily="ui-monospace, monospace"
                    fill="#14b8a6"
                  >
                    ×{count}
                  </text>
                ) : null}
              </g>
            );
          })}
          {/* right nodes — breakthroughs (hoverable) */}
          {bts.map((b, i) => {
            const y = rightCy(i);
            const lit = btLit(b.id);
            const dimmed = lit === false;
            return (
              <g
                key={b.id}
                className="cursor-default transition-opacity duration-200"
                opacity={dimmed ? 0.35 : 1}
                onMouseEnter={() => setHover({ kind: 'bt', key: b.id })}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x="334"
                  y={y - 9}
                  width="304"
                  height="18"
                  rx="4"
                  className={cn(
                    'fill-zinc-950/80 transition-colors duration-200',
                    lit === true ? 'stroke-emerald-400/80' : 'stroke-emerald-500/30 hover:stroke-emerald-400/70',
                  )}
                >
                  <title>{`${b.title} — impact ${b.impactRank.toFixed(2)} · ${b.status}`}</title>
                </rect>
                <circle cx="342" cy={y} r={lit === true ? 3.5 : 2.5} className="transition-all duration-200" fill={btStatusColor(b.status)} />
                <text x="350" y={y + 3.5} fontSize="10" fontFamily="ui-monospace, monospace" fill={lit === true ? '#6ee7b7' : '#d4d4d8'}>
                  {clipTitle(b.title)}
                </text>
                <text
                  x="630"
                  y={y + 3.5}
                  fontSize="9"
                  textAnchor="end"
                  fontFamily="ui-monospace, monospace"
                  fill="#6ee7b7"
                >
                  {b.impactRank.toFixed(2)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {overflow > 0 ? (
        <p className="pt-1.5 font-mono text-[10px] text-zinc-600" aria-hidden>
          +{overflow} lower-reused component{overflow === 1 ? '' : 's'} not rendered
        </p>
      ) : null}
      {/* Mechanism strip — the synthesis rationale of the newest breakthrough */}
      {newest?.synthesis?.mechanism ? (
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-400">
            Mechanism · latest breakthrough
          </p>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-zinc-300">
            {newest.synthesis.mechanism}
          </p>
          <p className="mt-1.5 truncate font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            {clipTitle(newest.title, 52)} · feas {newest.synthesis.feasibility?.toFixed(2) ?? '—'} · {newest.synthesis.expectedGain ?? '—'} · {newest.synthesis.timeHorizon ?? '—'}
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

// ─── Main workspace ──────────────────────────────────────────────────────────

function layerEntities(layer: number, data: EngineStatePayload): number {
  switch (layer) {
    case 1: return data.streams.length;
    case 2: return data.signals.length;
    case 3: return data.correlations.length;
    case 4: return data.hypotheses.length;
    case 5: return data.breakthroughs.length;
    case 6: return data.analytics?.optimizationTrend?.length ?? 0;
    case 7: return data.governance.length;
    default: return data.reports.length;
  }
}

export function LayerWorkspace({ engine, data }: { engine: EngineInfo; data: EngineStatePayload }) {
  const [prefs, setPrefs] = usePreferences();
  const selected =
    typeof prefs.layerKey === 'number' && prefs.layerKey >= 1 && prefs.layerKey <= 8
      ? prefs.layerKey
      : 1;

  const spec = LAYER_SPECS[selected - 1];
  const layerInfo: EngineLayer | undefined = engine.layers.find((l) => l.layer === selected);
  const spark = useMemo(() => layerSeries(selected, data), [selected, data]);
  const metricEntries = Object.entries(layerInfo?.metrics ?? {});
  const entityCount = layerEntities(selected, data);
  const SpecIcon = spec.icon;

  return (
    <div className="flex min-w-0 flex-col gap-4" aria-label="Per-layer drilldown workspace">
      {/* Selector rail */}
      <div
        role="toolbar"
        aria-label="Select inference layer"
        className="mc-scroll flex gap-2 overflow-x-auto pb-1"
      >
        {LAYER_SPECS.map((s) => {
          const active = s.layer === selected;
          const count = layerEntities(s.layer, data);
          return (
            <button
              key={s.layer}
              type="button"
              onClick={() => setPrefs({ layerKey: s.layer })}
              aria-pressed={active}
              aria-label={`Layer ${s.layer}: ${s.name} — ${count} items`}
              className={cn(
                'group flex min-w-36 shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 min-h-11',
                active
                  ? cn('border-zinc-600 bg-zinc-800/80', TONE_GLOW[s.tone])
                  : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-800/50',
              )}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-md border font-mono text-[11px] font-bold transition-colors',
                  active ? TONE_BORDER[s.tone] + ' ' + TONE_TEXT[s.tone] : 'border-zinc-700 bg-zinc-800 text-zinc-500',
                )}
              >
                L{s.layer}
              </span>
              <span className="min-w-0">
                <span className={cn('block truncate text-xs font-semibold', active ? 'text-zinc-100' : 'text-zinc-400')}>
                  {s.name}
                </span>
                <span className="block font-mono text-[10px] tabular-nums text-zinc-600">{count} items</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* L4 extra: citation web (evidence → hypotheses) */}
      {selected === 4 ? <CitationWeb data={data} /> : null}

      {/* L5 extra: synthesis map (components → breakthroughs) */}
      {selected === 5 ? <SynthesisMap data={data} /> : null}

      {/* Workspace panel */}
      <motion.div
        key={`ws-${selected}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <Panel
          title={`L${spec.layer} · ${spec.name}`}
          icon={SpecIcon}
          ariaLabel={`Layer ${spec.layer} workspace`}
          actions={
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <span className={cn('size-1.5 rounded-full', layerInfo?.state === 'active' ? 'bg-emerald-400 mc-led' : layerInfo?.state === 'blocked' ? 'bg-rose-500' : 'bg-zinc-600')} aria-hidden />
              {layerInfo?.state ?? 'idle'}
              <span className="text-zinc-700" aria-hidden>·</span>
              <span className="tabular-nums">load {Math.round((layerInfo?.load ?? 0) * 100)}%</span>
            </span>
          }
        >
          <p className="text-sm leading-relaxed text-zinc-300">{layerInfo?.purpose ?? spec.name}</p>

          {/* Metrics grid + sparkline */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Live metrics · cycle {String(engine.cycles).padStart(3, '0')}
              </h3>
              {metricEntries.length === 0 ? (
                <p className="mt-2 rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] text-zinc-600">
                  No metrics recorded for this layer yet
                </p>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {metricEntries.map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                      <p className="truncate text-[10px] uppercase tracking-wider text-zinc-500">{labelKey(key)}</p>
                      <p className="mt-0.5 font-mono text-sm font-medium tabular-nums text-zinc-200">
                        {fmtNum(value, Math.abs(value) < 10 ? 3 : 0)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3">
                <Meter value={layerInfo?.load ?? 0} tone={spec.tone} height="h-1.5" />
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                {spark ? spark.label : 'History'}
              </h3>
              <div className="mt-2">
                {spark ? (
                  <Sparkline series={spark.series} tone={spark.tone} label={spark.label} sub={spark.sub} />
                ) : (
                  <div className="flex h-[72px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-[11px] text-zinc-600">
                    history accumulating — need ≥2 cycles
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Entity ledger */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                {spec.ledgerLabel}
              </h3>
              <span className="font-mono text-[10px] tabular-nums text-zinc-600">{entityCount} rows</span>
            </div>
            <ul className="mc-scroll mt-2 max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {entityCount === 0 ? (
                <EmptyState
                  icon={SpecIcon}
                  title="Layer not producing yet"
                  hint="Rows will appear here as soon as the engine records output for this layer."
                />
              ) : selected === 1 ? (
                <StreamRows data={data} />
              ) : selected === 2 ? (
                <SignalRows signals={data.signals} />
              ) : selected === 3 ? (
                <LinkRows data={data} />
              ) : selected === 4 ? (
                <HypothesisRows hypotheses={data.hypotheses} />
              ) : selected === 5 ? (
                <BreakthroughRows breakthroughs={data.breakthroughs} />
              ) : selected === 6 ? (
                <OptimizationRows data={data} />
              ) : selected === 7 ? (
                <GovernanceRows governance={data.governance} />
              ) : (
                <ReportRows reports={data.reports} />
              )}
            </ul>
          </div>
        </Panel>
      </motion.div>

      {/* Hidden affordance: hint that selection syncs with the Layer Stack panel */}
      <p className="flex items-center gap-1.5 px-1 text-[10px] text-zinc-600" aria-hidden>
        <ChevronRight className="size-3" />
        selection follows you across the Layer Stack detail panel
      </p>
    </div>
  );
}
