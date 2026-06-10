import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ImmediatePosition } from '@/common/types/strategy';

interface ImmediatePositionsResponse {
  positions: ImmediatePosition[];
}

/**
 * Open positions from ad-hoc immediate trades (any ticker). Polled so the
 * "Immediate Trades" section stays current; per-position live P&L is also
 * streamed over the WS via useStrategyLivePrice(strategy_id).
 */
export function useImmediatePositions(enabled: boolean = true) {
  return useQuery<ImmediatePosition[]>({
    queryKey: ['immediate-positions'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/immediate-positions`);
      if (!res.ok) throw new Error('Failed to fetch immediate positions');
      const json = (await res.json()) as ImmediatePositionsResponse;
      return json.positions ?? [];
    },
    enabled,
    refetchInterval: 5000,
    staleTime: 2000,
  });
}
