import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { MarketDigestRow } from '@/common/types/marketDigest';

/** Recent digest dates only (no content_json) — for a calendar-style list,
 *  mirroring usePerformanceReviews' list/detail split. */
export function useMarketDigestList(limit = 30) {
  return useQuery<{ success: boolean; data: Array<{ digest_date: string; created_at: string }>; count: number }>({
    queryKey: ['market-digests', limit],
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/market-digest/list?limit=${limit}`);
      if (!resp.ok) throw new Error(`Failed to fetch digests: ${resp.statusText}`);
      return resp.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function useMarketDigest(date: string | null) {
  return useQuery<{ success: boolean; data: MarketDigestRow }>({
    queryKey: ['market-digest', date],
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/market-digest/${date}`);
      const json = await resp.json();
      if (!resp.ok || !json.success) throw new Error(json.error ?? 'Digest not found');
      return json;
    },
    enabled: !!date,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}
