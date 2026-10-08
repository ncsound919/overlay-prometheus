'use client';

/**
 * TanStack Query hooks for the PROMETHEUS mission-control dashboard.
 * All requests use RELATIVE paths only. State polls every 4s while the tab is focused.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFeedStore } from '@/lib/feed-store';
import type {
  Breakthrough,
  ControlAction,
  ControlResponse,
  EngineConfigPatch,
  EngineStatePayload,
  GovernanceCheck,
  GovernanceDecision,
  Hypothesis,
  MutationOkResponse,
} from '@/lib/dashboard-types';

export const ENGINE_STATE_KEY = ['engine-state'] as const;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Surface the server's { error } message when provided (409/400 paths).
    let detail = '';
    try {
      const parsed = (await res.json()) as { error?: unknown };
      if (typeof parsed?.error === 'string') detail = parsed.error;
    } catch {
      // non-JSON error body — fall through to the generic message
    }
    throw new Error(detail || `POST ${url} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

async function fetchEngineState(): Promise<EngineStatePayload> {
  const res = await fetch('/api/engine/state');
  if (!res.ok) throw new Error(`Engine state unavailable (${res.status})`);
  return (await res.json()) as EngineStatePayload;
}

/**
 * Live engine snapshot. Primary transport is the WebSocket feed
 * (LiveFeedBridge writes pushes straight into this cache); HTTP polling is
 * the fallback — 4s while the feed is down, 20s safety net while it is live.
 */
export function useEngineState() {
  return useQuery<EngineStatePayload, Error>({
    queryKey: ENGINE_STATE_KEY,
    queryFn: fetchEngineState,
    refetchInterval: () => (useFeedStore.getState().status === 'live' ? 20000 : 4000),
    refetchIntervalInBackground: false,
    staleTime: 2000,
    retry: 1,
  });
}

export interface EngineControlInput {
  action: ControlAction;
  config?: EngineConfigPatch;
}

/** start | pause | tick | reset (+ optional config patch). */
export function useEngineControl() {
  const queryClient = useQueryClient();
  return useMutation<ControlResponse, Error, EngineControlInput>({
    mutationFn: (input) => postJson<ControlResponse>('/api/engine/control', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ENGINE_STATE_KEY });
    },
  });
}

export interface GovernanceDecisionInput {
  check: GovernanceCheck;
  decision: GovernanceDecision;
}

/** Approve / reject a pending governance review. */
export function useGovernanceDecision() {
  const queryClient = useQueryClient();
  return useMutation<MutationOkResponse, Error, GovernanceDecisionInput>({
    mutationFn: ({ check, decision }) =>
      postJson<MutationOkResponse>(`/api/governance/${check.id}`, { decision }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ENGINE_STATE_KEY });
    },
  });
}

export interface BreakthroughActionInput {
  breakthrough: Breakthrough;
  action: 'deploy' | 'block';
}

/** Deploy / block a synthesized breakthrough. */
export function useBreakthroughAction() {
  const queryClient = useQueryClient();
  return useMutation<MutationOkResponse, Error, BreakthroughActionInput>({
    mutationFn: ({ breakthrough, action }) =>
      postJson<MutationOkResponse>(`/api/breakthroughs/${breakthrough.id}`, { action }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ENGINE_STATE_KEY });
    },
  });
}

// ─── Human intelligence override (Layer 4) ──────────────────────────────────

export type HypothesisOverrideAction = 'promote' | 'veto';

export interface HypothesisOverrideInput {
  hypothesis: Hypothesis;
  action: HypothesisOverrideAction;
}

export interface HypothesisOverrideResponse {
  ok: boolean;
  breakthroughId?: string;
}

/** Force-promote / veto a hypothesis via POST /api/hypotheses/[id]. */
export function useHypothesisOverride() {
  const queryClient = useQueryClient();
  return useMutation<HypothesisOverrideResponse, Error, HypothesisOverrideInput>({
    mutationFn: ({ hypothesis, action }) =>
      postJson<HypothesisOverrideResponse>(`/api/hypotheses/${hypothesis.id}`, { action }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ENGINE_STATE_KEY });
    },
  });
}

// ─── Bulk governance review (Layer 7) ────────────────────────────────────────

export interface GovernanceBulkInput {
  decision: GovernanceDecision;
  /** Threshold sweep — every pending review with riskScore <= maxRisk. */
  maxRisk?: number;
  /** Explicit operator selection — wins over maxRisk when present (cap 100). */
  ids?: string[];
  /** Optional operator annotation stamped on id-selected rows. */
  note?: string;
}

export interface GovernanceBulkResponse {
  ok: boolean;
  updated: number;
}

/** Apply one decision to a selection of pending human reviews (ids or risk threshold). */
export function useGovernanceBulk() {
  const queryClient = useQueryClient();
  return useMutation<GovernanceBulkResponse, Error, GovernanceBulkInput>({
    mutationFn: ({ decision, maxRisk, ids, note }) =>
      postJson<GovernanceBulkResponse>('/api/governance/bulk', {
        decision,
        ...(ids ? { ids, note } : { maxRisk }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ENGINE_STATE_KEY });
      void queryClient.invalidateQueries({ queryKey: ['governance-backlog'] });
    },
  });
}

// ─── Governance backlog telemetry (Layer 7) ──────────────────────────────────

export interface GovernanceBacklog {
  pendingTotal: number;
  bands: { low: number; mid: number; high: number; crit: number };
  breaching: number;
  oldestAgeMin: number;
}

async function fetchGovernanceBacklog(): Promise<GovernanceBacklog> {
  const res = await fetch('/api/governance/backlog');
  if (!res.ok) throw new Error(`Backlog telemetry unavailable (${res.status})`);
  return (await res.json()) as GovernanceBacklog;
}

/**
 * WHOLE-TABLE pending stats (the state payload caps its slice at 120).
 * 8s poll — cheap COUNT endpoint, refreshed alongside review actions.
 */
export function useGovernanceBacklog() {
  return useQuery<GovernanceBacklog, Error>({
    queryKey: ['governance-backlog'],
    queryFn: fetchGovernanceBacklog,
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
    staleTime: 4000,
    retry: 1,
  });
}

// ─── Operator signal injection (Layer 1) ─────────────────────────────────────

export interface InjectSignalInput {
  streamId?: string;
  category?: string;
  title: string;
  content: string;
  operator?: string;
}

export interface InjectedSignalSummary {
  id: string;
  title: string;
  anomalyScore: number;
  noveltyScore: number;
  promoted: boolean;
  streamName: string;
  cycle: number;
}

export interface InjectSignalResponse {
  ok: boolean;
  signal: InjectedSignalSummary;
}

/** Inject a high-signal operator observation via POST /api/signals. */
export function useInjectSignal() {
  const queryClient = useQueryClient();
  return useMutation<InjectSignalResponse, Error, InjectSignalInput>({
    mutationFn: (input) => postJson<InjectSignalResponse>('/api/signals', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ENGINE_STATE_KEY });
    },
  });
}
