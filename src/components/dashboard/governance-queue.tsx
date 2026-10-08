'use client';

import { Scale, UserCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Panel, StatusDot, fmtScore, timeAgo } from '@/components/dashboard/shared';
import { riskBadgeClass, statusTone } from '@/components/dashboard/meta';
import type { GovernanceCheck } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

/** Right rail — governance queue mini list with pending human-review count. */
export function GovernanceQueue({ governance }: { governance: GovernanceCheck[] }) {
  const pending = governance.filter((g) => g.humanReview);
  const queue = (pending.length > 0 ? pending : governance).slice(0, 4);

  return (
    <Panel
      title="Governance Queue"
      icon={Scale}
      ariaLabel="Governance queue"
      actions={
        <Badge
          variant="outline"
          className={
            pending.length > 0
              ? 'border-amber-500/40 bg-amber-500/10 px-1.5 py-0 font-mono text-[10px] text-amber-300'
              : 'border-zinc-700 px-1.5 py-0 font-mono text-[10px] text-zinc-500'
          }
        >
          {pending.length} review{pending.length === 1 ? '' : 's'} pending
        </Badge>
      }
    >
      {queue.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="Queue clear"
          hint="Governance checks will surface here as the engine promotes candidates."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {queue.map((check) => (
            <li
              key={check.id}
              className={
                check.humanReview
                  ? 'rounded-lg border border-amber-500/30 bg-amber-500/[0.04] px-3 py-2 transition-colors hover:border-amber-500/50'
                  : 'rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 transition-colors hover:border-zinc-700'
              }
            >
              <div className="flex items-center gap-2">
                {check.humanReview ? (
                  <UserCheck className="size-3.5 shrink-0 text-amber-400" aria-label="Human review pending" />
                ) : (
                  <StatusDot tone={statusTone(check.validationStatus)} />
                )}
                <p className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">
                  {check.targetTitle || `${check.targetType} ${check.targetId.slice(0, 8)}`}
                </p>
                <Badge
                  variant="outline"
                  className={cn('shrink-0 px-1.5 py-0 font-mono text-[10px]', riskBadgeClass(check.riskScore))}
                >
                  {fmtScore(check.riskScore, 2)}
                </Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {check.ethicalFlags.slice(0, 2).map((flag) => (
                  <span
                    key={flag}
                    className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rose-400"
                  >
                    {flag}
                  </span>
                ))}
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">
                  {check.validationStatus} · <time dateTime={check.createdAt}>{timeAgo(check.createdAt)}</time>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
