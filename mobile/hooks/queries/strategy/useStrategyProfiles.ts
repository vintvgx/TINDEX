import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { StrategyProfile } from '@/common/types/strategy';

export function useStrategyProfiles() {
  return useQuery<StrategyProfile[]>({
    queryKey: ['strategy-profiles'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/profiles`);
      if (!res.ok) throw new Error('Failed to fetch profiles');
      return res.json();
    },
    staleTime: 5 * 60_000,
    retry: 2,
  });
}
