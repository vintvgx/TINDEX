import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ZeroDTEOpportunity } from '@/common/types/zero_dte';

export function useZeroDTEWatchlist(scanDate?: string) {
  return useQuery<ZeroDTEOpportunity[]>({
    queryKey: ['zero-dte-watchlist', scanDate],
    queryFn: async () => {
      const url = `${RAILWAY_BASE_URL}/zero-dte/watchlist${scanDate ? `?date=${scanDate}` : ''}`;
      const resp = await fetch(url);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch 0DTE watchlist');
      return json.data as ZeroDTEOpportunity[];
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });
}
