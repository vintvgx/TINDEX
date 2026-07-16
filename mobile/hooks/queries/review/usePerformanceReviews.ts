import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { PerformanceReviewSummary, PerformanceReview } from '@/common/types/review';

/** Reviews are decoupled per account — pass `paperMode` to scope the list to
 *  one account's calendar (e.g. the ORB Daily Review's Live/Paper toggle). */
export function usePerformanceReviews(limit = 30, paperMode?: boolean) {
  return useQuery<{ success: boolean; data: PerformanceReviewSummary[]; count: number }>({
    queryKey: ['performance-reviews', limit, paperMode],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (paperMode !== undefined) params.set('paper_mode', String(paperMode));
      const resp = await fetch(`${RAILWAY_BASE_URL}/strategy/review/list?${params.toString()}`);
      if (!resp.ok) throw new Error(`Failed to fetch reviews: ${resp.statusText}`);
      return resp.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function usePerformanceReview(date: string | null, paperMode: boolean = true) {
  return useQuery<{ success: boolean; data: PerformanceReview }>({
    queryKey: ['performance-review', date, paperMode],
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/strategy/review/${date}?paper_mode=${paperMode}`);
      if (!resp.ok) throw new Error(`Failed to fetch review: ${resp.statusText}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Review not found');
      return json;
    },
    enabled: !!date,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}
