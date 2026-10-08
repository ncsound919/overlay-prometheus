'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Layers, Lock, PauseCircle, PlayCircle } from 'lucide-react';
import {
  Badge,
} from '@/components/ui/badge';
import { readPrometheusPrefs, usePreferences } from '@/hooks/use-preferences';
import { hypothesisStatusClass, riskBadgeClass } from '@/components/dashboard/meta';
import {
  Panel,
  Meter,
  StatChip,
  EmptyState,
  fmtNum,
  fmtScore,
  labelKey,
  type MeterTone,
} from '@/components/dashboard/shared';
import type { EngineInfo, EngineLayer, EngineStatePayload } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

const LAYER_GLOWS = [
  'shadow-[0_0_18px_-8px_rgba(16,185,129,0.5)]',
  'shadow-[0_0_18px_-8px_rgba(20,184,166,0.5)]',
  'shadow-[0_0_18px_-8px_rgba(20,184,166,0.5)]',
  'shadow-[0_0_18px_-8px_rgba(139,92,246,0.55)]',
  'shadow-[0_0_18px_-8px_rgba(139,92,246,0.6)]',
  'shadow-[0_0_18px_-8px_rgba(16,185,129,0.45)]',
  'shadow-[0_0_18px_-8px_rgba(244,63,94,0.4)]',
  'shadow-[0_0_18px_-8px_rgba(16,185,129,0.5)]',
];

function stateTone(state: EngineLayer['state']): { tone: MeterTone; label: string } {
  switch (state) {
    case 'active':
      return { tone: 'emerald', label: 'active' };
    case 'blocked':
      return { tone: 'rose', label: 'blocked' };
    default:
      return { tone: 'zinc', label: 'idle' };
  }
}

function loadTone(load: number): MeterTone {
  const pct = load <= 1 ? load * 100 : load;
  if (pct >= 90) return 'rose';
  if (pct >= 70) return 'amber';
  return 'emerald';
}

/** Animated flow connector between two layers. */
function Connector({ index, running }: { index: number; running: boolean }) {
  return (
    <div className="relative flex h-5 justify-center" aria-hidden>
      <div
        className={cn(
          'w-px rounded-full',
          running
            ? 'bg-gradient-to-b from-emerald-500/50 via-emerald-400/30 to-violet-500/50'
            : 'bg-zinc-700',
        )}
      />
      {running ? (
        <motion.span
          className="absolute left-1/2 top-0 size-1.5 -translate-x-1/2 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(16,185,129,0.5)]"
          animate={{ y: [0, 14], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'linear', delay: index * 0.16 }}
        />
      ) : null}
    </div>
  );
}

interface LayerOutput {
  label: string;
  value: string;
}

function layerOutputs(layerIndex: number, data: EngineStatePayload): LayerOutput[] {
  const lastTrend = data.analytics?.optimizationTrend?.at(-1);
  switch (layerIndex) {
    case 1:
      return [
        { label: 'Signals buffered', value: fmtNum(data.signals.length) },
        { label: 'Streams active', value: String(data.streams.filter((s) => s.status === 'active').length) },
      ];
    case 2:
      return [
        { label: 'Items ingested', value: fmtNum(data.streams.reduce((a, s) => a + s.itemsIngested, 0)) },
        { label: 'High-anomaly', value: String(data.signals.filter((s) => s.anomalyScore > 0.7).length) },
      ];
    case 3:
      return [
        { label: 'Cross-domain links', value: String(data.correlations.length) },
        {
          label: 'Strongest link',
          value: data.correlations.length
            ? `${data.correlations.slice().sort((a, b) => b.strength - a.strength)[0].sourceDomain} → ${data.correlations.slice().sort((a, b) => b.strength - a.strength)[0].targetDomain}`
            : '—',
        },
      ];
    case 4:
      return [
        { label: 'Hypotheses', value: String(data.hypotheses.length) },
        { label: 'Validated', value: String(data.hypotheses.filter((h) => h.status === 'validated').length) },
      ];
    case 5:
      return [
        { label: 'Breakthroughs', value: String(data.breakthroughs.length) },
        { label: 'Deployed', value: String(data.breakthroughs.filter((b) => b.status === 'deployed').length) },
      ];
    case 6:
      return [
        { label: 'Success rate', value: lastTrend ? fmtScore(lastTrend.successRate, 0) : '—' },
        { label: 'Avg novelty', value: lastTrend ? fmtScore(lastTrend.avgNovelty, 2) : '—' },
      ];
    case 7:
      return [
        { label: 'Checks', value: String(data.governance.length) },
        { label: 'Awaiting review', value: String(data.governance.filter((g) => g.humanReview).length) },
      ];
    default:
      return [
        { label: 'Reports', value: String(data.reports.length) },
        { label: 'Latest', value: data.reports[0]?.title ?? '—' },
      ];
  }
}

