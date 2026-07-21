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
  tp1_hit:       boolean;
  tp2_hit:       boolean;
  hard_stop:     number;
  tp1:           number;
  tp2:           number;
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

  return { data, pendingPriceData, connected, disconnect };
}
