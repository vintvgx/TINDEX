import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface MarketSentiment {
  label: 'Calm' | 'Neutral' | 'Cautious' | 'Fearful' | 'Extreme Fear' | 'Unknown';
  color: 'green' | 'gray' | 'yellow' | 'orange' | 'red';
}

export interface MarketStreamState {
  livePrices: Record<string, number>;
  vix: number | null;
  spy: number | null;
  sentiment: MarketSentiment | null;
  connected: boolean;
}

interface MarketStreamContextValue {
  state: MarketStreamState;
  /** Registers/updates one consumer's ticker interest. The socket's single
   *  subscription is always the union of every currently-registered
   *  consumer's list, so N components watching overlapping tickers still
   *  cost exactly one WebSocket connection instead of N. */
  setConsumerTickers: (id: string, tickers: string[]) => void;
  clearConsumer: (id: string) => void;
}

const MarketStreamContext = createContext<MarketStreamContextValue | null>(null);

function toWsUrl(httpUrl: string, path: string): string {
  return httpUrl.replace(/^http/, 'ws') + path;
}

const WS_URL = toWsUrl(RAILWAY_BASE_URL, '/ws/prices');
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 20000;

/**
 * Owns the single app-wide WebSocket to /ws/prices. Previously every
 * consumer of useMarketStream (TickerTape, dashboard, monitor, watchlists,
 * PriceChartFullScreen, ...) opened its own independent connection — up to
 * 5-6 simultaneous sockets to the same endpoint from one app session, each
 * reconnecting on its own schedule, which made ordinary reconnect churn look
 * (and read in logs) like a constant disconnect storm. This provider is the
 * only thing that ever calls `new WebSocket(...)`; useMarketStream() just
 * registers its ticker interest here and reads the shared state.
 */
export function MarketStreamProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MarketStreamState>({
    livePrices: {},
    vix: null,
    spy: null,
    sentiment: null,
    connected: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const consumersRef = useRef<Map<string, string[]>>(new Map());
  const lastSentKeyRef = useRef<string>('');

  const mergedTickers = useCallback((): string[] => {
    const set = new Set<string>();
    for (const list of consumersRef.current.values()) {
      for (const t of list) set.add(t.toUpperCase());
    }
    return Array.from(set);
  }, []);

  const sendSubscription = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const tickers = mergedTickers();
    const key = tickers.slice().sort().join(',');
    if (key === lastSentKeyRef.current) return;
    lastSentKeyRef.current = key;
    ws.send(JSON.stringify({ tickers }));
  }, [mergedTickers]);

  const disconnect = useCallback(() => {
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current || wsRef.current) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      console.log('[MarketStream] connected');
      attemptsRef.current = 0;
      lastSentKeyRef.current = '';
      setState(prev => ({ ...prev, connected: true }));
      sendSubscription();
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
            livePrices: msg.prices    ?? prev.livePrices,
            vix:        msg.vix       ?? prev.vix,
            spy:        msg.spy       ?? prev.spy,
            sentiment:  msg.sentiment ?? prev.sentiment,
          }));
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onerror = (e) => {
      console.warn('[MarketStream] error', e);
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;
      // Capped exponential backoff — a flat 3s retry forever just hammers a
      // persistently-failing connection instead of backing off from it.
      const delay = Math.min(BASE_RECONNECT_DELAY_MS * 1.6 ** attemptsRef.current, MAX_RECONNECT_DELAY_MS);
      attemptsRef.current += 1;
      console.log('[MarketStream] disconnected — reconnecting in', Math.round(delay), 'ms');
      setState(prev => ({ ...prev, connected: false }));
      reconnectRef.current = setTimeout(connect, delay);
    };
  }, [sendSubscription]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setConsumerTickers = useCallback((id: string, tickers: string[]) => {
    consumersRef.current.set(id, tickers);
    sendSubscription();
  }, [sendSubscription]);

  const clearConsumer = useCallback((id: string) => {
    consumersRef.current.delete(id);
    sendSubscription();
  }, [sendSubscription]);

  const value = useMemo<MarketStreamContextValue>(
    () => ({ state, setConsumerTickers, clearConsumer }),
    [state, setConsumerTickers, clearConsumer],
  );

  return (
    <MarketStreamContext.Provider value={value}>
      {children}
    </MarketStreamContext.Provider>
  );
}

export function useMarketStreamContext(): MarketStreamContextValue {
  const ctx = useContext(MarketStreamContext);
  if (!ctx) {
    throw new Error('useMarketStream must be used within a MarketStreamProvider');
  }
  return ctx;
}
