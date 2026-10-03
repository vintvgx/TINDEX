import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { BriefConfig, BriefReview } from '@/common/types/morningBrief';

async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${RAILWAY_BASE_URL}${path}`);
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.success) throw new Error(json.error ?? `Request failed (${resp.status})`);
  return json.data;
}

/** Paper-testing review for [start, end] (YYYY-MM-DD, ET dates). */
export function useBriefReview(start: string, end: string, paperOnly = true, enabled = true) {
  return useQuery<BriefReview>({
    queryKey: ['brief-review', start, end, paperOnly],
    queryFn: () => getJson(`/brief/review?start=${start}&end=${end}&paper=${paperOnly ? 1 : 0}`),
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useBriefConfig(enabled = true) {
  return useQuery<BriefConfig>({
    queryKey: ['brief-config'],
    queryFn: () => getJson('/brief/config'),
    enabled,
    staleTime: 60 * 1000,
  });
}
