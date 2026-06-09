import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { DebugLogsResponse } from '@/common/types/strategy';

/**
 * Poll the merged ORB engine debug log. Only active (refetching) while `enabled`
 * is true — i.e. while the Debug tab is open — so it costs nothing otherwise.
 */
export function useStrategyDebugLogs(enabled: boolean) {
  return useQuery<DebugLogsResponse>({
    queryKey: ['strategy-debug-logs'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/debug-logs`);
      if (!res.ok) throw new Error('Failed to fetch debug logs');
      return res.json();
    },
    enabled,
    refetchInterval: enabled ? 2000 : false,
    staleTime: 0,
  });
}
