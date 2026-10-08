'use client';

/**
 * Escalation watchdog — turns the live feed into an operator attention loop.
 *
 * Fires ONCE per offending entity (Set-guarded, primed on first payload so a
 * page reload never spams):
 *  - SLA BREACH — a pending human-review check older than 10 minutes
 *    (matches the governance panel's rose band). Toasts are HIGH-risk only
 *    (riskScore ≥ 0.6 — same band as the panel's HIGH tier) and globally
 *    throttled to one per 60s: with the pinned 120-deep backlog, breaches
 *    cross the SLA line at ~6/min and would spam the toast stack otherwise.
 *    Every breached review is still marked seen when evaluated — suppressed
 *    (throttled or MED/LOW-risk) reviews never toast later.
 *  - NEW BREAKTHROUGH — any breakthrough that appears in the window (rare;
 *    no throttle needed).
 */

import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { EngineStatePayload } from '@/lib/dashboard-types';

const SLA_BREACH_MS = 10 * 60_000;

// HIGH tier band — mirrors governance-panel.tsx riskTierChip (HIGH ≥ 0.6).
const HIGH_RISK_THRESHOLD = 0.6;

// Global 60s floor between SLA-breach toasts. Anchored on globalThis (cast
// pattern, same as event-log.tsx) so it survives HMR and is shared across all
// hook mounts (single-operator dashboard).
const SLA_TOAST_THROTTLE_MS = 60_000;
type SlaToastGlobal = { __prometheusSlaToastAt?: number };

export function useEscalations(data: EngineStatePayload | undefined) {
  const { toast } = useToast();
  const primedRef = useRef(false);
  const seenSlaRef = useRef<Set<string>>(new Set());
  const seenBreakthroughRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const now = Date.now();

    // First payload after mount: mark everything currently visible as seen.
    if (!primedRef.current) {
      for (const g of data.governance) {
        if (g.humanReview && !g.reviewDecision) seenSlaRef.current.add(g.id);
      }
      for (const b of data.breakthroughs) seenBreakthroughRef.current.add(b.id);
      primedRef.current = true;
      return;
    }

    for (const g of data.governance) {
      if (!g.humanReview || g.reviewDecision || seenSlaRef.current.has(g.id)) continue;
      const ageMs = now - Date.parse(g.createdAt);
      if (ageMs > SLA_BREACH_MS) {
        // Evaluated exactly once per review — mark seen BEFORE the guards so
        // throttled / MED-LOW-risk breaches never toast later either.
        seenSlaRef.current.add(g.id);
        const lastToastAt = (globalThis as SlaToastGlobal).__prometheusSlaToastAt ?? 0;
        const highRisk = g.riskScore >= HIGH_RISK_THRESHOLD;
        const throttleOpen = now - lastToastAt >= SLA_TOAST_THROTTLE_MS;
        if (highRisk && throttleOpen) {
          (globalThis as SlaToastGlobal).__prometheusSlaToastAt = now;
          toast({
            title: 'SLA breach — human review overdue',
            description: `"${g.targetTitle}" has waited ${Math.floor(ageMs / 60000)}m for adjudication.`,
            variant: 'destructive',
          });
        }
      }
    }

    for (const b of data.breakthroughs) {
      if (seenBreakthroughRef.current.has(b.id)) continue;
      seenBreakthroughRef.current.add(b.id);
      toast({
        title: 'New breakthrough synthesized',
        description: `${b.title} — ${b.solutionType} · impact ${b.impactRank.toFixed(2)} · risk ${b.riskScore.toFixed(2)}`,
      });
    }
  }, [data, toast]);
}
