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

/**
 * Fast poll of Alpaca open positions (market values updated by the broker).
 *
 * Enable this whenever the user has active ORB/0DTE positions.
 * When enabled, refetches every 5 s so the derived equity display stays current
 * without relying on the slower /accounts/both endpoint.
 *
 * When no positions are open, Alpaca returns an empty array in <100 ms — safe
 * to leave enabled at a slower interval.
 */
export function useAlpacaPositionValues(
  mode: 'paper' | 'live' | 'both' = 'both',
  options?: { enabled?: boolean; refetchIntervalMs?: number },
) {
  const { enabled = true, refetchIntervalMs } = options ?? {};

  return useQuery<AlpacaPositionsResponse>({
    queryKey: ['alpaca-position-values', mode],
    queryFn: async () => {
      const res  = await fetch(`${RAILWAY_BASE_URL}/strategy/accounts/positions?mode=${mode}`);
      const json = await res.json();
      if (!json.success) throw new Error('Failed to fetch positions');
      return json as AlpacaPositionsResponse;
    },
    enabled,
    // Explicit interval if given; otherwise 5s while positions are open
    // (equity moves), 30s when flat, off outside market hours (audit A6).
    refetchInterval: (query) => {
      if (!enabled) return false;
      if (refetchIntervalMs != null) return refetchIntervalMs;
      const d = query.state.data;
      const open = (d?.paper?.positions?.length ?? 0) + (d?.live?.positions?.length ?? 0) > 0;
      return positionPollMs({ fast: open });
    },
    staleTime:       3_000,
    retry: 1,
  });
}
