import { AppState, type AppStateStatus } from 'react-native';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { PendingPriceUpdate } from '@/common/types/strategy';
import type { LivePriceData } from './useStrategyLivePrice';

/**
 * App-wide registry of /ws/strategy/<id>/live sockets — ONE socket per
 * strategy_id no matter how many components read it (position row, chart
 * strip, ticker tape, equity hooks…). Consumers retain/release an entry; the
 * socket opens on the first retain and closes a few seconds after the last
 * release (the linger rides out tab switches / remounts without a reconnect).
 *
 * Every entry's latest tick is readable by anyone via getLiveSnapshot(), so
 * hooks like useLiveEquity can derive live equity from the same sockets the
 * rows hold open — or open them themselves when no rows are mounted — without
 * ever duplicating a connection.
 *
 * Background/foreground (2026-10-13): every socket closes when the app leaves
 * the foreground and reopens the instant it returns. Left open, iOS kept the
 * socket alive while the app was suspended and buffered the server's ticks;
 * on return the app replayed them all, so P&L and equity visibly ticked
 * through ~10s of old prices before the real one. Now the snapshot is cleared
 * and flagged `resyncing` (UI shows a skeleton) until the fresh socket's first
 * message — the server sends the current price on connect.
 */

export interface LiveSnapshot {
  data:             LivePriceData | null;
  pendingPriceData: PendingPriceUpdate | null;
  connected:        boolean;
  /** Date.now() of the last price_update — 0 before the first one. The
   *  server stops sending when its option stream dies (see orb_engine's
   *  _build_price_payload), so an old tick is a frozen mark, not a live one. */
  receivedAt:       number;
  /** Back from the background, waiting for the fresh socket's first price —
   *  show a skeleton rather than the pre-background value. */
  resyncing:        boolean;
}

export const EMPTY_SNAPSHOT: LiveSnapshot = Object.freeze({
  data: null, pendingPriceData: null, connected: false, receivedAt: 0, resyncing: false,
});

/** A tick older than this is treated as stale by the equity hooks, which
 *  then fall back to the slow REST backup instead of a frozen WS mark. */
export const LIVE_STALE_MS = 60_000;

/** True when the snapshot holds a mark recent enough to show as live. */
export function isFresh(snap: LiveSnapshot | undefined): snap is LiveSnapshot & { data: LivePriceData } {
  return !!snap?.data && Date.now() - snap.receivedAt < LIVE_STALE_MS;
}

const LINGER_MS = 5_000;
const OPEN_TIMEOUT_MS = 8_000;
/** Give up waiting for the first post-resume price after this long and let
 *  the UI fall back to the REST values. */
const RESYNC_TIMEOUT_MS = 4_000;

interface Entry {
  url:            string;
  refs:           number;
  snap:           LiveSnapshot;
  ws:             WebSocket | null;
  attempts:       number;
  /** Last few price updates, for display smoothing (see onmessage). */
  recent:         LivePriceData[];
  listeners:      Set<() => void>;
  closedListeners: Set<() => void>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  openTimer:      ReturnType<typeof setTimeout> | null;
  lingerTimer:    ReturnType<typeof setTimeout> | null;
  resyncTimer:    ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();
/** True while the app is backgrounded — sockets stay closed, no reconnects. */
let paused = false;

function wsUrlFor(strategyId: string): string {
  return RAILWAY_BASE_URL.replace(/^https?/, (s) => (s === 'https' ? 'wss' : 'ws'))
    + `/ws/strategy/${strategyId}/live`;
}

function setSnap(entry: Entry, patch: Partial<LiveSnapshot>) {
  entry.snap = { ...entry.snap, ...patch };
  entry.listeners.forEach((l) => l());
}

// Capitalised on purpose: NetworkDiagnosticsService attributes a socket to the
// first hook/component-looking frame, so this labels every strategy socket.
function StrategyLiveSocket(strategyId: string, entry: Entry) {
  const ws = new WebSocket(entry.url);
  entry.ws = ws;
  const alive = () => entries.get(strategyId) === entry && entry.ws === ws;

  // Connect watchdog: if the handshake doesn't complete promptly (e.g. the
  // server has no free thread to serve the upgrade), drop it and let onclose
  // schedule a backed-off retry — never leave the socket hanging.
  if (entry.openTimer) clearTimeout(entry.openTimer);
  entry.openTimer = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) ws.close();
  }, OPEN_TIMEOUT_MS);

  ws.onopen = () => {
    if (!alive()) return;
    if (entry.openTimer) { clearTimeout(entry.openTimer); entry.openTimer = null; }
    entry.attempts = 0;            // reset backoff on a healthy connection
    // Fresh connection, fresh tape: pre-gap ticks in the smoothing buffer
    // would drag the median (and the displayed P&L) for two updates.
    entry.recent = [];
    setSnap(entry, { connected: true });
  };

  ws.onmessage = (event) => {
    if (!alive()) return;
    try {
      const msg = JSON.parse(event.data as string);
      if (msg.type === 'price_update') {
        // Display smoothing: the price-derived fields come from the update
        // whose mid is the MEDIAN of the last 3, so a one-tick spread blip
        // ($0.30 → $0.36 → $0.30 on a 0DTE) doesn't flash the P&L; a real
        // move shows by the second update. Everything else (tp1_hit, qty,
        // stops, timers…) is always the newest. The server already
        // coalesces to ≤3/s (polling audit A3).
        const next = msg as LivePriceData;
        const buf = [...entry.recent, next].slice(-3);
        entry.recent = buf;
        let data = next;
        if (buf.length === 3) {
          const med = [...buf].sort((a, b) => a.mid_price - b.mid_price)[1];
          data = {
            ...next,
            mid_price: med.mid_price,
            pnl: med.pnl,
            pnl_pct: med.pnl_pct,
            market_value: med.market_value,
          };
        }
        if (entry.resyncTimer) { clearTimeout(entry.resyncTimer); entry.resyncTimer = null; }
        setSnap(entry, { data, receivedAt: Date.now(), resyncing: false });
      } else if (msg.type === 'pending_price_update') {
        setSnap(entry, { pendingPriceData: msg as PendingPriceUpdate });
      } else if (msg.type === 'position_closed') {
        entry.recent = [];
        setSnap(entry, { data: null, receivedAt: 0, resyncing: false });
        entry.closedListeners.forEach((l) => l());
      }
    } catch {
      // ignore malformed frames (e.g. keepalive pings)
    }
  };

  ws.onclose = () => {
    if (entry.openTimer) { clearTimeout(entry.openTimer); entry.openTimer = null; }
    if (!alive()) return;
    entry.ws = null;
    setSnap(entry, { connected: false });
    if (entry.refs === 0) return;  // lingering — let the teardown happen
    if (paused) return;            // backgrounded — resume() reconnects
    // Capped exponential backoff so failed connects don't storm the server.
    const delay = Math.min(2000 * 1.6 ** entry.attempts, 20000);
    entry.attempts += 1;
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      if (entries.get(strategyId) === entry && entry.refs > 0 && !entry.ws) {
        StrategyLiveSocket(strategyId, entry);
      }
    }, delay);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function teardown(strategyId: string, entry: Entry) {
  if (entries.get(strategyId) !== entry) return;
  entries.delete(strategyId);
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
  if (entry.openTimer) clearTimeout(entry.openTimer);
  if (entry.lingerTimer) clearTimeout(entry.lingerTimer);
  if (entry.resyncTimer) clearTimeout(entry.resyncTimer);
  const ws = entry.ws;
  entry.ws = null;
  ws?.close();
  // Anyone still holding a listener (shouldn't be any) falls back to EMPTY.
  entry.snap = EMPTY_SNAPSHOT;
  entry.listeners.forEach((l) => l());
}

