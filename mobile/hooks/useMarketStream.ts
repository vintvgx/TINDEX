import { useEffect, useRef, useState, useCallback } from 'react';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface MarketSentiment {
  label: 'Calm' | 'Neutral' | 'Cautious' | 'Fearful' | 'Extreme Fear' | 'Unknown';
  color: 'green' | 'gray' | 'yellow' | 'orange' | 'red';
}

export interface MarketStreamState {
  livePrices:  Record<string, number>;
  vix:         number | null;
  spy:         number | null;
  sentiment:   MarketSentiment | null;
  connected:   boolean;
}

// Convert https:// → wss://, http:// → ws://
function toWsUrl(httpUrl: string, path: string): string {
  return httpUrl.replace(/^http/, 'ws') + path;
}

const WS_URL = toWsUrl(RAILWAY_BASE_URL, '/ws/prices');
const RECONNECT_DELAY_MS = 3000;

export function useMarketStream(tickers: string[]): MarketStreamState {
  const [state, setState] = useState<MarketStreamState>({
    livePrices: {},
    vix:        null,
    spy:        null,
    sentiment:  null,
    connected:  false,
  });

  const wsRef        = useRef<WebSocket | null>(null);
  const tickersRef   = useRef<string[]>(tickers);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef   = useRef(true);

  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      console.log('[MarketStream] connected');
      setState(prev => ({ ...prev, connected: true }));
      // Subscribe to current ticker list
      ws.send(JSON.stringify({ tickers: tickersRef.current }));
    };

    ws.onmessage = (event: WebSocketMessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          prices?: Record<string, number>;
          vix?: number | null;
          spy?: number | null;
          sentiment?: MarketSentiment;
        };
        if (msg.type === 'price_update') {
          setState(prev => ({
            ...prev,
            livePrices: msg.prices  ?? prev.livePrices,
            vix:        msg.vix     ?? prev.vix,
            spy:        msg.spy     ?? prev.spy,
            sentiment:  msg.sentiment ?? prev.sentiment,
          }));
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onerror = (e) => {
      console.warn('[MarketStream] error', e);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      console.log('[MarketStream] disconnected — reconnecting in', RECONNECT_DELAY_MS, 'ms');
      setState(prev => ({ ...prev, connected: false }));
      reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };
  }, []); // stable — no deps change after mount

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Re-subscribe when tickers change while connected
  useEffect(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN && tickers.length > 0) {
      ws.send(JSON.stringify({ tickers }));
    }
  }, [tickers]);

  return state;
}
