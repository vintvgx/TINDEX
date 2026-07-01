import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { PerformanceReviewSummary, PerformanceReview } from '@/common/types/review';

export function usePerformanceReviews(limit = 30) {
  return useQuery<{ success: boolean; data: PerformanceReviewSummary[]; count: number }>({
    queryKey: ['performance-reviews', limit],
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/review/list?limit=${limit}`);
      if (!resp.ok) throw new Error(`Failed to fetch reviews: ${resp.statusText}`);
      return resp.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function usePerformanceReview(date: string | null) {
  return useQuery<{ success: boolean; data: PerformanceReview }>({
    queryKey: ['performance-review', date],
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/review/${date}`);
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
