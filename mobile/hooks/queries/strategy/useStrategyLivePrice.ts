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

    ws.onopen = () => {
      if (mountedRef.current) setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'price_update' && mountedRef.current) {
          setData(msg as LivePriceData);
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      if (!shouldReconnectRef.current || !enabled) return;
      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current && enabled && shouldReconnectRef.current) connect();
      }, 3000);
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
  }, [wsUrl, enabled]);

  return { data, connected, disconnect };
}
