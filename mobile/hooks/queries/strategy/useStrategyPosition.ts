import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { StrategyPosition } from '@/common/types/strategy';

export type PositionEntry = StrategyPosition & { strategy_id: string; strategy_name: string };

export function useStrategyPositions(enabled: boolean = true) {
  return useQuery<PositionEntry[]>({
    queryKey: ['strategy-positions'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/positions`);
      if (!res.ok) throw new Error('Failed to fetch positions');
      return res.json();
    },
    enabled,
    refetchInterval: 15_000,
    staleTime: 0,
    retry: 1,
  });
}
