'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownWideNarrow,
  Ban,
  Check,
  ChevronDown,
  FlaskConical,
  Lightbulb,
  Loader2,
  X,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useHypothesisOverride } from '@/hooks/use-engine';
import {
  EmptyState,
  ExportIconButton,
  Meter,
  Panel,
  fmtNum,
  fmtScore,
  timeAgo,
} from '@/components/dashboard/shared';
import { HypothesisDialog } from '@/components/dashboard/hypothesis-dialog';
import { hypothesisStatusClass } from '@/components/dashboard/meta';
import type { Breakthrough, Hypothesis, Signal } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'validated' | 'testing' | 'rejected';
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'validated', label: 'Validated' },
  { key: 'testing', label: 'Testing' },
  { key: 'rejected', label: 'Rejected' },
];

function matchesFilter(h: Hypothesis, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'validated') return h.status === 'validated' || h.status === 'promoted';
  return h.status === filter;
}

const PROMOTABLE_STATUSES = new Set(['generated', 'testing', 'validated']);
const TOOLTIP_CLASS = 'border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200';

/**
 * Human intelligence override row, rendered inside the hypothesis dialog:
 * Force Promote (Layer-5 synthesis shortcut) + Veto (reject with confirm).
 */
function HypothesisOverrideActions({
  hypothesis,
  onClose,
}: {
  hypothesis: Hypothesis;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const override = useHypothesisOverride();
  const pendingAction =
    override.isPending && override.variables?.hypothesis.id === hypothesis.id
      ? override.variables?.action
      : undefined;

  const canPromote = PROMOTABLE_STATUSES.has(hypothesis.status);
  const canVeto = hypothesis.status !== 'promoted' && hypothesis.status !== 'rejected';
  const promoteDisabledReason = `Unavailable while status is '${hypothesis.status}' — only generated, testing or validated hypotheses can be force-promoted`;
  const vetoDisabledReason = `Unavailable while status is '${hypothesis.status}' — already decided`;

  const runOverride = (action: 'promote' | 'veto') => {
    override.mutate(
      { hypothesis, action },
      {
        onSuccess: (res) => {
          if (action === 'promote') {
            toast({
              title: 'Promoted — synthesis queued for governance review',
              description: res.breakthroughId
                ? `Breakthrough ${res.breakthroughId.slice(0, 14)}… synthesized (risk 0.20, expedited review).`
                : 'Breakthrough synthesized.',
            });
          } else {
            toast({
              title: 'Hypothesis vetoed',
              description: `"${hypothesis.title.slice(0, 72)}" was marked rejected by human operator.`,
            });
          }
          onClose();
        },
        onError: (err) =>
          toast({
            title: action === 'promote' ? 'Override failed' : 'Veto failed',
            description: err.message,
            variant: 'destructive',
          }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-800/80 pt-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
        Human override
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              disabled={!canPromote || pendingAction !== undefined}
              onClick={() => runOverride('promote')}
              aria-label={
                canPromote
                  ? `Force promote "${hypothesis.title}" to a breakthrough`
                  : `Force promote disabled: ${promoteDisabledReason}`
              }
              title={canPromote ? 'Human override: promote to breakthrough' : promoteDisabledReason}
              className="h-9 max-sm:h-11 gap-1.5 bg-violet-600/90 text-white hover:bg-violet-600"
            >
              {pendingAction === 'promote' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Zap className="size-4" aria-hidden />
              )}
              Force Promote
            </Button>
          </TooltipTrigger>
          {canPromote ? (
            <TooltipContent className={TOOLTIP_CLASS}>
              Human override: promote to breakthrough
            </TooltipContent>
          ) : null}
        </Tooltip>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={!canVeto || pendingAction !== undefined}
              aria-label={
                canVeto
                  ? `Veto "${hypothesis.title}" — mark rejected`
                  : `Veto disabled: ${vetoDisabledReason}`
              }
              title={canVeto ? 'Human override: reject this hypothesis' : vetoDisabledReason}
              className="h-9 max-sm:h-11 gap-1.5 border-rose-900/60 text-rose-400 hover:bg-rose-950/30 hover:text-rose-300"
            >
              {pendingAction === 'veto' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Ban className="size-4" aria-hidden />
              )}
              Veto
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
            <AlertDialogHeader>
              <AlertDialogTitle>Veto this hypothesis?</AlertDialogTitle>
              <AlertDialogDescription className="text-zinc-400">
                “{hypothesis.title}” will be marked rejected and excluded from breakthrough
                synthesis. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => runOverride('veto')}
                className="bg-rose-700 text-white hover:bg-rose-600"
              >
                Veto hypothesis
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function HypothesisCard({
  hypothesis,
  onOpen,
}: {
  hypothesis: Hypothesis;
  onOpen: (h: Hypothesis) => void;
}) {
  const cf = hypothesis.counterfactuals ?? [];
  const v = hypothesis.validation;
  const hasValidation = Boolean(v && v.simulations > 0);

  return (
    <Collapsible
      className="group/hyp cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900/70 transition-[border-color,box-shadow] duration-300 hover:border-zinc-600 hover:shadow-[0_0_20px_-8px_rgba(139,92,246,0.35)]"
      role="button"
      tabIndex={0}
      aria-label={`Open hypothesis details: ${hypothesis.title}`}
      onClick={() => onOpen(hypothesis)}
      onKeyDown={(e) => {
        // Only when the card itself (not the nested collapse trigger) is focused.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(hypothesis);
        }
      }}
    >
      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <CollapsibleTrigger
            className="min-w-0 flex-1 text-left"
            aria-label={`Expand counterfactuals: ${hypothesis.title}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-violet-400" aria-hidden />
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-100">
                  {hypothesis.title}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                  {hypothesis.summary}
                </p>
              </div>
            </div>
          </CollapsibleTrigger>
          <Badge
            variant="outline"
            className={cn('shrink-0 px-1.5 py-0 font-mono text-[10px] uppercase', hypothesisStatusClass(hypothesis.status))}
          >
            {hypothesis.status}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1">
          {hypothesis.domains.map((d) => (
            <span
              key={d}
              className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400"
            >
              {d}
            </span>
          ))}
          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-violet-400">
            {hypothesis.generator}
          </span>
          {(hypothesis.sourceSignals?.length ?? 0) > 0 ? (
            <span
              className="rounded bg-teal-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-teal-400"
              title={`Cited evidence: ${hypothesis.sourceSignals.slice(0, 3).join(' · ')}`}
            >
              cites {hypothesis.sourceSignals.length} signal{hypothesis.sourceSignals.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          {(
            [
              { label: 'novelty', value: hypothesis.novelty, tone: 'violet' as const },
              { label: 'impact', value: hypothesis.impact, tone: 'emerald' as const },
              { label: 'confidence', value: hypothesis.confidence, tone: 'teal' as const },
            ]
          ).map((m) => (
            <div key={m.label} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">{m.label}</span>
              <Meter value={m.value} tone={m.tone} className="flex-1" />
              <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-zinc-400">
                {fmtScore(m.value, 2)}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            CYC {String(hypothesis.cycle).padStart(3, '0')} · {timeAgo(hypothesis.createdAt)}
          </span>
          <CollapsibleTrigger
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            onClick={(e) => e.stopPropagation()}
          >
            Counterfactuals
            <ChevronDown className="size-3.5 transition-transform group-data-[state=open]/hyp:rotate-180" aria-hidden />
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent>
        <div className="border-t border-zinc-800/80 px-4 py-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Counterfactual probes
          </h4>
          {cf.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-600">No counterfactual probes recorded.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              <AnimatePresence initial={false}>
                {cf.map((c, i) => (
                  <motion.li
                    key={`${c.question}-${i}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/50 px-2.5 py-2"
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
                        c.supports ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400',
                      )}
                      aria-label={c.supports ? 'Supports hypothesis' : 'Refutes hypothesis'}
                    >
                      {c.supports ? <Check className="size-2.5" aria-hidden /> : <X className="size-2.5" aria-hidden />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-300">{c.question}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{c.result}</p>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}

          <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Evidence context
          </h4>
          {hasValidation ? (
            <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px] sm:grid-cols-4">
              {(
                [
                  { k: 'signals', v: fmtNum(v.simulations) },
                  { k: 'overlap', v: fmtNum(v.passed) },
                  { k: 'p-value', v: v.pValue != null ? v.pValue.toFixed(4) : 'not tested' },
                  { k: 'effect', v: v.effectSize != null ? v.effectSize.toFixed(3) : 'not tested' },
                ]
              ).map((s) => (
                <div key={s.k} className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
                  <p className="text-[9px] uppercase tracking-wider text-zinc-500">{s.k}</p>
                  <p className="mt-0.5 tabular-nums text-zinc-300">{s.v}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-zinc-600">Awaiting simulation batch.</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DiscoveryLab({
  hypotheses,
  signals = [],
  breakthroughs = [],
}: {
  hypotheses: Hypothesis[];
  /** Ingest-window signals for the hypothesis dialog lineage view. */
  signals?: Signal[];
  /** Synthesized breakthroughs for the hypothesis dialog output view. */
  breakthroughs?: Breakthrough[];
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [sortByImpact, setSortByImpact] = useState(false);
  const [selected, setSelected] = useState<Hypothesis | null>(null);

  const visible = useMemo(() => {
    const filtered = hypotheses.filter((h) => matchesFilter(h, filter));
    if (sortByImpact) return filtered.slice().sort((a, b) => b.impact - a.impact);
    return filtered;
  }, [hypotheses, filter, sortByImpact]);

  return (
    <Panel
      title="Discovery Lab — Hypotheses"
      icon={FlaskConical}
      ariaLabel="Discovery lab — hypothesis cards"
      actions={
        <>
          <ExportIconButton
            entity="hypotheses"
            format="json"
            label="Export hypotheses as JSON"
          />
          <ExportIconButton
            entity="hypotheses"
            format="csv"
            label="Export hypotheses as CSV"
          />
          <Button
            variant={sortByImpact ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setSortByImpact((s) => !s)}
            aria-pressed={sortByImpact}
            className="h-8 gap-1.5 px-2 text-[11px] text-zinc-400 hover:text-zinc-200 data-[active=true]:text-zinc-100"
          >
            <ArrowDownWideNarrow className="size-3.5" aria-hidden />
            Sort by impact
          </Button>
        </>
      }
      bodyClassName="p-4 pt-3"
    >
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter hypotheses by status">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              'min-h-8 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
              filter === f.key
                ? 'border-violet-500/50 bg-violet-500/15 text-violet-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300',
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto self-center font-mono text-[10px] uppercase tracking-wider text-zinc-600">
          {visible.length} shown
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title={hypotheses.length === 0 ? 'No hypotheses generated yet' : 'No hypotheses match this filter'}
          hint="The discovery layer generates hypotheses from promoted signals each cycle."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {visible.map((h, i) => (
            <motion.div
              key={h.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.3) }}
            >
              <HypothesisCard hypothesis={h} onOpen={setSelected} />
            </motion.div>
          ))}
        </div>
      )}

      <HypothesisDialog
        hypothesis={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        signals={signals}
        breakthroughs={breakthroughs}
        actions={
          selected ? (
            <HypothesisOverrideActions
              hypothesis={selected}
              onClose={() => setSelected(null)}
            />
          ) : null
        }
      />
    </Panel>
  );
}
