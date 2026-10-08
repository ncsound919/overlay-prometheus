'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertOctagon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Meter, Panel, fmtScore, timeAgo } from '@/components/dashboard/shared';
import { solutionMeta, riskBadgeClass } from '@/components/dashboard/meta';
import type { Breakthrough } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

/** Right rail — top 3 breakthroughs by impactRank; > 0.8 impact gets a glow. */
export function BreakthroughAlerts({ breakthroughs }: { breakthroughs: Breakthrough[] }) {
  const top = breakthroughs
    .slice()
    .sort((a, b) => b.impactRank - a.impactRank)
    .slice(0, 3);

  return (
    <Panel
      title="Breakthrough Alerts"
      icon={AlertOctagon}
      ariaLabel="Breakthrough alerts — highest impact"
      actions={
        <Badge
          variant="outline"
          className="border-violet-500/40 bg-violet-500/10 px-1.5 py-0 font-mono text-[10px] text-violet-300"
        >
          {breakthroughs.length} total
        </Badge>
      }
    >
      {top.length === 0 ? (
        <EmptyState
          icon={AlertOctagon}
          title="No breakthroughs yet"
          hint="Validated hypotheses get synthesized into breakthrough candidates."
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {top.map((b, idx) => {
              const Icon = solutionMeta(b.solutionType).icon;
              const hot = b.impactRank > 0.8;
              return (
                <motion.li
                  key={b.id}
                  layout
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.3, delay: idx * 0.05 }}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 transition-colors duration-300',
                    hot
                      ? 'border-emerald-500/50 bg-emerald-500/[0.06] shadow-[0_0_24px_-4px_rgba(16,185,129,0.45)]'
                      : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border',
                        hot
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                          : 'border-zinc-700 bg-zinc-800 text-violet-400',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">{b.title}</p>
                      <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
                        <span className="font-mono normal-case text-violet-400">
                          {solutionMeta(b.solutionType).label}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="font-mono normal-case">
                          impact {fmtScore(b.impactRank, 2)}
                        </span>
                        <span aria-hidden>·</span>
                        <time dateTime={b.createdAt}>{timeAgo(b.createdAt)}</time>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('shrink-0 px-1.5 py-0 font-mono text-[10px]', riskBadgeClass(b.riskScore))}
                    >
                      R {fmtScore(b.riskScore, 2)}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">impact</span>
                    <Meter value={b.impactRank} tone={hot ? 'emerald' : 'violet'} className="flex-1" />
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}
