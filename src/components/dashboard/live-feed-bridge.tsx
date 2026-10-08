'use client';

/**
 * LiveFeedBridge — invisible component that owns the WebSocket subscription
 * to the engine-feed mini service (port 3003 via the Caddy gateway).
 *
 * Every `engine:state` push is written straight into the TanStack Query
 * cache with a newer-wins guard, so ALL consumers of useEngineState() (tabs,
 * header stats, footer, event log) update in real time without any change.
 * HTTP polling (see use-engine.ts) degrades to a 20s safety net while the
 * socket is healthy and re-arms at 4s the moment it drops.
 */

import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { ENGINE_STATE_KEY } from '@/hooks/use-engine';
import type { EngineStatePayload } from '@/lib/dashboard-types';
import { useFeedStore } from '@/lib/feed-store';

/** Newest payload wins by (cycles, lastTickAt); equal-state pushes still overwrite. */
function isNewer(next: EngineStatePayload, prev?: EngineStatePayload): boolean {
  if (!prev) return true;
  if (next.engine.cycles !== prev.engine.cycles) return next.engine.cycles > prev.engine.cycles;
  return next.engine.lastTickAt >= prev.engine.lastTickAt;
}

export function LiveFeedBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    useFeedStore.getState().setStatus('connecting');

    // Gateway contract: RELATIVE url + XTransformPort query, path "/" (Caddy).
    const socket: Socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 1500,
      timeout: 10000,
    });

    socket.on('connect', () => {
      useFeedStore.getState().setStatus('live');
    });

    socket.on('disconnect', () => {
      useFeedStore.getState().setStatus('polling');
      // Catch up immediately; the interval fn re-evaluates to 4s after this fetch.
      void queryClient.refetchQueries({ queryKey: ENGINE_STATE_KEY, type: 'active' });
    });

    socket.on('engine:state', (payload: EngineStatePayload) => {
      if (!payload?.engine) return;
      const prev = queryClient.getQueryData<EngineStatePayload>(ENGINE_STATE_KEY);
      if (isNewer(payload, prev)) {
        queryClient.setQueryData(ENGINE_STATE_KEY, payload);
      }
      // Wire size for the footer telemetry cluster (JSON transport → always
      // serializable; guard anyway so a malformed push can never throw here).
      let bytes: number | null = null;
      try {
        bytes = JSON.stringify(payload).length;
      } catch {
        bytes = null;
      }
      useFeedStore.getState().markPush(bytes);
    });

    socket.on('feed:status', (meta: { clients?: number }) => {
      if (typeof meta?.clients === 'number') useFeedStore.getState().setClients(meta.clients);
    });

    return () => {
      socket.disconnect();
      useFeedStore.getState().setStatus('polling');
    };
  }, [queryClient]);

  return null;
}
