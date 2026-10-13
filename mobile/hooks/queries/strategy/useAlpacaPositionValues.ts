import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { positionPollMs } from '@/lib/positionPolling';

export interface AlpacaPosition {
  symbol: string;
  qty: number;
  side: string;
  market_value: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  current_price: number;
  avg_entry_price: number;
}

export interface AlpacaPositionSide {
  available: boolean;
  positions: AlpacaPosition[];
  total_market_value: number;
  total_unrealized_pl: number;
  error?: string;
}

export interface AlpacaPositionsResponse {
  success: boolean;
  paper?: AlpacaPositionSide;
  live?: AlpacaPositionSide;
}

/** While positions are open their values stream over the shared per-position
 *  WebSocket (useStrategyLiveValues) — this poll is only the backup for a
 *  dead or stale stream, so it never needs to run faster than this. */
const WS_BACKUP_MS = 60_000;

/**
 * Alpaca open positions (market values marked by the broker).
 *
 * Live marks come from the per-position WebSocket; this is the slow REST
 * backup behind them (a stale or disconnected stream) and the authoritative
 * list of what the broker actually holds. 60s while positions are open, the
 * usual positionPollMs cadence when flat, off outside market hours. Opens and
 * closes still land immediately: /ws/app's `positions` push and
 * boostPositionPolling both invalidate this query.
 */
export function useAlpacaPositionValues(
  mode: 'paper' | 'live' | 'both' = 'both',
  options?: { enabled?: boolean },
) {
  const { enabled = true } = options ?? {};

  return useQuery<AlpacaPositionsResponse>({
    queryKey: ['alpaca-position-values', mode],
    queryFn: async () => {
      const res  = await fetch(`${RAILWAY_BASE_URL}/strategy/accounts/positions?mode=${mode}`);
      const json = await res.json();
      if (!json.success) throw new Error('Failed to fetch positions');
      return json as AlpacaPositionsResponse;
    },
    enabled,
    refetchInterval: (query) => {
      if (!enabled) return false;
      const ms = positionPollMs();
      if (ms === false) return false;
      const d = query.state.data;
      const open = (d?.paper?.positions?.length ?? 0) + (d?.live?.positions?.length ?? 0) > 0;
      return open ? Math.max(ms, WS_BACKUP_MS) : ms;
    },
    staleTime:       3_000,
    retry: 1,
  });
}
