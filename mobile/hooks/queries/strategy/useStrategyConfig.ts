import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { StrategyConfig } from '@/common/types/strategy';

export function useStrategyConfig() {
  return useQuery<StrategyConfig>({
    queryKey: ['strategy-config'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/config`);
      if (!res.ok) throw new Error('Failed to fetch strategy config');
      return res.json();
    },
    staleTime: 30_000,
    retry: 2,
  });
}
