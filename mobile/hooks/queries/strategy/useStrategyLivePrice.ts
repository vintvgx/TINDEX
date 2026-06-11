import { useEffect, useRef, useState, useCallback } from 'react';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

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
}

interface UseStrategyLivePriceResult {
  data:        LivePriceData | null;
  connected:   boolean;
  disconnect:  () => void;
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
): UseStrategyLivePriceResult {
  const [data, setData]           = useState<LivePriceData | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef                     = useRef<WebSocket | null>(null);
  const reconnectTimer            = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef               = useRef(0);
  const mountedRef                = useRef(true);
  const shouldReconnectRef        = useRef(true);

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
        if (msg.type === 'price_update' && mountedRef.current) {
          setData(msg as LivePriceData);
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

  return { data, connected, disconnect };
}
