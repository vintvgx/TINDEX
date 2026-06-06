import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ORBTrade, ProfileKey } from '@/common/types/strategy';

interface UseStrategyTradesOptions {
  limit?: number;
  ticker?: string;
  profile?: ProfileKey | 'ALL';
}

export function useStrategyTrades(options: UseStrategyTradesOptions = {}) {
  const { limit = 30, ticker, profile } = options;

  const params = new URLSearchParams({ limit: String(limit) });
  if (ticker) params.append('ticker', ticker);
  if (profile && profile !== 'ALL') params.append('profile', profile);

  return useQuery<ORBTrade[]>({
    queryKey: ['strategy-trades', limit, ticker, profile],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/trades?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch trades');
      return res.json();
    },
    staleTime: 30_000,
    retry: 2,
  });
}
