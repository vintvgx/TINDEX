import { useEffect, useRef, useState, useCallback } from 'react';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface UseChartLiveStreamResult {
  /** Latest real-time last-trade price, or null before the first tick. */
  price: number | null;
  connected: boolean;
  /** True once several reconnect attempts in a row have failed — signals the
   *  caller to fall back to a different price source and/or notify the user.
   *  Clears itself automatically the moment a later reconnect succeeds. */
  error: boolean;
}

const MAX_RECONNECT_ATTEMPTS_BEFORE_ERROR = 3;
// The backend forwards every Alpaca trade — dozens a second on a liquid
// ticker. Each published price re-renders the whole Charts tab and
// rebuilds the forming candle, so trades are coalesced and the latest one
// is published at most this often (a pegged JS thread / thermal pressure /
// iOS cpu_resource kill at trade rate — see the 2026-10-06 analysis).
const PUBLISH_INTERVAL_MS = 500;

/**
 * Opens a WebSocket to /ws/chart/<ticker>/live and streams real-time
 * last-trade prices for one ticker — the paper-key Alpaca stream backing
 * PriceChartFullScreen (see api/services/websocket/stock_chart_stream.py).
 * Independent of useMarketStream's shared /ws/prices socket (which stays on
 * its existing yfinance poll for TickerTape/watchlists/dashboard).
 *
 * Reconnects automatically with capped exponential backoff while `enabled`
 * is true, mirroring useStrategyLivePrice's shape. Pass enabled=false (or
 * omit ticker) when no chart is open to avoid an unnecessary connection.
 */
export function useChartLiveStream(
  ticker: string | undefined,
  enabled: boolean = true,
): UseChartLiveStreamResult {
  // Tagged with the socket's ticker: on a ticker switch the previous
  // ticker's last price would otherwise be returned for a render (until the
  // effect cleanup nulls it) and seed the new chart's forming candle.
  const [tick, setTick] = useState<{ url: string; price: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Coalescing: newest trade not yet published, the last published one,
  // and the pending flush.
  const pendingRef = useRef<{ url: string; price: number } | null>(null);
  const publishedRef = useRef<{ url: string; price: number } | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlushAt = useRef(0);
  const attemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const shouldReconnectRef = useRef(true);

  const wsUrl = ticker
    ? RAILWAY_BASE_URL.replace(/^https?/, (s) => (s === 'https' ? 'wss' : 'ws'))
        + `/ws/chart/${ticker.toUpperCase()}/live`
    : null;

  const connect = useCallback(() => {
    if (!wsUrl || !mountedRef.current) return;

    shouldReconnectRef.current = true;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Connect watchdog: if the handshake doesn't complete promptly, drop it
    // and let onclose schedule a backed-off retry — never leave it hanging.
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      if (mountedRef.current && ws.readyState !== WebSocket.OPEN) ws.close();
    }, 8000);

    ws.onopen = () => {
      if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
      attemptsRef.current = 0;
      if (mountedRef.current) {
        setConnected(true);
        setError(false); // a healthy reconnect clears any prior error state
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (!mountedRef.current) return;
        if (msg.type === 'price_update' && typeof msg.price === 'number') {
          pendingRef.current = { url: wsUrl, price: msg.price };
          if (flushTimer.current) return; // a flush is already scheduled
          const flush = () => {
            flushTimer.current = null;
            const next = pendingRef.current;
            pendingRef.current = null;
            lastFlushAt.current = Date.now();
            if (!next || !mountedRef.current) return;
            const prev = publishedRef.current;
            // Same price as what's on screen — nothing to re-render.
            if (prev && prev.url === next.url && prev.price === next.price) return;
            publishedRef.current = next;
            setTick(next);
          };
          const wait = PUBLISH_INTERVAL_MS - (Date.now() - lastFlushAt.current);
          if (wait <= 0) flush();
          else flushTimer.current = setTimeout(flush, wait);
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
      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS_BEFORE_ERROR) {
        setError(true);
      }
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
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    pendingRef.current = null;
    publishedRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setTick(null);
    setError(false);
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

  const price = tick && tick.url === wsUrl ? tick.price : null;
  return { price, connected, error };
}
