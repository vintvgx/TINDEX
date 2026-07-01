import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface SpotPrice {
  price: number;
  open: number;
  change_pct: number;
  vwap: number;
  above_vwap: boolean;
}

export function useZeroDTESpotPrices(tickers: string[]) {
  const enabled = tickers.length > 0;
  return useQuery<Record<string, SpotPrice | null>>({
    queryKey: ['zero-dte-spot', tickers.join(',')],
    queryFn: async () => {
      const resp = await fetch(
        `${RAILWAY_BASE_URL}/zero-dte/spot?tickers=${tickers.join(',')}`,
      );
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch spot prices');
      return json.data as Record<string, SpotPrice | null>;
    },
    enabled,
    staleTime: 25 * 1000,
    refetchInterval: 30 * 1000,
  });
}
