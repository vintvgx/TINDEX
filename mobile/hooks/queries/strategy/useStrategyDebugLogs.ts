import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { DebugLogEntry } from '@/common/types/strategy';

/**
 * Read the persisted ORB engine debug log via the Railway API.
 * The backend queries Supabase with the service-role key, bypassing RLS so all
 * rows are visible regardless of the client's auth state.
 * Polls every 2s while the Debug tab is open.
 */
export function useStrategyDebugLogs(enabled: boolean) {
  return useQuery<DebugLogEntry[]>({
    queryKey: ['strategy-debug-logs'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/debug-logs?limit=500`);
      if (!res.ok) throw new Error('Failed to fetch debug logs');
      const json = await res.json();
      return (json.logs ?? []) as DebugLogEntry[];
    },
    enabled,
    refetchInterval: enabled ? 2000 : false,
    staleTime: 0,
  });
}
