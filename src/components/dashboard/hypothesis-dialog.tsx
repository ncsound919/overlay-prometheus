'use client';

/**
 * Rich hypothesis detail dialog for the Discovery Lab.
 * Snapshot semantics: the selected hypothesis object is passed in from the lab
 * and re-rendered as-is (polling keeps the underlying list fresh).
 * Human override actions (force-promote / veto) are injected via `actions`.
 */

import { useMemo, type ReactNode } from 'react';
import { CheckCircle2, FlaskConical, Route, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Meter, fmtNum, fmtScore, timeAgo } from '@/components/dashboard/shared';
import { hypothesisStatusClass, solutionMeta } from '@/components/dashboard/meta';
import type { Breakthrough, Hypothesis, Signal } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

function generatorBadgeClass(generator: string): string {
  return generator === 'llm'
    ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
    : 'border-zinc-700 bg-zinc-800/60 text-zinc-400';
}

export function HypothesisDialog({
  hypothesis,
  open,
  onOpenChange,
  actions,
  signals = [],
  breakthroughs = [],
}: {
  hypothesis: Hypothesis | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Human override action row (rendered above the kernel footer). */
  actions?: ReactNode;
  /** Ingest-window signals — matched against sourceSignals for the lineage view. */
  signals?: Signal[];
  /** Synthesized breakthroughs — matched by hypothesisId for the output view. */
  breakthroughs?: Breakthrough[];
}) {
  const citedSignals = useMemo(() => {
    if (!hypothesis) return [];
    return hypothesis.sourceSignals.map((title, i) => ({
      title,
      index: i,
      match: signals.find((s) => s.title === title),
    }));
  }, [hypothesis, signals]);

  const produced = useMemo(
    () => (hypothesis ? breakthroughs.find((b) => b.hypothesisId === hypothesis.id) : undefined),
    [hypothesis, breakthroughs],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {hypothesis ? (
        <DialogContent className="mc-scroll max-h-[85dvh] gap-4 overflow-y-auto border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-lg">
          <DialogHeader className="gap-2 text-left">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn(
                  'px-1.5 py-0 font-mono text-[10px] uppercase',
                  hypothesisStatusClass(hypothesis.status),
                )}
              >
                {hypothesis.status}
              </Badge>
              <Badge
                variant="outline"
                className={cn('px-1.5 py-0 font-mono text-[10px] uppercase', generatorBadgeClass(hypothesis.generator))}
              >
                {hypothesis.generator}
              </Badge>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                CYC {String(hypothesis.cycle).padStart(3, '0')} · {timeAgo(hypothesis.createdAt)}
              </span>
            </div>
            <DialogTitle className="pr-6 text-base font-semibold leading-snug text-zinc-100">
              {hypothesis.title}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-zinc-400">
              {hypothesis.summary}
            </DialogDescription>
          </DialogHeader>

          {/* Score meters */}
          <div className="flex flex-col gap-2" aria-label="Hypothesis score meters">
            {(
              [
                { label: 'novelty', value: hypothesis.novelty, tone: 'violet' as const },
                { label: 'impact', value: hypothesis.impact, tone: 'emerald' as const },
                { label: 'confidence', value: hypothesis.confidence, tone: 'teal' as const },
              ]
            ).map((m) => (
              <div key={m.label} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
                  {m.label}
                </span>
                <Meter value={m.value} tone={m.tone} className="flex-1" />
                <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-200">
                  {fmtScore(m.value, 2)}
                </span>
              </div>
            ))}
          </div>

          {/* Domain chips */}
          <div className="flex flex-wrap gap-1.5" aria-label="Domains">
            {hypothesis.domains.map((d) => (
              <span
                key={d}
                className="rounded bg-zinc-800/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300"
              >
                {d}
              </span>
            ))}
          </div>

          {/* Signal lineage — the Layer-2 evidence base cited by the discovery layer */}
          <section aria-label="Signal lineage" className="flex flex-col gap-2">
            <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              <Route className="size-3 text-violet-400" aria-hidden />
              Signal lineage
              <span className="font-mono tracking-normal text-zinc-600">· {citedSignals.length} cited</span>
            </h4>
            {citedSignals.length === 0 ? (
              <p className="rounded-md border border-dashed border-zinc-800 px-3 py-2 text-xs text-zinc-600">
                No source signals cited — template output without a discovery context.
              </p>
            ) : (
              <ol className="relative flex flex-col gap-1.5 border-l border-zinc-800 pl-3">
                {citedSignals.map(({ title, index, match }) => (
                  <li
                    key={`${title}-${index}`}
                    className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/50 px-2.5 py-2"
                  >
                    <span
                      className="font-mono text-[10px] tabular-nums text-zinc-600"
                      aria-label={`Citation ${index + 1}`}
                    >
                      #{index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-zinc-300" title={title}>
                        {title}
                      </p>
                      {match ? (
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] tabular-nums text-zinc-500">
                          <span className="truncate">{match.streamName}</span>
                          <span>
                            A <span className={match.anomalyScore >= 0.75 ? 'text-rose-400' : 'text-zinc-400'}>{fmtScore(match.anomalyScore)}</span>
                          </span>
                          <span>N {fmtScore(match.noveltyScore)}</span>
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[10px] italic text-zinc-600">
                          cited source rotated out of the ingest window
                        </p>
                      )}
                    </div>
                    {match?.features?.sourceOp === 1 ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-violet-500/40 bg-violet-500/10 px-1.5 py-0 font-mono text-[9px] uppercase text-violet-300"
                      >
                        operator
                      </Badge>
                    ) : match ? (
                      <span className="shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                        {match.category}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Validation run */}
          <section aria-label="Validation run" className="flex flex-col gap-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Validation run
            </h4>
            {hypothesis.validation && hypothesis.validation.simulations > 0 ? (
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] sm:grid-cols-5">
                {(
                  [
                    { k: 'signals', v: fmtNum(hypothesis.validation.simulations), cls: 'text-zinc-300' },
                    { k: 'overlap', v: fmtNum(hypothesis.validation.passed), cls: 'text-zinc-300' },
                    { k: 'non-overlap', v: fmtNum(hypothesis.validation.failed), cls: 'text-zinc-300' },
                    {
                      k: 'p-value',
                      v:
                        hypothesis.validation.pValue != null
                          ? hypothesis.validation.pValue.toFixed(4)
                          : 'not tested',
                      cls: 'text-zinc-300',
                    },
                    {
                      k: 'effect',
                      v:
                        hypothesis.validation.effectSize != null
                          ? hypothesis.validation.effectSize.toFixed(3)
                          : 'not tested',
                      cls: 'text-zinc-300',
                    },
                  ] as Array<{ k: string; v: string; cls: string }>
                ).map((s) => (
                  <div key={s.k} className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
                    <p className="text-[9px] uppercase tracking-wider text-zinc-500">{s.k}</p>
                    <p className={cn('mt-0.5 tabular-nums', s.cls)}>{s.v}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-zinc-800 px-3 py-2 text-xs text-zinc-600">
                Awaiting simulation batch — no validation statistics yet.
              </p>
            )}
          </section>

          {/* Counterfactual probes */}
          <section aria-label="Counterfactual probes" className="flex flex-col gap-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Counterfactual probes
            </h4>
            {hypothesis.counterfactuals.length === 0 ? (
              <p className="rounded-md border border-dashed border-zinc-800 px-3 py-2 text-xs text-zinc-600">
                No counterfactual probes recorded.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {hypothesis.counterfactuals.map((c, i) => (
                  <li
                    key={`${c.question}-${i}`}
                    className="flex items-start gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/50 px-2.5 py-2"
                  >
                    {c.supports ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-label="Supports hypothesis" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-rose-400" aria-label="Refutes hypothesis" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-300">{c.question}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{c.result}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Synthesis output — Layer 5 result derived from this hypothesis */}
          <section aria-label="Synthesis output" className="flex flex-col gap-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Synthesis output
            </h4>
            {produced ? (() => {
              const Icon = solutionMeta(produced.solutionType).icon;
              return (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-emerald-400" aria-hidden />
                    <p className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100">
                      {produced.title}
                    </p>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 font-mono text-[9px] uppercase text-emerald-300"
                    >
                      {produced.status}
                    </Badge>
                  </div>
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    {solutionMeta(produced.solutionType).label} · impact{' '}
                    <span className="text-emerald-300">{fmtScore(produced.impactRank)}</span> · risk{' '}
                    <span className={produced.riskScore >= 0.6 ? 'text-rose-400' : 'text-zinc-400'}>
                      {fmtScore(produced.riskScore)}
                    </span>
                  </p>
                </div>
              );
            })() : hypothesis.status === 'rejected' ? (
              <p className="rounded-md border border-dashed border-rose-900/60 px-3 py-2 text-xs text-rose-400/80">
                Vetoed during validation — no synthesis will follow.
              </p>
            ) : (
              <p className="rounded-md border border-dashed border-zinc-800 px-3 py-2 text-xs text-zinc-600">
                Not yet synthesized — awaiting Layer 5 breakthrough synthesis.
              </p>
            )}
          </section>

          {/* Human intelligence override actions (if provided) */}
          {actions ? <section aria-label="Human override actions">{actions}</section> : null}

          {/* Kernel footer */}
          <p className="flex items-center gap-1.5 border-t border-zinc-800/80 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
            <FlaskConical className="size-3" aria-hidden />
            Discovery Cycle #{String(hypothesis.cycle).padStart(3, '0')} · PROMETHEUS Kernel
          </p>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
