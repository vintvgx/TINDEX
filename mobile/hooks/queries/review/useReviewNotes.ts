import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ReviewNotesResponse } from '@/common/types/reviewNotes';

interface ReviewNotesFilter {
  startDate?: string;
  endDate?: string;
  kind?: 'note' | 'todo';
  done?: boolean;
}

/**
 * All review notes/todos matching the given filter — unfiltered by default
 * so the Daily Review calendar can compute dot indicators for every visible
 * month and the backlog screen can filter/sort client-side without refetching
 * per filter change. See useReviewNoteMutations for create/update/delete.
 */
export function useReviewNotes(filter: ReviewNotesFilter = {}) {
  const { startDate, endDate, kind, done } = filter;
  return useQuery<ReviewNotesResponse>({
    queryKey: ['review-notes', startDate, endDate, kind, done],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);
      if (kind) params.set('kind', kind);
      if (done !== undefined) params.set('done', String(done));
      const qs = params.toString();
      const resp = await fetch(`${RAILWAY_BASE_URL}/review/notes${qs ? `?${qs}` : ''}`);
      if (!resp.ok) throw new Error(`Failed to fetch review notes: ${resp.statusText}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch review notes');
      return json;
    },
    staleTime: 60 * 1000,
  });
}
