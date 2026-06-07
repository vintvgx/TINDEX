import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { StrategyConfig } from '@/common/types/strategy';

export function useStrategyConfigs() {
  return useQuery<StrategyConfig[]>({
    queryKey: ['strategy-configs'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/configs`);
      if (!res.ok) throw new Error('Failed to fetch strategy configs');
      return res.json();
    },
    staleTime: 30_000,
    retry: 2,
  });
}
