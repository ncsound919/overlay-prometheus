'use client';

/**
 * Connection status of the PROMETHEUS live telemetry feed (socket.io mini
 * service on port 3003). The dashboard reads this to (a) render the
 * LIVE/POLL indicator in the header, (b) throttle its HTTP polling
 * fallback — while the feed is live, polling drops to a 20s safety net —
 * and (c) power the footer's FEED telemetry cluster (pushes/clients/last push).
 */

import { create } from 'zustand';

export type FeedStatus = 'connecting' | 'live' | 'polling';

interface FeedState {
  status: FeedStatus;
  /** Server timestamp of the last state push (client clock). */
  lastPushAt: number | null;
  /** Wire size (chars) of the last accepted state push, when measurable. */
  lastPayloadBytes: number | null;
  /** Total state pushes received this session — a cheap throughput gauge. */
  pushCount: number;
  /** Connected dashboards reported by the feed service. */
  clients: number;
  setStatus: (status: FeedStatus) => void;
  /** Record an accepted push; pass the payload wire size when available. */
  markPush: (payloadBytes?: number | null) => void;
  setClients: (clients: number) => void;
}

export const useFeedStore = create<FeedState>((set) => ({
  status: 'connecting',
  lastPushAt: null,
  lastPayloadBytes: null,
  pushCount: 0,
  clients: 0,
  setStatus: (status) => set({ status }),
  markPush: (payloadBytes) =>
    set((s) => ({
      lastPushAt: Date.now(),
      pushCount: s.pushCount + 1,
      lastPayloadBytes: typeof payloadBytes === 'number' && Number.isFinite(payloadBytes) ? payloadBytes : null,
    })),
  setClients: (clients) => set({ clients }),
}));
