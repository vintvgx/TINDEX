import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { supabase } from '@/lib/supabase/supabase';

export const BATCH_PRICES_QUERY_KEY = 'batch_prices';

async function fetchBatchPrices(tickers: string[]): Promise<Record<string, number>> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${RAILWAY_BASE_URL}/api/prices/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ tickers }),
  });
  if (!res.ok) throw new Error(`batch prices failed: ${res.status}`);
  const json = await res.json() as { prices: Record<string, number> };
  return json.prices ?? {};
}

export function useBatchPrices(tickers: string[]) {
  const key = [...tickers].sort().join(',');
  return useQuery<Record<string, number>>({
    queryKey: [BATCH_PRICES_QUERY_KEY, key],
    queryFn: () => fetchBatchPrices(tickers),
    enabled: tickers.length > 0,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
}
