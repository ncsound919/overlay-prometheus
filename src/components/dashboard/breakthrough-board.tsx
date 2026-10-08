'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Ban, Loader2, Rocket, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useBreakthroughAction } from '@/hooks/use-engine';
import {
  EmptyState,
  ExportIconButton,
  Meter,
  Panel,
  fmtScore,
  timeAgo,
} from '@/components/dashboard/shared';
import { solutionMeta, riskBadgeClass } from '@/components/dashboard/meta';
import type { Breakthrough } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'deployed':
      return 'border-teal-500/40 bg-teal-500/10 text-teal-300';
    case 'blocked':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
    case 'governed':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    default:
      return 'border-violet-500/40 bg-violet-500/10 text-violet-300';
  }
}

function BreakthroughCard({ breakthrough }: { breakthrough: Breakthrough }) {
  const { toast } = useToast();
  const action = useBreakthroughAction();
  const pendingAction = action.isPending ? action.variables?.action : undefined;
  const Icon = solutionMeta(breakthrough.solutionType).icon;
  const s = breakthrough.synthesis ?? {
    components: [],
    mechanism: '',
    feasibility: 0,
    expectedGain: '',
    timeHorizon: '',
  };
  const deployed = breakthrough.status === 'deployed';
  const blocked = breakthrough.status === 'blocked';

  const runAction = (next: 'deploy' | 'block') => {
    action.mutate(
      { breakthrough, action: next },
      {
        onSuccess: () =>
          toast({
            title: next === 'deploy' ? 'Breakthrough deployed' : 'Breakthrough blocked',
            description: next === 'deploy'
              ? `"${breakthrough.title}" pushed to the deployment pipeline.`
              : `"${breakthrough.title}" was blocked pending rework.`,
          }),
        onError: (err) =>
          toast({ title: 'Action failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-zinc-900/70 p-4 transition-[border-color,box-shadow] duration-300',
        deployed
          ? 'border-teal-500/40 shadow-[0_0_24px_-8px_rgba(20,184,166,0.4)]'
          : breakthrough.impactRank > 0.8
            ? 'border-emerald-500/40 hover:shadow-[0_0_24px_-6px_rgba(16,185,129,0.4)]'
            : 'border-zinc-800 hover:border-zinc-600',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-violet-400">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-100">{breakthrough.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
            <span className="font-mono normal-case text-violet-400">{solutionMeta(breakthrough.solutionType).label}</span>
            <span aria-hidden>·</span>
            <span className="font-mono normal-case">impact {fmtScore(breakthrough.impactRank, 2)}</span>
            <span aria-hidden>·</span>
            <time dateTime={breakthrough.createdAt}>{timeAgo(breakthrough.createdAt)}</time>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant="outline" className={cn('px-1.5 py-0 font-mono text-[10px] uppercase', statusBadgeClass(breakthrough.status))}>
            {breakthrough.status}
          </Badge>
          <Badge variant="outline" className={cn('px-1.5 py-0 font-mono text-[10px]', riskBadgeClass(breakthrough.riskScore))}>
            risk {fmtScore(breakthrough.riskScore, 2)}
          </Badge>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-zinc-400">{breakthrough.summary}</p>

      <div className="flex flex-col gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Synthesis</h4>
        {s.components.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {s.components.map((c) => (
              <span key={c} className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                {c}
              </span>
            ))}
          </div>
        ) : null}
        {s.mechanism ? <p className="text-xs leading-relaxed text-zinc-400">{s.mechanism}</p> : null}
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">feasibility</span>
          <Meter value={s.feasibility} tone={s.feasibility >= 0.6 ? 'emerald' : 'amber'} className="flex-1" />
          <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-zinc-400">
            {fmtScore(s.feasibility, 2)}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
            gain {s.expectedGain || '—'}
          </span>
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
            horizon {s.timeHorizon || '—'}
          </span>
        </div>
      </div>

      <div className="mt-auto flex gap-2">
        <Button
          size="sm"
          onClick={() => runAction('deploy')}
          disabled={action.isPending || deployed || blocked}
          aria-label={`Deploy ${breakthrough.title}`}
          className="h-9 flex-1 gap-1.5 bg-teal-600/90 text-white hover:bg-teal-600"
        >
          {pendingAction === 'deploy' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Rocket className="size-4" aria-hidden />}
          Deploy
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runAction('block')}
          disabled={action.isPending || blocked}
          aria-label={`Block ${breakthrough.title}`}
          className="h-9 flex-1 gap-1.5 border-rose-900/60 text-rose-400 hover:bg-rose-950/30 hover:text-rose-300"
        >
          {pendingAction === 'block' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Ban className="size-4" aria-hidden />}
          Block
        </Button>
      </div>
    </motion.article>
  );
}

export function BreakthroughBoard({ breakthroughs }: { breakthroughs: Breakthrough[] }) {
  const types = useMemo(() => {
    const set = new Map<string, number>();
    for (const b of breakthroughs) set.set(b.solutionType, (set.get(b.solutionType) ?? 0) + 1);
    return Array.from(set.entries());
  }, [breakthroughs]);
  const [active, setActive] = useState<string>('all');

  const visible = active === 'all' ? breakthroughs : breakthroughs.filter((b) => b.solutionType === active);
  const ordered = visible.slice().sort((a, b) => b.impactRank - a.impactRank);

  return (
    <Panel
      title="Breakthrough Board"
      icon={Trophy}
      ariaLabel="Breakthrough board"
      actions={
        <>
          <ExportIconButton
            entity="breakthroughs"
            format="json"
            label="Export breakthroughs as JSON"
          />
          <ExportIconButton
            entity="breakthroughs"
            format="csv"
            label="Export breakthroughs as CSV"
          />
        </>
      }
      bodyClassName="p-4 pt-3"
    >
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter breakthroughs by solution type">
        <button
          type="button"
          onClick={() => setActive('all')}
          aria-pressed={active === 'all'}
          className={cn(
            'min-h-8 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
            active === 'all'
              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
              : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300',
          )}
        >
          All
        </button>
        {types.map(([type, count]) => {
          const Icon = solutionMeta(type).icon;
          return (
            <button
              key={type}
              type="button"
              onClick={() => setActive(type)}
              aria-pressed={active === type}
              className={cn(
                'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
                active === type
                  ? 'border-violet-500/50 bg-violet-500/15 text-violet-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {solutionMeta(type).label}
              <span className="font-mono text-[10px] opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={breakthroughs.length === 0 ? 'No breakthroughs synthesized yet' : 'Nothing in this category'}
          hint="Promoted hypotheses are synthesized into deployable breakthroughs in Layer 5."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {ordered.map((b) => (
            <BreakthroughCard key={b.id} breakthrough={b} />
          ))}
        </div>
      )}
    </Panel>
  );
}
