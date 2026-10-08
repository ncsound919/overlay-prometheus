'use client';

import { Fragment } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Radio, X } from 'lucide-react';
import { Panel, StatusDot, EmptyState, timeAgo } from '@/components/dashboard/shared';
import type { Signal } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

/**
 * Live signal ingest ticker — latest signals entering Layer 1/2.
 * New arrivals animate in via AnimatePresence (keyed by signal id).
 * Rows can be filtered to a single stream category (see Input Universe),
 * operator-injected signals carry features.sourceOp === 1 (POST /api/signals
 * convention) and get a violet OPERATOR badge, and high-anomaly rows
 * (anomalyScore >= 0.75) keep a persistent rose left border at rest.
 */
export function SignalTicker({
  signals,
  filterCategory,
  onClearFilter,
}: {
  signals: Signal[];
  /** Active stream-category filter, or null/undefined when off. */
  filterCategory?: string | null;
  /** Clears the active filter (✕ on the FILTER chip). */
  onClearFilter?: () => void;
}) {
  const filtered = filterCategory
    ? signals.filter((s) => s.category === filterCategory)
    : signals;
  const latest = filtered.slice(0, 40);

  return (
    <Panel
      title="Signal Ingest Ticker"
      icon={Radio}
      ariaLabel="Live signal ingest ticker"
      actions={
        <>
          {filterCategory ? (
            <button
              type="button"
              onClick={onClearFilter}
              aria-label={`Clear ticker filter: ${filterCategory}`}
              title="Clear stream filter"
              className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/20"
            >
              FILTER: {filterCategory}
              <X className="size-3" aria-hidden />
            </button>
          ) : null}
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-400">
            <StatusDot tone="emerald" pulse />
            live
          </span>
        </>
      }
      bodyClassName="p-0"
    >
      {latest.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={Radio}
            title={filterCategory ? `No signals for ${filterCategory}` : 'Awaiting first signals'}
            hint={
              filterCategory
                ? 'Clear the filter or inject a signal into this stream.'
                : 'Raw observations will stream here as streams are polled.'
            }
          />
        </div>
      ) : (
        <div
          role="log"
          aria-live="polite"
          aria-label="Latest ingested signals"
          className="mc-scroll max-h-80 overflow-y-auto"
        >
          <AnimatePresence initial={false}>
            {latest.map((signal) => {
              const hot = signal.anomalyScore > 0.7;
              // Persistent at-rest marker for high-anomaly rows (>= 0.75).
              const highAnomaly = signal.anomalyScore >= 0.75;
              // OPERATOR badge: number-encoded marker in the features JSON
              // (convention documented in POST /api/signals + dashboard-types).
              const isOperator = signal.features?.sourceOp === 1;
              return (
                <motion.div
                  key={signal.id}
                  layout
                  initial={{ opacity: 0, y: -10, backgroundColor: 'rgba(16,185,129,0.08)' }}
                  animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(16,185,129,0)' }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.45 }}
                  className={cn(
                    'border-b border-zinc-800/50 px-4 py-2.5 last:border-b-0 hover:bg-zinc-800/25',
                    highAnomaly && 'border-l-2 border-l-rose-500/70',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
                        hot
                          ? 'bg-rose-500/15 text-rose-400'
                          : 'bg-zinc-800 text-zinc-400',
                      )}
                    >
                      {signal.streamName || signal.category}
                    </span>
                    {isOperator ? (
                      <span
                        className="shrink-0 rounded bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-violet-300"
                        title="Injected by a human operator"
                      >
                        OPERATOR
                      </span>
                    ) : null}
                    <p className="min-w-0 flex-1 truncate text-xs text-zinc-300">{signal.title}</p>
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[10px] tabular-nums',
                        hot ? 'text-rose-400' : 'text-zinc-500',
                      )}
                    >
                      A{signal.anomalyScore.toFixed(2)}
                    </span>
                    <span className="hidden shrink-0 font-mono text-[10px] tabular-nums text-violet-400 sm:inline">
                      N{signal.noveltyScore.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
                    <span className="font-mono">CYC {String(signal.cycle).padStart(3, '0')}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={signal.createdAt}>{timeAgo(signal.createdAt)}</time>
                    {Object.keys(signal.features ?? {}).length > 0 ? (
                      <Fragment>
                        <span aria-hidden>·</span>
                        <span className="truncate font-mono">
                          {Object.entries(signal.features)
                            .filter(([k]) => k !== 'sourceOp')
                            .slice(0, 3)
                            .map(([k, v]) => `${k} ${Number(v).toFixed(2)}`)
                            .join(' · ')}
                        </span>
                      </Fragment>
                    ) : null}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </Panel>
  );
}
