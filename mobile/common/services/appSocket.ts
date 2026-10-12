import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { isMarketHours } from '@/lib/marketHours';

/**
 * The app's single push socket, /ws/app (polling audit C2).
 *
 * The backend sends "this changed" notices — {type:"invalidate", topics:[…]}
 * and Alpaca trade updates — and we refetch just those queries through the
 * normal REST endpoints. While it's connected the position/pending polls
 * drop to a slow safety net (see isAppSocketConnected / positionPollMs).
 *
 * Connected only while the app is in the foreground during market hours;
 * every (re)connect refetches everything once, to catch up on anything
 * missed while away.
 */

type Topic = 'positions' | 'account' | 'pending';

const TOPIC_KEYS: Record<Topic, readonly unknown[][]> = {
  positions: [['immediate-positions'], ['alpaca-position-values'], ['strategy-positions'], ['strategy-trades'], ['pnl-summary'], ['limit-orders']],
  account:   [['alpaca-both-accounts'], ['alpaca-account']],
  pending:   [['pending-confirmations']],
};

let connected = false;

/** True while /ws/app is open — polls use it to fall back to a slow cadence. */
export function isAppSocketConnected(): boolean {
  return connected;
}

function invalidate(qc: QueryClient, topics: Topic[]) {
  for (const t of topics) {
    for (const key of TOPIC_KEYS[t] ?? []) qc.invalidateQueries({ queryKey: key });
  }
}

const SESSION_CHECK_MS = 60_000;

/** Mount once (tabs layout). Renders nothing. */
export function AppSocketBridge() {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    let disposed = false;
    const url = RAILWAY_BASE_URL.replace(/^http/, 'ws') + '/ws/app';

    const shouldRun = () => AppState.currentState === 'active' && isMarketHours();

    const clearRetry = () => {
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    };

    const close = () => {
      clearRetry();
      const ws = wsRef.current;
      wsRef.current = null;
      connected = false;
      ws?.close();
    };

    const open = () => {
      if (disposed || wsRef.current || !shouldRun()) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        attempts.current = 0;
        connected = true;
        invalidate(qc, ['positions', 'account', 'pending']); // resync after any gap
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data));
          if (msg.type === 'invalidate' && Array.isArray(msg.topics)) invalidate(qc, msg.topics);
        } catch {
          // keepalive / malformed — ignore
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        connected = false;
        if (disposed || !shouldRun()) return;
        const delay = Math.min(2_000 * 1.6 ** attempts.current, 30_000);
        attempts.current += 1;
        clearRetry();
        retryTimer.current = setTimeout(open, delay);
      };
    };

    const sync = () => (shouldRun() ? open() : close());
    sync();
    const appStateSub = AppState.addEventListener('change', sync);
    const sessionTimer = setInterval(sync, SESSION_CHECK_MS); // open/close at the bell

    return () => {
      disposed = true;
      appStateSub.remove();
      clearInterval(sessionTimer);
      close();
    };
  }, [qc]);

  return null;
}