function layerRecentItems(layerIndex: number, data: EngineStatePayload): string[] {
  switch (layerIndex) {
    case 1:
    case 2:
      return data.signals.slice(0, 3).map((s) => s.title);
    case 3:
      return data.correlations
        .slice(0, 3)
        .map((c) => `${c.sourceDomain} ↔ ${c.targetDomain} (${fmtScore(c.strength, 2)})`);
    case 4:
      return data.hypotheses.slice(0, 3).map((h) => h.title);
    case 5:
      return data.breakthroughs.slice(0, 3).map((b) => b.title);
    case 6:
      return data.analytics?.optimizationTrend
        ?.slice(-3)
        .reverse()
        .map((t) => `Cycle ${t.cycle}: success ${(t.successRate * 100).toFixed(0)}%`);
    case 7:
      return data.governance.slice(0, 3).map((g) => g.targetTitle);
    default:
      return data.reports.slice(0, 3).map((r) => r.title);
  }
}

// ─── Recent artifacts mini-feed (Layer Detail panel) ─────────────────────────

interface LayerArtifact {
  key: string;
  title: string;
  chip?: string;
  chipClass?: string;
  cycle: number | null;
}

const CHIP_ROSE = 'border-rose-500/40 bg-rose-500/10 text-rose-300';
const CHIP_TEAL = 'border-teal-500/40 bg-teal-500/10 text-teal-300';
const CHIP_VIOLET = 'border-violet-500/40 bg-violet-500/10 text-violet-300';
const CHIP_ZINC = 'border-zinc-700 bg-zinc-800/60 text-zinc-400';

function reportTypeChip(type: string): { label: string; cls: string } {
  if (type === 'alert') return { label: 'alert', cls: CHIP_ROSE };
  if (type === 'deep-dive') return { label: 'deep-dive', cls: CHIP_VIOLET };
  return { label: type || 'summary', cls: CHIP_ZINC };
}

/** Latest artifacts per layer, derived entirely from the polled payload. */
function layerArtifacts(layerIndex: number, data: EngineStatePayload): LayerArtifact[] {
  switch (layerIndex) {
    case 1:
    case 2:
      return data.signals.slice(0, 3).map((s) => ({
        key: `sig-${s.id}`,
        title: s.title,
        chip: `anom ${s.anomalyScore.toFixed(2)}`,
        chipClass: s.anomalyScore >= 0.75 ? CHIP_ROSE : CHIP_ZINC,
        cycle: s.cycle,
      }));
    case 3:
      return data.correlations.slice(0, 3).map((c) => ({
        key: `cor-${c.id}`,
        title: `${c.sourceDomain} ↔ ${c.targetDomain}`,
        chip: `str ${c.strength.toFixed(2)}`,
        chipClass: CHIP_TEAL,
        cycle: null,
      }));
    case 4:
      return data.hypotheses.slice(0, 3).map((h) => ({
        key: `hyp-${h.id}`,
        title: h.title,
        chip: h.status,
        chipClass: hypothesisStatusClass(h.status),
        cycle: h.cycle,
      }));
    case 5:
      return data.breakthroughs.slice(0, 3).map((b) => ({
        key: `bt-${b.id}`,
        title: b.title,
        chip: `imp ${b.impactRank.toFixed(2)}`,
        chipClass: CHIP_TEAL,
        cycle: b.cycle,
      }));
    case 7:
      return data.governance.slice(0, 3).map((g) => ({
        key: `gov-${g.id}`,
        title: g.targetTitle,
        chip: `risk ${g.riskScore.toFixed(2)}`,
        chipClass: riskBadgeClass(g.riskScore),
        cycle: g.cycle,
      }));
    default:
      return data.reports.slice(0, 3).map((r) => ({
        key: `rep-${r.id}`,
        title: r.title,
        chip: reportTypeChip(r.reportType).label,
        chipClass: reportTypeChip(r.reportType).cls,
        cycle: r.cycle,
      }));
  }
}

