'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Satellite, Syringe } from 'lucide-react';
import { Panel, Meter, StatusDot, EmptyState, fmtNum, type MeterTone } from '@/components/dashboard/shared';
import { InjectSignalDialog } from '@/components/dashboard/inject-signal-dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { DomainStream } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

function streamTone(status: string): { tone: MeterTone; label: string } {
  switch (status) {
    case 'active':
      return { tone: 'emerald', label: 'active' };
    case 'throttled':
      return { tone: 'amber', label: 'throttled' };
    default:
      return { tone: 'rose', label: status || 'offline' };
  }
}

/** Deterministic pseudo-sparkline derived from stream velocity (stable per render). */
function VelocitySpark({ velocity, tone }: { velocity: number; tone: MeterTone }) {
  const bars = Array.from({ length: 7 }, (_, i) => {
    const wave = Math.abs(Math.sin(velocity * (i + 1) * 1.7 + i));
    return Math.max(0.18, Math.min(1, 0.25 + wave * 0.75));
  });
  const fill =
    tone === 'emerald' ? 'bg-emerald-500/80' : tone === 'amber' ? 'bg-amber-500/80' : 'bg-rose-500/80';
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className={cn('w-[3px] rounded-sm', fill)}
          style={{ height: `${Math.round(h * 100)}%`, opacity: 0.45 + h * 0.55 }}
        />
      ))}
    </span>
  );
}

export function InputUniverse({
  streams,
  filterCategory,
  onToggleFilter,
}: {
  streams: DomainStream[];
  /** Active ticker stream filter (category), or null when off. */
  filterCategory?: string | null;
  /** Toggle the ticker filter to a stream's category (click the row again to clear). */
  onToggleFilter?: (category: string) => void;
}) {
  const totalIngested = streams.reduce((acc, s) => acc + s.itemsIngested, 0);
  const [injectOpen, setInjectOpen] = useState(false);

  return (
    <Panel
      title="Input Universe"
      icon={Satellite}
      ariaLabel="Input universe — domain streams"
      actions={
        <>
          <span className="hidden font-mono text-[10px] uppercase tracking-wider text-zinc-500 sm:inline">
            {streams.length} streams · {fmtNum(totalIngested)} ingested
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInjectOpen(true)}
                aria-label="Inject Signal"
                className="h-8 max-sm:size-11 max-sm:p-0 gap-1.5 border-zinc-700 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-emerald-300"
              >
                <Syringe className="size-3.5 text-emerald-400" aria-hidden />
                <span className="hidden sm:inline">Inject Signal</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200">
              Feed a high-signal observation into Layer 1
            </TooltipContent>
          </Tooltip>
        </>
      }
      bodyClassName="p-0"
    >
      {streams.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={Satellite}
            title="No domain streams registered"
            hint="Streams appear here once the engine ingests its first sources."
          />
        </div>
      ) : (
        <ul className="mc-scroll max-h-[26rem] overflow-y-auto lg:max-h-[30rem]">
          {streams.map((stream, idx) => {
            const { tone, label } = streamTone(stream.status);
            const isFiltered = filterCategory === stream.category;
            const row = (
              <>
                <div className="flex items-center gap-2">
                  <StatusDot tone={tone} pulse={stream.status === 'active'} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
                    {stream.name}
                  </span>
                  <VelocitySpark velocity={stream.velocity} tone={tone} />
                  <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-zinc-400">
                    v{stream.velocity.toFixed(1)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
                      <span>{stream.category}</span>
                      <span className="font-mono normal-case tabular-nums">
                        {fmtNum(stream.itemsIngested)} in · {fmtNum(stream.signalCount)} sig
                      </span>
                    </div>
                    <Meter value={stream.health} tone={tone} className="mt-1" />
                  </div>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    {label}
                  </span>
                </div>
              </>
            );

            if (!onToggleFilter) {
              return (
                <motion.li
                  key={stream.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(idx * 0.04, 0.4), duration: 0.3 }}
                  className="border-b border-zinc-800/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-zinc-800/30"
                >
                  {row}
                </motion.li>
              );
            }

            return (
              <motion.li
                key={stream.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(idx * 0.04, 0.4), duration: 0.3 }}
                role="button"
                tabIndex={0}
                aria-pressed={isFiltered}
                aria-label={`${isFiltered ? 'Stop filtering the ticker by' : 'Filter the ticker by'} ${stream.name}`}
                onClick={() => onToggleFilter(stream.category)}
                onKeyDown={(e) => {
                  // Only when the row itself (not a nested control) is focused.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggleFilter(stream.category);
                  }
                }}
                className={cn(
                  'cursor-pointer border-b border-zinc-800/60 px-4 py-3 transition-[background-color,border-color,box-shadow] duration-300 last:border-b-0 hover:border-zinc-700 hover:bg-zinc-800/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-500',
                  isFiltered && 'bg-emerald-500/[0.05] ring-1 ring-inset ring-emerald-500/50',
                )}
              >
                {row}
              </motion.li>
            );
          })}
        </ul>
      )}

      <InjectSignalDialog open={injectOpen} onOpenChange={setInjectOpen} streams={streams} />
    </Panel>
  );
}
