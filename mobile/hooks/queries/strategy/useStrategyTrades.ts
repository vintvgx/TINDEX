import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ORBTrade, ProfileKey } from '@/common/types/strategy';

interface UseStrategyTradesOptions {
  limit?: number;
  ticker?: string;
  profile?: ProfileKey | 'ALL';
  trade_date?: string | null;  // "YYYY-MM-DD" or null for all dates
}

export function useStrategyTrades(options: UseStrategyTradesOptions = {}) {
  const { limit = 30, ticker, profile, trade_date } = options;

  const params = new URLSearchParams({ limit: String(limit) });
  if (ticker) params.append('ticker', ticker);
  if (profile && profile !== 'ALL') params.append('profile', profile);
  if (trade_date) params.append('trade_date', trade_date);

  return useQuery<ORBTrade[]>({
    queryKey: ['strategy-trades', limit, ticker, profile, trade_date],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/trades?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch trades');
      return res.json();
    },
    staleTime: 30_000,
    retry: 2,
  });
}