function retain(strategyId: string): Entry {
  let entry = entries.get(strategyId);
  if (!entry) {
    entry = {
      url: wsUrlFor(strategyId),
      refs: 0,
      snap: EMPTY_SNAPSHOT,
      ws: null,
      attempts: 0,
      recent: [],
      listeners: new Set(),
      closedListeners: new Set(),
      reconnectTimer: null,
      openTimer: null,
      lingerTimer: null,
      resyncTimer: null,
    };
    entries.set(strategyId, entry);
  }
  ensureAppStateListener();
  entry.refs += 1;
  if (entry.lingerTimer) { clearTimeout(entry.lingerTimer); entry.lingerTimer = null; }
  if (!paused && !entry.ws && !entry.reconnectTimer) StrategyLiveSocket(strategyId, entry);
  return entry;
}

// ── Background / foreground ──────────────────────────────────────────────

function pauseAll() {
  if (paused) return;
  paused = true;
  entries.forEach((entry) => {
    if (entry.reconnectTimer) { clearTimeout(entry.reconnectTimer); entry.reconnectTimer = null; }
    if (entry.openTimer) { clearTimeout(entry.openTimer); entry.openTimer = null; }
    if (entry.resyncTimer) { clearTimeout(entry.resyncTimer); entry.resyncTimer = null; }
    const ws = entry.ws;
    entry.ws = null;          // detach first, so its onclose is ignored
    ws?.close();
    entry.recent = [];
    // Drop the pre-background value — nothing stale gets replayed or shown.
    setSnap(entry, { connected: false, data: null, receivedAt: 0, resyncing: true });
  });
}

function resumeAll() {
  if (!paused) return;
  paused = false;
  entries.forEach((entry, strategyId) => {
    if (entry.refs === 0) {
      teardown(strategyId, entry);
      return;
    }
    entry.attempts = 0;
    if (!entry.ws) StrategyLiveSocket(strategyId, entry);
    if (entry.resyncTimer) clearTimeout(entry.resyncTimer);
    entry.resyncTimer = setTimeout(() => {
      entry.resyncTimer = null;
      if (entry.snap.resyncing) setSnap(entry, { resyncing: false });
    }, RESYNC_TIMEOUT_MS);
  });
}

let appStateSub: { remove: () => void } | null = null;
function ensureAppStateListener() {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') resumeAll();
    else if (state === 'background') pauseAll();
  });
}

function release(strategyId: string, entry: Entry) {
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0 || entry.lingerTimer) return;
  entry.lingerTimer = setTimeout(() => teardown(strategyId, entry), LINGER_MS);
}

/**
 * Hold the socket for `strategyId` open and get notified on every change.
 * Returns the unsubscribe — shaped for useSyncExternalStore.
 */
export function subscribeLive(
  strategyId: string,
  onChange: () => void,
  onPositionClosed?: () => void,
): () => void {
  const entry = retain(strategyId);
  entry.listeners.add(onChange);
  if (onPositionClosed) entry.closedListeners.add(onPositionClosed);
  return () => {
    entry.listeners.delete(onChange);
    if (onPositionClosed) entry.closedListeners.delete(onPositionClosed);
    release(strategyId, entry);
  };
}

export function getLiveSnapshot(strategyId: string): LiveSnapshot {
  return entries.get(strategyId)?.snap ?? EMPTY_SNAPSHOT;
}

/** Merge fields into the shared snapshot (e.g. right after a stop/TP edit
 *  succeeds server-side) — every reader of this position sees it at once. */
export function patchLiveData(strategyId: string, patch: Partial<LivePriceData>) {
  const entry = entries.get(strategyId);
  if (!entry?.snap.data) return;
  setSnap(entry, { data: { ...entry.snap.data, ...patch } });
}