export function LayerStack({ engine, data }: { engine: EngineInfo; data: EngineStatePayload }) {
  const running = engine.status === 'running';
  const layers = engine.layers;
  const [, setPrefs] = usePreferences();
  const [selected, setSelected] = useState<number | null>(() => {
    const persisted = readPrometheusPrefs().layerKey;
    return typeof persisted === 'number' && persisted >= 1 && persisted <= 8 ? persisted : null;
  });

  const selectLayer = (layer: number) => {
    setSelected(layer);
    setPrefs({ layerKey: layer });
  };

  // Cycle-change visuals are keyed off engine.cycles: each remount replays the
  // traveling shimmer + staggered per-layer glow, no timer state required.

  const selectedLayer = layers.find((l) => l.layer === selected) ?? layers[0];
  const selectedTrend = data.analytics?.optimizationTrend?.slice(-3) ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-4" aria-label="8-layer inference stack">
      <Panel
        title="8-Layer Inference Stack"
        icon={Layers}
        ariaLabel="8-layer inference stack"
        actions={
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {running ? (
              <>
                <PlayCircle className="size-3.5 text-emerald-400" aria-hidden /> flowing
              </>
            ) : (
              <>
                <PauseCircle className="size-3.5 text-amber-400" aria-hidden /> suspended
              </>
            )}
          </span>
        }
      >
        {layers.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="Stack offline"
            hint="Layer telemetry will appear once the engine reports its first state."
          />
        ) : (
          <div className="relative">
            {/* Traveling shimmer — replays whenever a new cycle lands (keyed by cycles) */}
            <motion.div
              key={`shimmer-${engine.cycles}`}
              className="pointer-events-none absolute inset-x-1 z-10 h-20 rounded-full bg-gradient-to-b from-transparent via-emerald-400/10 to-transparent"
              initial={{ top: '-12%', opacity: 0.15 }}
              animate={{ top: '104%', opacity: [0.15, 1, 1, 0] }}
              transition={{ duration: 1.35, ease: 'easeInOut' }}
              aria-hidden
            />

            <div role="list" aria-label="Inference layers">
              {layers.map((layer, idx) => {
                const { tone, label } = stateTone(layer.state);
                const isSelected = selectedLayer?.layer === layer.layer;
                const metricEntries = Object.entries(layer.metrics ?? {}).slice(0, 3);
                return (
                  <div key={layer.layer} role="listitem">
                    {idx > 0 ? <Connector index={idx} running={running} /> : null}
                    <motion.button
                      type="button"
                      onClick={() => selectLayer(layer.layer)}
                      aria-pressed={isSelected}
                      aria-label={`Layer ${layer.layer}: ${layer.name}. ${layer.purpose}`}
                      className={cn(
                        'group relative block w-full rounded-xl border bg-zinc-900/80 px-4 py-3 text-left transition-[background-color] duration-300 hover:bg-zinc-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
                        isSelected ? 'border-zinc-600' : 'border-zinc-800',
                        layer.state === 'active' && running ? LAYER_GLOWS[idx % LAYER_GLOWS.length] : '',
                      )}
                    >
                      {/* Staggered per-layer glow — replays on every new cycle */}
                      <motion.span
                        key={`flash-${layer.layer}-${engine.cycles}`}
                        className="pointer-events-none absolute inset-0 rounded-xl"
                        initial={{
                          boxShadow:
                            'inset 0 0 0 1px rgba(16,185,129,0.55), 0 0 18px -2px rgba(16,185,129,0.45)',
                        }}
                        animate={{
                          boxShadow:
                            'inset 0 0 0 1px rgba(16,185,129,0), 0 0 18px -2px rgba(16,185,129,0)',
                        }}
                        transition={{ duration: 1.1, delay: idx * 0.09, ease: 'easeOut' }}
                        aria-hidden
                      />
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center rounded-md border font-mono text-[11px] font-bold',
                            tone === 'emerald'
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                              : tone === 'rose'
                                ? 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                                : 'border-zinc-700 bg-zinc-800 text-zinc-400',
                          )}
                        >
                          L{layer.layer}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-zinc-100">
                              {layer.name}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                'hidden px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider sm:inline-flex',
                                tone === 'emerald'
                                  ? 'border-emerald-500/40 text-emerald-400'
                                  : tone === 'rose'
                                    ? 'border-rose-500/40 text-rose-400'
                                    : 'border-zinc-700 text-zinc-500',
                              )}
                            >
                              {label}
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-zinc-500">{layer.purpose}</p>
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center gap-3">
                        <Meter value={layer.load} tone={loadTone(layer.load)} className="flex-1" />
                        <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-zinc-400">
                          {Math.round(layer.load <= 1 ? layer.load * 100 : layer.load)}%
                        </span>
                        <div className="hidden shrink-0 gap-1.5 md:flex">
                          {metricEntries.map(([key, value]) => (
                            <StatChip
                              key={key}
                              label={labelKey(key)}
                              value={fmtNum(value, Math.abs(value) < 10 ? 2 : 0)}
                            />
                          ))}
                        </div>
                      </div>
                    </motion.button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      {/* Layer detail */}
      <AnimatePresence mode="wait">
        {selectedLayer ? (
          <motion.div
            key={selectedLayer.layer}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            <Panel
              title={`Layer Detail · L${selectedLayer.layer} ${selectedLayer.name}`}
              icon={Layers}
              ariaLabel={`Layer ${selectedLayer.layer} detail`}
              actions={
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  cycle {String(engine.cycles).padStart(3, '0')}
                </span>
              }
            >
              <p className="text-sm leading-relaxed text-zinc-300">{selectedLayer.purpose}</p>

              {Object.keys(selectedLayer.metrics ?? {}).length > 0 ? (
                <div className="mt-4">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Metrics
                  </h3>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {Object.entries(selectedLayer.metrics).map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
                      >
                        <p className="truncate text-[10px] uppercase tracking-wider text-zinc-500">
                          {labelKey(key)}
                        </p>
                        <p className="mt-0.5 font-mono text-sm font-medium tabular-nums text-zinc-200">
                          {fmtNum(value, Math.abs(value) < 10 ? 3 : 0)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-4">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Produced this cycle
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {layerOutputs(selectedLayer.layer, data).map((o) => (
                    <StatChip key={o.label} label={o.label} value={o.value} tone="violet" />
                  ))}
                </div>
                <ul className="mt-3 space-y-1.5">
                  {layerRecentItems(selectedLayer.layer, data).map((item, i) => (
                    <li
                      key={`${item}-${i}`}
                      className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5 text-xs text-zinc-400"
                    >
                      <span className="size-1 shrink-0 rounded-full bg-violet-400" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{item}</span>
                    </li>
                  ))}
                  {layerRecentItems(selectedLayer.layer, data).length === 0 ? (
                    <li className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-600">
                      <Lock className="size-3" aria-hidden /> No output recorded yet
                    </li>
                  ) : null}
                </ul>
              </div>

              {/* Recent artifacts mini-feed */}
              <div className="mt-4">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Recent artifacts
                </h3>
                {selectedLayer.layer === 6 ? (
                  selectedTrend.length === 0 ? (
                    <p className="mt-2 flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-600">
                      <Lock className="size-3" aria-hidden /> Layer not producing yet — no optimization telemetry
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {selectedTrend
                        .slice()
                        .reverse()
                        .map((t) => (
                          <li
                            key={t.cycle}
                            className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-zinc-300"
                          >
                            <span className="size-1 shrink-0 rounded-full bg-emerald-400" aria-hidden />
                            <span className="shrink-0 text-zinc-600">c{String(t.cycle).padStart(3, '0')}</span>
                            <span>SR {fmtScore(t.successRate, 0)}</span>
                            <span className="text-zinc-700" aria-hidden>·</span>
                            <span>NOV {fmtScore(t.avgNovelty, 2)}</span>
                          </li>
                        ))}
                    </ul>
                  )
                ) : layerArtifacts(selectedLayer.layer, data).length === 0 ? (
                  <p className="mt-2 flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-600">
                    <Lock className="size-3" aria-hidden /> Layer not producing yet — no artifacts recorded
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {layerArtifacts(selectedLayer.layer, data).map((a) => (
                      <li
                        key={a.key}
                        className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5"
                      >
                        <span className="size-1 shrink-0 rounded-full bg-violet-400" aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">
                          {a.title}
                        </span>
                        {a.cycle !== null ? (
                          <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">
                            c{String(a.cycle).padStart(3, '0')}
                          </span>
                        ) : null}
                        {a.chip ? (
                          <span
                            className={cn(
                              'shrink-0 rounded border px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider tabular-nums',
                              a.chipClass,
                            )}
                          >
                            {a.chip}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
