import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ImmediatePosition } from '@/common/types/strategy';
import { positionPollMs } from '@/lib/positionPolling';

interface ImmediatePositionsResponse {
  positions: ImmediatePosition[];
}

/**
 * Open positions from ad-hoc immediate trades (any ticker). Polled so the
 * "Immediate Trades" section stays current; per-position live P&L is
 * streamed over the WS via useStrategyLivePrice(strategy_id), so this only
 * has to catch opens/closes — 30s, 5s right after a trade, off outside
 * market hours (see positionPollMs).
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
    refetchInterval: () => positionPollMs(),
    staleTime: 2000,
  });
}
