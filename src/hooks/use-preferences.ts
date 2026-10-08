'use client';

/**
 * Tiny localStorage-backed preference store for the PROMETHEUS dashboard.
 * Key: 'prometheus.prefs.v1' — { tab, layerKey, logExpanded, tickerCategory }.
 * Dependency-free: module-level cache + useSyncExternalStore, guarded for SSR
 * and private-mode quota errors.
 */

import { useCallback, useSyncExternalStore } from 'react';

export interface PrometheusPrefs {
  /** Last active workspace tab ('discovery' | 'breakthroughs' | ...). */
  tab?: string;
  /** Last selected inference layer (1..8) in the Layer Stack detail panel. */
  layerKey?: number | null;
  /** Whether the SYSTEM EVENT STREAM terminal is expanded. */
  logExpanded?: boolean;
  /** Signal-ticker stream filter (a stream category); null/absent = off. */
  tickerCategory?: string | null;
}

const PREFS_KEY = 'prometheus.prefs.v1';

let cached: PrometheusPrefs | null = null;

/** Synchronous read (client only). Returns {} on server or corrupted JSON. */
export function readPrometheusPrefs(): PrometheusPrefs {
  if (typeof window === 'undefined') return {};
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    cached = typeof parsed === 'object' && parsed !== null ? (parsed as PrometheusPrefs) : {};
  } catch {
    cached = {};
  }
  return cached ?? {};
}

const listeners = new Set<() => void>();

/** Merge a patch into the store, persist it, and notify subscribers. */
export function writePrometheusPrefs(patch: Partial<PrometheusPrefs>): void {
  if (typeof window === 'undefined') return;
  const next: PrometheusPrefs = { ...readPrometheusPrefs(), ...patch };
  cached = next;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded / private mode — keep the in-memory value.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER_SNAPSHOT: PrometheusPrefs = Object.freeze({});

function getServerSnapshot(): PrometheusPrefs {
  return SERVER_SNAPSHOT;
}

/** [preferences, update] — update(patch) merges + persists synchronously. */
export function usePreferences(): readonly [PrometheusPrefs, (patch: Partial<PrometheusPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, readPrometheusPrefs, getServerSnapshot);
  const update = useCallback((patch: Partial<PrometheusPrefs>) => {
    writePrometheusPrefs(patch);
  }, []);
  return [prefs, update] as const;
}
