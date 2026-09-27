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

/** Shared by the hook below and by any one-off on-demand check (e.g. Daily
 *  Review's "View Market Digest" button, which needs to know — before
 *  opening MarketDigestModal — whether a digest exists at all for a picked
 *  past date, so it can alert instead of opening to an empty state). */
export async function fetchMarketDigest(date: string): Promise<{ success: boolean; data: MarketDigestRow }> {
  const resp = await fetch(`${RAILWAY_BASE_URL}/market-digest/${date}`);
  const json = await resp.json();
  if (!resp.ok || !json.success) throw new Error(json.error ?? 'Digest not found');
  return json;
}

export function useMarketDigest(date: string | null) {
  return useQuery<{ success: boolean; data: MarketDigestRow }>({
    queryKey: ['market-digest', date],
    queryFn: () => fetchMarketDigest(date!),
    enabled: !!date,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}
