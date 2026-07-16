import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { loggedFetch } from '@/lib/loggedFetch';
import type { XApiUsageEstimate } from '@/common/types/social';

/** Self-tracked X API spend estimate — X has no public endpoint for the
 *  actual $ credit balance (only the Developer Console shows that). See
 *  docs/features/social-signal-contracts.md, "X balance display". */
export function useXApiUsage() {
  return useQuery<XApiUsageEstimate>({
    queryKey: ['x-api-usage'],
    queryFn: async () => {
      const res = await loggedFetch(`${RAILWAY_BASE_URL}/social-signals/usage`);
      if (!res.ok) throw new Error(`Failed to fetch usage estimate (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch usage estimate');
      return json.data as XApiUsageEstimate;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });
}
