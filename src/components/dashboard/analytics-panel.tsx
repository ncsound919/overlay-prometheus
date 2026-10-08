'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, GitCompareArrows, LineChart as LineChartIcon, ScatterChart as ScatterIcon } from 'lucide-react';
import {
  EmptyState,
  Meter,
  Panel,
  fmtNum,
  fmtScore,
  labelKey,
} from '@/components/dashboard/shared';
import { CorrelationGraph } from '@/components/dashboard/correlation-graph';
import { statusChartColor } from '@/components/dashboard/meta';
import type { Analytics, Correlation } from '@/lib/dashboard-types';

// ─── Dark mission-control chart theme (NO blue defaults) ─────────────────────

const GRID_STROKE = '#27272a';
const AXIS_STROKE = '#3f3f46';
const TICK_FILL = '#71717a';

const axisProps = {
  stroke: AXIS_STROKE,
  tick: { fill: TICK_FILL, fontSize: 10 },
  tickLine: false,
  axisLine: { stroke: AXIS_STROKE },
} as const;

const tooltipProps = {
  contentStyle: {
    backgroundColor: '#18181b',
    border: '1px solid #3f3f46',
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: '#a1a1aa', fontFamily: 'var(--font-geist-mono), monospace' },
  itemStyle: { color: '#e4e4e7' },
  cursor: { stroke: '#52525b', strokeDasharray: '4 4' },
} as const;

function pctTick(v: number | string): string {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : String(v);
}

function ChartFrame({
  title,
  icon: Icon,
  empty,
  emptyHint,
  children,
}: {
  title: string;
  icon: typeof LineChartIcon;
  empty: boolean;
  emptyHint: string;
  children: React.ReactNode;
}) {
  return (
    <Panel title={title} icon={Icon} bodyClassName="p-4 pt-3">
      {empty ? (
        <EmptyState icon={Icon} title="No data yet" hint={emptyHint} />
      ) : (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

export function AnalyticsPanel({
  analytics,
  correlations,
}: {
  analytics: Analytics;
  correlations: Correlation[];
}) {
  const a = analytics ?? {
    signalsPerCycle: [],
    domainDistribution: [],
    noveltyImpact: [],
    layerThroughput: [],
    optimizationTrend: [],
  };
  const maxThroughput = Math.max(1, ...a.layerThroughput.map((p) => p.value));
  const sortedCorrelations = correlations.slice().sort((x, y) => y.strength - x.strength).slice(0, 6);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ChartFrame
        title="Signals per Cycle"
        icon={LineChartIcon}
        empty={a.signalsPerCycle.length === 0}
        emptyHint="Signal + anomaly counts plot here as cycles execute."
      >
        <LineChart data={a.signalsPerCycle} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
          <XAxis dataKey="cycle" {...axisProps} />
          <YAxis {...axisProps} allowDecimals={false} />
          <Tooltip {...tooltipProps} />
          <Line
            type="monotone"
            dataKey="signals"
            name="signals"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: '#10b981' }}
          />
          <Line
            type="monotone"
            dataKey="anomalies"
            name="anomalies"
            stroke="#f43f5e"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: '#f43f5e' }}
          />
        </LineChart>
      </ChartFrame>

      <ChartFrame
        title="Domain Distribution"
        icon={BarChart3}
        empty={a.domainDistribution.length === 0}
        emptyHint="Signal volume per source domain appears after ingestion."
      >
        <BarChart data={a.domainDistribution} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="domain" {...axisProps} interval={0} angle={-30} textAnchor="end" height={48} />
          <YAxis {...axisProps} allowDecimals={false} />
          <Tooltip {...tooltipProps} cursor={{ fill: 'rgba(139,92,246,0.08)' }} />
          <Bar dataKey="count" name="signals" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={38} />
        </BarChart>
      </ChartFrame>

      <ChartFrame
        title="Novelty × Impact"
        icon={ScatterIcon}
        empty={a.noveltyImpact.length === 0}
        emptyHint="Each point is a hypothesis, colored by status."
      >
        <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
          <XAxis type="number" dataKey="novelty" name="novelty" domain={[0, 1]} tickFormatter={pctTick} {...axisProps} />
          <YAxis type="number" dataKey="impact" name="impact" domain={[0, 1]} tickFormatter={pctTick} {...axisProps} />
          <Tooltip {...tooltipProps} />
          <Scatter data={a.noveltyImpact} name="hypothesis">
            {a.noveltyImpact.map((p) => (
              <Cell key={p.id} fill={statusChartColor(p.status)} fillOpacity={0.85} />
            ))}
          </Scatter>
        </ScatterChart>
      </ChartFrame>

      <ChartFrame
        title="Optimization Trend"
        icon={LineChartIcon}
        empty={a.optimizationTrend.length === 0}
        emptyHint="Self-optimization success rate and average novelty per cycle."
      >
        <AreaChart data={a.optimizationTrend} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id="opt-emerald" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="opt-violet" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
          <XAxis dataKey="cycle" {...axisProps} />
          <YAxis domain={[0, 1]} tickFormatter={pctTick} {...axisProps} />
          <Tooltip {...tooltipProps} />
          <Area
            type="monotone"
            dataKey="successRate"
            name="success rate"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#opt-emerald)"
          />
          <Area
            type="monotone"
            dataKey="avgNovelty"
            name="avg novelty"
            stroke="#8b5cf6"
            strokeWidth={2}
            fill="url(#opt-violet)"
          />
        </AreaChart>
      </ChartFrame>

      {/* Layer throughput + cross-domain correlations */}
      <Panel
        title="Layer Throughput"
        icon={BarChart3}
        ariaLabel="Layer throughput"
        bodyClassName="p-4 pt-3"
      >
        {a.layerThroughput.length === 0 ? (
          <EmptyState icon={BarChart3} title="No throughput data" hint="Per-layer processing volume appears after the first cycle." />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {a.layerThroughput.map((p) => (
              <li key={p.layer} className="flex items-center gap-3">
                <span className="w-8 shrink-0 font-mono text-[11px] font-bold text-zinc-400">L{p.layer}</span>
                <Meter value={(p.value / maxThroughput) * 100} tone={p.layer <= 3 ? 'teal' : p.layer <= 5 ? 'violet' : 'emerald'} className="flex-1" />
                <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-zinc-400">
                  {fmtNum(p.value)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Cross-domain correlation network + ranked list */}
      <CorrelationGraph correlations={correlations} />

      <Panel
        title="Cross-Domain Correlations"
        icon={GitCompareArrows}
        ariaLabel="Cross-domain correlations"
        bodyClassName="p-4 pt-3"
      >
        {sortedCorrelations.length === 0 ? (
          <EmptyState icon={GitCompareArrows} title="No correlations found" hint="Layer 3 links domains once enough signals accumulate." />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {sortedCorrelations.map((c) => (
              <li key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-teal-300">{c.sourceDomain}</span>
                  <span className="text-zinc-600" aria-hidden>↔</span>
                  <span className="font-mono text-[11px] text-teal-300">{c.targetDomain}</span>
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-400">
                    {fmtScore(c.strength, 2)}
                  </span>
                </div>
                <Meter value={c.strength} tone="teal" className="mt-1.5" />
                <p className="mt-1.5 truncate text-[11px] text-zinc-500">{c.mechanism}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="col-span-full text-center font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-700">
        telemetry window · rolling · {labelKey('dashboard-analytics')}
      </p>
    </div>
  );
}
