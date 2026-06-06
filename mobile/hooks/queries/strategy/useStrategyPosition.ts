import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { StrategyPosition } from '@/common/types/strategy';

export function useStrategyPosition(enabled: boolean = true) {
  return useQuery<StrategyPosition>({
    queryKey: ['strategy-position'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/position`);
      if (!res.ok) throw new Error('Failed to fetch position');
      return res.json();
    },
    enabled,
    refetchInterval: 15_000,   // poll every 15 s while mounted
    staleTime: 0,
    retry: 1,
  });
}
