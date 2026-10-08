// ─── PROMETHEUS engine-feed ──────────────────────────────────────────────────
// Live telemetry mini service (socket.io, port 3003).
//
// Two jobs:
//  1. HEARTBEAT — polls GET /api/engine/state on the Next.js server every
//     ~1.2s. That endpoint lazily fires due engine ticks, so the 8-layer
//     pipeline keeps running 7x24 even with NO browser open (previously the
//     dashboard's 4s poll was the only tick trigger).
//  2. PUSH — broadcasts the fresh state payload to every connected dashboard
//     whenever its fingerprint changes (new cycle, new signals/hypotheses/
//     governance decisions, config change, ...), plus a 15s keepalive.
//
// Gateway contract (DO NOT CHANGE): socket.io path is "/" and the browser
// connects via `io('/?XTransformPort=3003')` so Caddy can forward.

import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT = 3003;
const NEXT_STATE_URL = 'http://127.0.0.1:3000/api/engine/state';
const POLL_MS = 1200;
const KEEPALIVE_MS = 15_000;
const FETCH_TIMEOUT_MS = 15_000;

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ─── State tracking ──────────────────────────────────────────────────────────

interface FeedMeta {
  clients: number;
  cycles: number;
  engineStatus: string;
  lastPushAt: number | null;
  polls: number;
  pushCount: number;
  lastError: string | null;
}

let lastPayload: unknown = null;
let lastFingerprint = '';
let lastPushAt: number | null = null;
let polling = false;
let polls = 0;
let pushCount = 0;
let lastError: string | null = null;

// ─── Stall watchdog (R6-b) ───────────────────────────────────────────────────
// bun --hot instances froze after ~1-2min: process alive, :3003 listener
// closed, poll loop stalled — no exception is thrown, so nothing in-process
// can catch it. We track the last SUCCESSFUL poll (poll, not push: with no
// dashboard connected and no state change there are legitimately no pushes,
// so push staleness would false-positive) and a 20s interval exits the
// process if the heartbeat goes >45s stale. package.json `dev` runs a
// supervisor restart loop, so a clean exit(1) is the recovery path.
const WATCHDOG_INTERVAL_MS = 20_000;
const WATCHDOG_STALE_MS = 45_000;
let lastPollSuccessAt = Date.now();

setInterval(() => {
  const staleFor = Date.now() - lastPollSuccessAt;
  if (staleFor > WATCHDOG_STALE_MS) {
    console.error(
      `[feed] watchdog: stall detected, exiting for supervisor restart (no successful poll for ${Math.round(staleFor / 1000)}s)`,
    );
    process.exit(1);
  }
}, WATCHDOG_INTERVAL_MS);

/** djb2 — cheap stable hash so we only broadcast on real changes. */
function fingerprint(json: string): string {
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return String(h);
}

/**
 * JSON for CHANGE DETECTION only (the emitted payload stays full).
 * `engine.uptimeSeconds` advances every second — excluding it prevents
 * a push every poll tick.
 */
function stableJson(payload: unknown): string {
  const clone = { ...(payload as Record<string, unknown>) };
  const engine = { ...((clone.engine as Record<string, unknown>) ?? {}) };
  delete engine.uptimeSeconds;
  clone.engine = engine;
  return JSON.stringify(clone);
}

function meta(): FeedMeta {
  const engine = (lastPayload as { engine?: { cycles?: number; status?: string } } | null)?.engine;
  return {
    clients: io.engine.clientsCount,
    cycles: engine?.cycles ?? 0,
    engineStatus: engine?.status ?? 'unknown',
    lastPushAt,
    polls,
    pushCount,
    lastError,
  };
}

function broadcast(force: boolean) {
  if (!lastPayload) return;
  const fp = fingerprint(stableJson(lastPayload));
  const changed = fp !== lastFingerprint;
  const keepaliveDue =
    lastPushAt !== null && Date.now() - lastPushAt >= KEEPALIVE_MS;
  if (!changed && !force && !keepaliveDue) return;

  lastFingerprint = fp;
  lastPushAt = Date.now();
  pushCount++;
  io.emit('engine:state', lastPayload);
  io.emit('feed:status', meta());
  // LOG EVERY PUSH (normalized): previously only fingerprint CHANGES were
  // logged, so 15s keepalive pushes advanced the counter silently and feed.log
  // showed gaps (#40 → #51). One line per push, with a reason tag.
  const engine = (lastPayload as { engine?: { cycles?: number } } | null)?.engine;
  const size = JSON.stringify(lastPayload).length;
  const reason = changed ? 'change' : force ? 'connect' : 'keepalive';
  console.log(
    `[feed] push #${pushCount} (${reason}) — cycle ${engine?.cycles ?? '?'}, ${size} bytes, ${io.engine.clientsCount} client(s)`,
  );
}

// ─── Heartbeat poll loop (also drives engine ticks server-side) ─────────────

async function pollOnce() {
  polls++;
  try {
    const res = await fetch(NEXT_STATE_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'x-engine-feed': 'heartbeat' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`state ${res.status}`);
    lastPayload = await res.json();
    lastError = null;
    lastPollSuccessAt = Date.now();
    broadcast(false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== lastError) {
      lastError = msg;
      console.warn(`[feed] poll failed: ${msg} — retrying`);
    }
  }
}

function startPolling() {
  if (polling) return;
  polling = true;
  const loop = async () => {
    if (!polling) return;
    await pollOnce();
    if (polling) setTimeout(loop, POLL_MS);
  };
  void loop();
}

// ─── Socket handlers ─────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[feed] dashboard connected: ${socket.id} (${io.engine.clientsCount} online)`);
  // Fresh client gets the latest snapshot + feed meta immediately.
  socket.emit('engine:state', lastPayload);
  socket.emit('feed:status', meta());

  socket.on('feed:ping', (cb?: (m: FeedMeta) => void) => {
    if (typeof cb === 'function') cb(meta());
  });

  socket.on('disconnect', () => {
    console.log(`[feed] dashboard disconnected (${io.engine.clientsCount} online)`);
  });
  socket.on('error', (err) => console.error(`[feed] socket error (${socket.id}):`, err));
});

httpServer.listen(PORT, () => {
  console.log(`[feed] PROMETHEUS engine-feed listening on port ${PORT} — heartbeat every ${POLL_MS}ms`);
  startPolling();
});

process.on('SIGTERM', () => {
  polling = false;
  httpServer.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  polling = false;
  httpServer.close(() => process.exit(0));
});
