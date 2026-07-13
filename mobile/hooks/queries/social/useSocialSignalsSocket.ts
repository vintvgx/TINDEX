import { useEffect, useRef, useState, useCallback } from 'react';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

/** contract_symbol -> latest mid price */
export type LivePriceMap = Record<string, number>;

/**
 * Opens a single shared WebSocket to /ws/social-signals/live and streams
 * mid-price ticks for every currently-tracked social-signal contract,
 * keyed by contract_symbol — one connection multiplexing every card, not
 * one per card. Reconnects automatically with capped backoff, same pattern
 * as useStrategyLivePrice.
 */
export function useSocialSignalsSocket(enabled: boolean = true) {
  const [prices, setPrices] = useState<LivePriceMap>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const shouldReconnectRef = useRef(true);

  const wsUrl = RAILWAY_BASE_URL.replace(/^https?/, (s) => (s === 'https' ? 'wss' : 'ws'))
    + '/ws/social-signals/live';

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    shouldReconnectRef.current = true;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      if (mountedRef.current && ws.readyState !== WebSocket.OPEN) ws.close();
    }, 8000);

    ws.onopen = () => {
      if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
      attemptsRef.current = 0;
      if (mountedRef.current) setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (!mountedRef.current) return;
        if (msg.type === 'price_update' && msg.contract_symbol) {
          setPrices(prev => ({ ...prev, [msg.contract_symbol]: msg.mid_price }));
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
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    attemptsRef.current = 0;
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) connect();
    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [connect, disconnect, enabled]);

  return { prices, connected };
}
