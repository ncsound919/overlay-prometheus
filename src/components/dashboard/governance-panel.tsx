'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bot,
  CheckCircle2,
  History,
  Layers2,
  ListChecks,
  Loader2,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  TimerReset,
  X,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  useEngineControl,
  useGovernanceBacklog,
  useGovernanceBulk,
  useGovernanceDecision,
  type GovernanceBacklog,
} from '@/hooks/use-engine';
import { EmptyState, Panel, fmtScore, timeAgo } from '@/components/dashboard/shared';
import { riskBadgeClass, statusTone } from '@/components/dashboard/meta';
import { AutoTriageControls, AutoTriageSummary } from '@/components/dashboard/auto-triage-control';
import type { AutoTriagePolicy, GovernanceCheck, GovernanceDecision } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

/**
 * Lightweight wall clock for SLA chips — re-renders every 15s so pending-review
 * ages stay fresh between engine-state polls. Local to this file by design.
 */
function useSlaNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Review SLA bands: < 3 min ok (zinc) · 3–10 min warning (amber ⚠) · > 10 min breach (rose, pulses).
function slaFor(iso: string, now: number): { label: string; cls: string; tier: 'ok' | 'warn' | 'breach' } {
  const then = new Date(iso).getTime();
  const minutes = Number.isNaN(then) ? 0 : Math.max(0, (now - then) / 60_000);
  if (minutes > 10) {
    return {
      label: `SLA BREACH ${Math.floor(minutes)}m`,
      cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300 animate-pulse',
      tier: 'breach',
    };
  }
  if (minutes >= 3) {
    return {
      label: `SLA ${Math.floor(minutes)}m ⚠`,
      cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      tier: 'warn',
    };
  }
  return {
    label: `SLA ${Math.floor(minutes)}m`,
    cls: 'border-zinc-700 bg-zinc-800/60 text-zinc-400',
    tier: 'ok',
  };
}

function validationStatusClass(status: string): string {
  const tone = statusTone(status);
  if (tone === 'emerald') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (tone === 'amber') return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  if (tone === 'rose') return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  return 'border-zinc-700 bg-zinc-800/60 text-zinc-400';
}

