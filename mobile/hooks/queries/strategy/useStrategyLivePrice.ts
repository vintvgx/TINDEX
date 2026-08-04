import { useEffect, useRef, useState, useCallback } from 'react';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { PendingPriceUpdate } from '@/common/types/strategy';

export interface LivePriceData {
  contract:      string;
  mid_price:     number;
  entry_premium: number;
  pnl:           number;
  pnl_pct:       number;
  qty_remaining: number;
  /** mid_price * qty_remaining * 100 — the position's live mark-to-market
   *  value, already computed server-side on every tick (orb_engine.py's
   *  broadcast_price_update). Lets the client derive live account equity
   *  without a separate REST poll. */
  market_value:  number;
  tp1_hit:       boolean;
  tp2_hit:       boolean;
  hard_stop:     number;
  tp1:           number;
  tp2:           number;
  /** True while a SL_5/SL_10 (or REVERSAL) grace window is open — the
   *  premium is at/below hard_stop but hasn't been force-sold yet. See
   *  exit_manager.py's sl_grace_enabled. */
  sl_grace_active?:      boolean;
  /** Absolute ISO timestamp the grace window force-sells at, if still below
   *  the stop then. Always compute a countdown as `deadline - Date.now()`
   *  every render — never run an independent local timer — so the displayed
   *  countdown can't drift from the backend's own clock. */
  sl_grace_deadline?:    string | null;
  /** Absolute ISO timestamp: if the premium is currently recovered above the
   *  stop, this is when that recovery will have held long enough (60s) to
   *  cancel the grace window. Null while price is still at/below the stop. */
  sl_recovery_deadline?: string | null;
  /** False for a 1-contract entry regardless of profile — TP2 is never
   *  reachable. See common/types/strategy.ts's StrategyPosition.use_tp2. */
  use_tp2?: boolean;
  /** Current stop-type CONFIGURATION (Hard Stop vs SL timer, and which
   *  duration) — distinct from sl_grace_active above, which is only true
   *  while a grace window is actively counting down. See
   *  ExitManager.to_dict(). */
  sl_grace_enabled?: boolean;
  sl_grace_minutes?: number | null;
  /** Current runner/cascade CONFIGURATION for this open trade (not just the
   *  profile default) — see exit_manager.py's to_dict(). Lets EditExitsModal
   *  pre-select the toggle to what's actually in effect right now. */
  runner_mode?: 'trail' | 'be_hold' | 'none';
  cascade_enabled?: boolean;
  // ── Simulation-only fields (all optional — absent on a real live position) ──
  sim?:               boolean;
  sim_tick?:          number;
  sim_total?:         number;
  sim_scenario?:      string;
  sim_leg?:           'call' | 'put';
  call_pnl?:          number;
  /** Synthetic IWM underlying price mapped from the option premium — see
   *  api/services/strategy/simulation.py's _underlying_at. Feeds the
   *  simulation chart's candles/reference lines, which plot on a real
   *  price axis rather than the raw option premium. */
  underlying_price?:  number;
  entry_underlying?:  number;
  tp1_underlying?:    number;
  tp2_underlying?:    number;
  /** Recomputed every tick — moves to entry_underlying once TP1 fires
   *  (breakeven stop), same as hard_stop does on the premium side. */
  stop_underlying?:   number;
}

interface UseStrategyLivePriceResult {
  data:               LivePriceData | null;
  /** Live premium + recomputed SL/TP1/TP2 preview while a confirm_entry trade
   *  is pending approval — null once a position is open (server stops sending
   *  this type and starts sending "price_update" instead) or nothing pending. */
  pendingPriceData:   PendingPriceUpdate | null;
  connected:          boolean;
  disconnect:         () => void;
  /** Merge fields into the current WS snapshot immediately (e.g. right after
   *  a stop/TP edit succeeds server-side) instead of waiting for the next
   *  "price_update" tick to catch up — the server confirms the edit over
   *  REST well before the next tick would otherwise reflect it. */
  patchData:          (patch: Partial<LivePriceData>) => void;
}

/**
 * Opens a WebSocket to /ws/strategy/<strategyId>/live and streams real-time
 * option mid-price + P&L for the active position.
 *
 * Reconnects automatically on unexpected disconnects while `enabled` is true.
 * Pass enabled=false (or omit strategyId) when no position is open to avoid
 * unnecessary connections.
 */
export function useStrategyLivePrice(
  strategyId: string | undefined,
  enabled: boolean = true,
  onPositionClosed?: () => void,
): UseStrategyLivePriceResult {
  const [data, setData]                       = useState<LivePriceData | null>(null);
  const [pendingPriceData, setPendingPriceData] = useState<PendingPriceUpdate | null>(null);
  const [connected, setConnected]             = useState(false);
  const wsRef                     = useRef<WebSocket | null>(null);
  const reconnectTimer            = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef               = useRef(0);
  const mountedRef                = useRef(true);
  const shouldReconnectRef        = useRef(true);
  // Keep callback in a ref so changing it doesn't rebuild the WebSocket
  const onPositionClosedRef       = useRef(onPositionClosed);
  onPositionClosedRef.current     = onPositionClosed;

  const wsUrl = strategyId
    ? RAILWAY_BASE_URL.replace(/^https?/, (s) => (s === 'https' ? 'wss' : 'ws'))
        + `/ws/strategy/${strategyId}/live`
    : null;

  const connect = useCallback(() => {
    if (!wsUrl || !mountedRef.current) return;

    shouldReconnectRef.current = true;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Connect watchdog: if the handshake doesn't complete promptly (e.g. the
    // server has no free thread to serve the upgrade), drop it and let onclose
    // schedule a backed-off retry — never leave the socket hanging.
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      if (mountedRef.current && ws.readyState !== WebSocket.OPEN) ws.close();
    }, 8000);

    ws.onopen = () => {
      if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
      attemptsRef.current = 0;            // reset backoff on a healthy connection
      if (mountedRef.current) setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (!mountedRef.current) return;
        if (msg.type === 'price_update') {
          setData(msg as LivePriceData);
        } else if (msg.type === 'pending_price_update') {
          setPendingPriceData(msg as PendingPriceUpdate);
        } else if (msg.type === 'position_closed') {
          setData(null);
          onPositionClosedRef.current?.();
        }
      } catch {
        // ignore malformed frames (e.g. keepalive pings)
      }
    };

    ws.onclose = () => {
      if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
      if (!mountedRef.current) return;
      setConnected(false);
      if (!shouldReconnectRef.current || !enabled) return;
      // Capped exponential backoff so failed connects don't storm the server.
      const delay = Math.min(2000 * 1.6 ** attemptsRef.current, 20000);
      attemptsRef.current += 1;
      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current && enabled && shouldReconnectRef.current) connect();
      }, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [wsUrl, enabled]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    attemptsRef.current = 0;
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setData(null);
    setPendingPriceData(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled && wsUrl) {
      connect();
    }
    return () => {
      mountedRef.current = false;
      disconnect();
    };
    // connect is memoized on [wsUrl, enabled]; disconnect is stable — so this
    // re-runs exactly when the target socket changes (no reconnect storm).
  }, [connect, disconnect, enabled, wsUrl]);

  const patchData = useCallback((patch: Partial<LivePriceData>) => {
    setData(prev => (prev ? { ...prev, ...patch } : prev));
  }, []);

  return { data, pendingPriceData, connected, disconnect, patchData };
}
