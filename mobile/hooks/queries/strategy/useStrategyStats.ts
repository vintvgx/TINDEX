import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { StrategyStats, ProfileKey } from '@/common/types/strategy';

export function useStrategyStats(profile?: ProfileKey | 'ALL') {
  const params = profile && profile !== 'ALL' ? `?profile=${profile}` : '';
  return useQuery<StrategyStats>({
    queryKey: ['strategy-stats', profile],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/stats${params}`);
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
    staleTime: 60_000,
    retry: 2,
  });
}

export function useStrategyStatsByProfile() {
  return useQuery<StrategyStats[]>({
    queryKey: ['strategy-stats-by-profile'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/stats/by-profile`);
      if (!res.ok) throw new Error('Failed to fetch stats by profile');
      return res.json();
    },
    staleTime: 60_000,
    retry: 2,
  });
}