// Risk tier bands: LOW < 0.35 · MED < 0.6 · HIGH ≥ 0.6
function riskTierChip(risk: number): { label: string; cls: string } {
  if (risk >= 0.6) return { label: 'HIGH', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' };
  if (risk >= 0.35) return { label: 'MED', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' };
  return { label: 'LOW', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' };
}

/** Decision-origin of an auto-released row: 'mid' (tier-2 valve) or 'tier1'. */
function triageOrigin(check: GovernanceCheck): 'mid' | 'tier1' | null {
  const n = check.notes;
  if (typeof n !== 'string' || !n.startsWith('AUTO-TRIAGE')) return null;
  return n.startsWith('AUTO-TRIAGE·MID') ? 'mid' : 'tier1';
}

// ─── Backlog telemetry bar (whole-table truth beyond the payload cap) ────────

type BandKey = 'low' | 'mid' | 'high' | 'crit';
const BANDS: ReadonlyArray<{ key: BandKey; label: string; segCls: string; dotCls: string; tip: string }> = [
  { key: 'low', label: 'low', segCls: 'bg-emerald-500/80', dotCls: 'bg-emerald-400', tip: 'risk ≤ 0.35' },
  { key: 'mid', label: 'med', segCls: 'bg-amber-500/80', dotCls: 'bg-amber-400', tip: '0.35 < risk ≤ 0.6' },
  { key: 'high', label: 'high', segCls: 'bg-rose-500/80', dotCls: 'bg-rose-400', tip: '0.6 < risk ≤ 0.8' },
  { key: 'crit', label: 'crit', segCls: 'bg-rose-600', dotCls: 'bg-rose-500', tip: 'risk > 0.8' },
];

/**
 * Whole-table queue pressure: stacked risk-band bar + oldest-age + breach
 * counters. Falls back to the payload-capped count while loading or on error,
 * with an explicit suffix so the operator always knows which number they see.
 */
function BacklogTelemetry({
  backlog,
  payloadPending,
  midEligibleAged,
}: {
  backlog: GovernanceBacklog | undefined;
  payloadPending: number;
  midEligibleAged?: number;
}) {
  const real = backlog !== undefined;
  const total = real ? backlog.pendingTotal : payloadPending;
  const sum = backlog ? Math.max(1, backlog.bands.low + backlog.bands.mid + backlog.bands.high + backlog.bands.crit) : 1;

  return (
    <div
      className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"
      role="group"
      aria-label={
        real
          ? `Backlog telemetry: ${total} pending reviews whole-table, oldest ${backlog.oldestAgeMin} minutes, ${backlog.breaching} past SLA`
          : `Backlog telemetry loading — payload slice shows ${payloadPending}`
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          queue pressure ·{' '}
          <span className="text-zinc-200">{total}</span> pending
          {!real ? <span className="text-zinc-600"> (payload cap)</span> : null}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {real && backlog.oldestAgeMin > 0 ? (
            <Badge
              variant="outline"
              className={cn(
                'gap-1 px-1.5 py-0 font-mono text-[10px] tabular-nums',
                backlog.oldestAgeMin > 10
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-400',
              )}
              title="Age of the oldest pending review (whole table)"
            >
              <History className="size-3" aria-hidden /> oldest {backlog.oldestAgeMin}m
            </Badge>
          ) : null}
          {real && backlog.breaching > 0 ? (
            <Badge
              variant="outline"
              className="gap-1 border-rose-500/40 bg-rose-500/10 px-1.5 py-0 font-mono text-[10px] tabular-nums text-rose-300"
              title="Pending reviews older than the 10-minute SLA breach mark"
            >
              <TimerReset className="size-3" aria-hidden /> {backlog.breaching} breach
            </Badge>
          ) : null}
          {typeof midEligibleAged === 'number' && midEligibleAged > 0 ? (
            <Badge
              variant="outline"
              className="gap-1 border-violet-500/40 bg-violet-500/10 px-1.5 py-0 font-mono text-[10px] tabular-nums text-violet-300"
              title="Mid-band reviews (above the tier-1 ceiling, ≤ mid ceiling) past the mid age threshold — newest-120 slice. The tier-2 valve releases these automatically when enabled."
            >
              <Layers2 className="size-3" aria-hidden /> {midEligibleAged} mid-eligible
            </Badge>
          ) : null}
        </span>
      </div>

      {/* Stacked risk-band bar — segments mirror the row tier chips. */}
      {backlog ? (
        <div
          className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-900"
          aria-hidden
        >
          {BANDS.map((b) => {
            const n = backlog.bands[b.key];
            if (n <= 0) return null;
            return (
              <div
                key={b.key}
                className={cn('h-full transition-[width] duration-500', b.segCls)}
                style={{ width: `${(n / sum) * 100}%` }}
                title={`${b.label}: ${n}`}
              />
            );
          })}
        </div>
      ) : (
        <div className="mt-2 h-1.5 w-full animate-pulse rounded-full bg-zinc-800/80" aria-hidden />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {backlog
          ? BANDS.map((b) => (
              <span
                key={b.key}
                className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-zinc-500"
                title={b.tip}
              >
                <span className={cn('size-1.5 rounded-full', b.dotCls)} aria-hidden />
                {b.label} <span className="tabular-nums text-zinc-300">{backlog.bands[b.key]}</span>
              </span>
            ))
          : (
            <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">
              whole-table histogram loading…
            </span>
          )}
        {real ? (
          <span className="ml-auto font-mono text-[9px] uppercase tracking-wider text-zinc-600" title="The review list below renders the newest 120 rows (payload cap) — decisions apply to whole-table selections too">
            list shows newest 120
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─── Review sort modes ───────────────────────────────────────────────────────

type SortMode = 'sla' | 'new' | 'risk';
const SORTS: ReadonlyArray<{ key: SortMode; label: string; tip: string }> = [
  { key: 'sla', label: 'oldest · sla', tip: 'Pending first, oldest submissions on top — clear SLA debt before it breaches' },
  { key: 'new', label: 'newest', tip: 'Pending first, newest submissions on top' },
  { key: 'risk', label: 'risk ↓', tip: 'Pending first, highest risk on top' },
];

// ─── Row ─────────────────────────────────────────────────────────────────────

function GovernanceRow({
  check,
  now,
  selected,
  onToggle,
}: {
  check: GovernanceCheck;
  now: number;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const { toast } = useToast();
  const decision = useGovernanceDecision();
  const pendingDecision = decision.isPending ? decision.variables?.decision : undefined;
  const decided = check.reviewDecision === 'approved' || check.reviewDecision === 'rejected';
  const pendingReview = check.humanReview && !decided;
  const sla = slaFor(check.createdAt, now);

  const review = (next: GovernanceDecision) => {
    decision.mutate(
      { check, decision: next },
      {
        onSuccess: () =>
          toast({
            title: next === 'approved' ? 'Review approved' : 'Review rejected',
            description: `"${check.targetTitle}" → ${next}.`,
          }),
        onError: (err) =>
          toast({ title: 'Review failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'rounded-xl border p-4 transition-[border-color,box-shadow] duration-300',
        selected
          ? 'border-emerald-500/50 bg-emerald-500/[0.05] shadow-[0_0_20px_-8px_rgba(16,185,129,0.45)]'
          : pendingReview
            ? 'border-amber-500/40 bg-amber-500/[0.04] shadow-[0_0_20px_-8px_rgba(245,158,11,0.4)]'
            : 'border-zinc-800 bg-zinc-900/70 hover:border-zinc-600',
        // SLA pressure: amber left border while in warning, rose on breach
        // (suppressed on selected rows — the emerald selection ring wins).
        !selected && pendingReview && sla.tier === 'warn' && 'border-l-2 border-l-amber-500/70',
        !selected && pendingReview && sla.tier === 'breach' && 'border-l-2 border-l-rose-500/70',
      )}
    >
      <div className="flex items-start gap-3">
        {pendingReview ? (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(check.id)}
            aria-label={selected ? `Deselect review ${check.targetTitle}` : `Select review ${check.targetTitle}`}
            className="mt-1 shrink-0 data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-amber-400">
                {check.humanReview ? (
                  <ShieldAlert className="size-4" aria-hidden />
                ) : (
                  <Scale className="size-4" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-100">
                  {check.targetTitle || `${check.targetType} ${check.targetId.slice(0, 10)}`}
                </p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {check.targetType} · CYC {String(check.cycle).padStart(3, '0')} ·{' '}
                  <time dateTime={check.createdAt}>{timeAgo(check.createdAt)}</time>
                  {decided && triageOrigin(check) ? (
                    <span
                      className={cn(
                        'ml-1.5 rounded border px-1 py-0',
                        triageOrigin(check) === 'mid'
                          ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                          : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
                      )}
                      title={
                        triageOrigin(check) === 'mid'
                          ? 'Released by the standing mid-risk valve (tier 2)'
                          : 'Released by the standing auto-triage policy (tier 1)'
                      }
                    >
                      {triageOrigin(check) === 'mid' ? 'AUTO·MID' : 'AUTO'}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              <Badge
                variant="outline"
                className={cn('px-1.5 py-0 font-mono text-[10px]', riskBadgeClass(check.riskScore))}
              >
                risk {fmtScore(check.riskScore, 2)}
              </Badge>
              <Badge
                variant="outline"
                className={cn('px-1.5 py-0 font-mono text-[10px] uppercase', riskTierChip(check.riskScore).cls)}
                aria-label={`Risk tier ${riskTierChip(check.riskScore).label}`}
              >
                {riskTierChip(check.riskScore).label}
              </Badge>
              <Badge
                variant="outline"
                className={cn('px-1.5 py-0 font-mono text-[10px] uppercase', validationStatusClass(check.validationStatus))}
              >
                {check.validationStatus}
              </Badge>
              {check.humanReview ? (
                <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 px-1.5 py-0 font-mono text-[10px] uppercase text-amber-300">
                  review pending
                </Badge>
              ) : null}
              {pendingReview ? (
                <Badge
                  variant="outline"
                  className={cn('px-1.5 py-0 font-mono text-[10px] uppercase tabular-nums', sla.cls)}
                  aria-label={`Pending review age ${sla.label}`}
                >
                  {sla.label}
                </Badge>
              ) : null}
            </div>
          </div>

          {check.ethicalFlags.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1">
              {check.ethicalFlags.map((flag) => (
                <span
                  key={flag}
                  className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-rose-400"
                >
                  ⚑ {flag}
                </span>
              ))}
            </div>
          ) : null}

          {check.notes ? (
            <p className="mt-2.5 text-xs leading-relaxed text-zinc-400">{check.notes}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {decided ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider',
                  check.reviewDecision === 'approved' ? 'text-emerald-400' : 'text-rose-400',
                )}
              >
                {check.reviewDecision === 'approved' ? (
                  <CheckCircle2 className="size-3.5" aria-hidden />
                ) : (
                  <XCircle className="size-3.5" aria-hidden />
                )}
                decision: {check.reviewDecision}
              </span>
            ) : (
              <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-600">
                awaiting decision
              </span>
            )}

            {check.humanReview && !decided ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => review('approved')}
                  disabled={decision.isPending}
                  aria-label={`Approve ${check.targetTitle}`}
                  className="h-9 gap-1.5 bg-emerald-600/90 text-white hover:bg-emerald-600"
                >
                  {pendingDecision === 'approved' ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ThumbsUp className="size-4" aria-hidden />
                  )}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => review('rejected')}
                  disabled={decision.isPending}
                  aria-label={`Reject ${check.targetTitle}`}
                  className="h-9 gap-1.5 border-rose-900/60 text-rose-400 hover:bg-rose-950/30 hover:text-rose-300"
                >
                  {pendingDecision === 'rejected' ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ThumbsDown className="size-4" aria-hidden />
                  )}
                  Reject
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

const BULK_MAX_RISK = 0.5;
/** API hard cap per explicit-id batch (mirrors IDS_CAP server-side). */
const IDS_CAP = 100;

export function GovernancePanel({
  governance,
  policy,
}: {
  governance: GovernanceCheck[];
  policy: AutoTriagePolicy;
}) {
  const { toast } = useToast();
  const bulk = useGovernanceBulk();
  const control = useEngineControl();
  const backlogQuery = useGovernanceBacklog();
  const now = useSlaNow();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortMode>('sla');
  const [confirmDec, setConfirmDec] = useState<GovernanceDecision | null>(null);
  const [bulkNote, setBulkNote] = useState('');

  const pending = useMemo(() => governance.filter((g) => g.humanReview), [governance]);
  const eligible = useMemo(
    () => pending.filter((g) => !g.reviewDecision && g.riskScore <= BULK_MAX_RISK),
    [pending],
  );
  // Auto-triage eligibility mirrors the engine's WHERE clause: undecided,
  // riskScore ≤ policy.maxRisk, aged past policy.afterMinutes.
  const triageEligible = useMemo(
    () => pending.filter((g) => !g.reviewDecision && g.riskScore <= policy.maxRisk),
    [pending, policy.maxRisk],
  );
  const triageAged = useMemo(
    () =>
      triageEligible.filter(
        (g) => now - new Date(g.createdAt).getTime() >= policy.afterMinutes * 60_000,
      ),
    [triageEligible, now, policy.afterMinutes],
  );
  // Tier-2 mid band: strictly ABOVE the tier-1 ceiling, ≤ mid ceiling (mirrors
  // the engine's tier-2 WHERE clause) — the band tier 1 can never drain.
  const midEligible = useMemo(
    () =>
      pending.filter(
        (g) => !g.reviewDecision && g.riskScore > policy.maxRisk && g.riskScore <= policy.midRisk.maxRisk,
      ),
    [pending, policy.maxRisk, policy.midRisk.maxRisk],
  );
  const midEligibleAged = useMemo(
    () =>
      midEligible.filter(
        (g) => now - new Date(g.createdAt).getTime() >= policy.midRisk.afterMinutes * 60_000,
      ),
    [midEligible, now, policy.midRisk.afterMinutes],
  );

  const ordered = useMemo(() => {
    return governance
      .slice()
      .sort((a, b) => {
        // Pending block always floats to the top…
        const p = Number(b.humanReview) - Number(a.humanReview);
        if (p !== 0) return p;
        if (a.humanReview && b.humanReview) {
          if (sort === 'sla') return +new Date(a.createdAt) - +new Date(b.createdAt);
          if (sort === 'new') return +new Date(b.createdAt) - +new Date(a.createdAt);
          return b.riskScore - a.riskScore;
        }
        // …decided history trails, newest first.
        return +new Date(b.createdAt) - +new Date(a.createdAt);
      });
  }, [governance, sort]);

  // Selection can only reference rows that are still pending — prune drift
  // (rows decided elsewhere / payload rotation). Render-phase derivation,
  // same pattern as the footer's telemetry sampling — avoids effect churn.
  const pendingIds = useMemo(() => new Set(pending.map((p) => p.id)), [pending]);
  const [prevPendingIds, setPrevPendingIds] = useState<Set<string> | null>(null);
  if (pendingIds !== prevPendingIds) {
    setPrevPendingIds(pendingIds);
    if (selected.size > 0) {
      const next = new Set([...selected].filter((id) => pendingIds.has(id)));
      if (next.size !== selected.size) setSelected(next);
    }
  }

  const selectableIds = useMemo(
    // Oldest-first cap: the API accepts ≤ 100 ids per batch.
    () => pending.slice(0, IDS_CAP).map((p) => p.id),
    [pending],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      if (selectableIds.every((id) => prev.has(id))) {
        const next = new Set(prev);
        for (const id of selectableIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...selectableIds]);
    });

  // Risk-band histogram over the current selection (for the action bar + dialog).
  const selBands = useMemo(() => {
    const b = { low: 0, mid: 0, high: 0, crit: 0 };
    for (const g of pending) {
      if (!selected.has(g.id)) continue;
      if (g.riskScore <= 0.35) b.low++;
      else if (g.riskScore <= 0.6) b.mid++;
      else if (g.riskScore <= 0.8) b.high++;
      else b.crit++;
    }
    return b;
  }, [pending, selected]);

  const savePolicy = (patch: { autoTriage: Partial<AutoTriagePolicy> }) => {
    control.mutate(
      { action: 'config', config: patch },
      {
        onSuccess: () =>
          toast({ title: 'Auto-triage policy saved', description: 'Applied to the next governance pass.' }),
        onError: (err) =>
          toast({ title: 'Policy update failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  const runThresholdBulk = () => {
    bulk.mutate(
      { decision: 'approved', maxRisk: BULK_MAX_RISK },
      {
        onSuccess: (res) =>
          toast({
            title: 'Bulk review complete',
            description: `${res.updated} low-risk review${res.updated === 1 ? '' : 's'} approved — artifacts deployed.`,
          }),
        onError: (err) =>
          toast({ title: 'Bulk review failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  const runSelectionBulk = (decision: GovernanceDecision) => {
    const ids = [...selected].slice(0, IDS_CAP);
    bulk.mutate(
      { decision, ids, note: bulkNote.trim() || undefined },
      {
        onSuccess: (res) => {
          toast({
            title: `Bulk ${decision}`,
            description: `${res.updated} selected review${res.updated === 1 ? '' : 's'} ${decision} — artifacts ${decision === 'approved' ? 'deployed' : 'blocked'}.`,
          });
          setSelected(new Set());
          setBulkNote('');
          setConfirmDec(null);
        },
        onError: (err) => {
          toast({ title: 'Bulk review failed', description: err.message, variant: 'destructive' });
          setConfirmDec(null);
        },
      },
    );
  };

  return (
    <Panel
      title="Governance — Reviews"
      icon={Scale}
      ariaLabel="Governance reviews"
      actions={
        <>
          <span
            className="font-mono text-[10px] uppercase tracking-wider text-amber-400"
            title={
              backlogQuery.data
                ? `Whole-table pending: ${backlogQuery.data.pendingTotal} — the list below shows the newest ${governance.length} rows`
                : undefined
            }
          >
            {backlogQuery.data ? backlogQuery.data.pendingTotal : pending.length} pending review
            {(backlogQuery.data ? backlogQuery.data.pendingTotal : pending.length) === 1 ? '' : 's'}
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                aria-label="Configure the standing auto-triage policy"
                title="Standing auto-triage policy"
                className="h-8 max-sm:h-11 gap-1.5 border-zinc-700 px-2 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <Bot className="size-3.5 text-amber-400" aria-hidden />
                <AutoTriageSummary policy={policy} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] border-zinc-800 bg-zinc-900 text-zinc-100">
              <AutoTriageControls
                policy={policy}
                saving={control.isPending}
                onSave={savePolicy}
                eligible={triageEligible.length}
                eligibleAged={triageAged.length}
                midEligible={midEligible.length}
                midEligibleAged={midEligibleAged.length}
              />
            </PopoverContent>
          </Popover>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={eligible.length === 0 || bulk.isPending}
                aria-label={
                  eligible.length === 0
                    ? 'No low-risk pending reviews to bulk approve'
                    : `Bulk approve ${eligible.length} pending review${eligible.length === 1 ? '' : 's'} with risk ≤ ${BULK_MAX_RISK}`
                }
                title={
                  eligible.length === 0
                    ? 'No pending reviews with risk ≤ 0.5'
                    : `Approve all ${eligible.length} pending review${eligible.length === 1 ? '' : 's'} with risk ≤ ${BULK_MAX_RISK}`
                }
                className="h-8 max-sm:h-11 gap-1.5 border-emerald-900/60 px-2 text-[11px] text-emerald-400 hover:bg-emerald-950/30 hover:text-emerald-300"
              >
                {bulk.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <ShieldCheck className="size-3.5" aria-hidden />
                )}
                Approve low-risk (≤{BULK_MAX_RISK})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
              <AlertDialogHeader>
                <AlertDialogTitle>Approve {eligible.length} low-risk review{eligible.length === 1 ? '' : 's'}?</AlertDialogTitle>
                <AlertDialogDescription className="text-zinc-400">
                  All pending human reviews with riskScore ≤ {BULK_MAX_RISK} will be approved and their
                  breakthroughs transitioned to deployed. High-risk (≥ 0.6) and medium-risk artifacts are
                  left untouched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={runThresholdBulk}
                  className="bg-emerald-700 text-white hover:bg-emerald-600"
                >
                  Approve {eligible.length}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      }
      bodyClassName="p-4 pt-3"
    >
      <BacklogTelemetry
        backlog={backlogQuery.data}
        payloadPending={pending.length}
        midEligibleAged={midEligibleAged.length}
      />

      {ordered.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            icon={Scale}
            title="No governance checks yet"
            hint="High-risk artifacts are routed here automatically by Layer 7."
          />
        </div>
      ) : (
        <>
          {/* Toolbar — sort + select-all. */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div
              role="group"
              aria-label="Sort reviews"
              className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5"
            >
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={sort === s.key}
                  title={s.tip}
                  onClick={() => setSort(s.key)}
                  className={cn(
                    'h-7 rounded-md px-2 font-mono text-[10px] uppercase tracking-wider transition-colors max-sm:h-9',
                    sort === s.key
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {pending.length > 0 ? (
              <label
                className={cn(
                  'flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[11px] transition-colors max-sm:h-11',
                  allSelected || someSelected
                    ? 'border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-300'
                    : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
                )}
              >
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                  aria-label={
                    allSelected
                      ? `Deselect all ${selected.size} selected pending reviews`
                      : `Select the ${selectableIds.length} oldest pending reviews for bulk action`
                  }
                  className="data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white"
                />
                <ListChecks className="size-3.5" aria-hidden />
                <span className="font-mono uppercase tracking-wider">
                  {allSelected
                    ? `all ${selected.size} selected`
                    : someSelected
                      ? `${selected.size} selected`
                      : `select pending (${Math.min(pending.length, IDS_CAP)})`}
                </span>
              </label>
            ) : null}
          </div>

          <div className="mt-3 flex flex-col gap-3 pb-1">
            {ordered.map((g) => (
              <GovernanceRow
                key={g.id}
                check={g}
                now={now}
                selected={selected.has(g.id)}
                onToggle={toggle}
              />
            ))}
          </div>

          {/* Floating selection action bar. */}
          <AnimatePresence>
            {selected.size > 0 ? (
              <motion.div
                initial={{ y: 18, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 18, opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="sticky bottom-2 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/30 bg-zinc-900/95 p-2.5 shadow-[0_10px_36px_-14px_rgba(16,185,129,0.5)] backdrop-blur"
                role="toolbar"
                aria-label={`Bulk actions for ${selected.size} selected reviews`}
              >
                <span className="flex items-center gap-2 pl-1 font-mono text-[11px] uppercase tracking-wider text-emerald-300">
                  <ListChecks className="size-4" aria-hidden />
                  {selected.size} selected
                </span>
                <span
                  className="font-mono text-[10px] tabular-nums text-zinc-500"
                  title="Risk-band composition of the selection"
                >
                  L{selBands.low} · M{selBands.mid} · H{selBands.high} · C{selBands.crit}
                </span>
                {selected.size > IDS_CAP ? (
                  <span className="font-mono text-[10px] text-amber-400" title="Batch cap — excess rows stay pending">
                    batch cap {IDS_CAP}
                  </span>
                ) : null}
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={bulk.isPending}
                    onClick={() => setConfirmDec('approved')}
                    className="h-8 max-sm:h-11 gap-1.5 bg-emerald-600/90 text-white hover:bg-emerald-600"
                  >
                    <ThumbsUp className="size-3.5" aria-hidden /> Approve selected
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulk.isPending}
                    onClick={() => setConfirmDec('rejected')}
                    className="h-8 max-sm:h-11 gap-1.5 border-rose-900/60 text-rose-400 hover:bg-rose-950/30 hover:text-rose-300"
                  >
                    <ThumbsDown className="size-3.5" aria-hidden /> Reject selected
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={bulk.isPending}
                    onClick={() => setSelected(new Set())}
                    aria-label="Clear selection"
                    className="h-8 max-sm:h-11 gap-1 text-zinc-500 hover:text-zinc-200"
                  >
                    <X className="size-3.5" aria-hidden /> Clear
                  </Button>
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      )}

      {/* Selection confirm dialog (approve / reject shared). */}
      <AlertDialog open={confirmDec !== null} onOpenChange={(o) => !o && setConfirmDec(null)}>
        <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="capitalize">
              {confirmDec} {selected.size} selected review{selected.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              {confirmDec === 'approved'
                ? 'Selected breakthroughs transition to deployed immediately.'
                : 'Selected breakthroughs transition to blocked — the synthesis is rejected.'}{' '}
              Risk mix: <span className="font-mono tabular-nums">
                {selBands.low} low · {selBands.mid} med · {selBands.high} high · {selBands.crit} crit
              </span>
              {selected.size > IDS_CAP ? ` Only the oldest ${IDS_CAP} apply per batch (API cap).` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={bulkNote}
            onChange={(e) => setBulkNote(e.target.value)}
            maxLength={240}
            placeholder="Optional reason — stamped on each reviewed row…"
            aria-label="Bulk decision reason"
            className="h-9 border-zinc-700 bg-zinc-950 text-xs text-zinc-200 placeholder:text-zinc-600"
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDec && runSelectionBulk(confirmDec)}
              className={cn(
                confirmDec === 'approved'
                  ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                  : 'bg-rose-800 text-white hover:bg-rose-700',
              )}
            >
              {bulk.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              <span className="capitalize">{confirmDec} {Math.min(selected.size, IDS_CAP)}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
