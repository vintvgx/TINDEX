import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/supabase';
import type { DebugLogEntry } from '@/common/types/strategy';

/**
 * Read the persisted ORB engine debug log straight from Supabase (orb_debug_logs).
 * Debug logging is always on; this polls every 2s while the Debug tab is open.
 * Reading from Supabase (not the Railway API) keeps it responsive even when the
 * trade server is busy. Returns rows oldest-first (the panel reverses for display).
 */
export function useStrategyDebugLogs(enabled: boolean) {
  return useQuery<DebugLogEntry[]>({
    queryKey: ['strategy-debug-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orb_debug_logs')
        .select('*')
        .order('ts', { ascending: false })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as DebugLogEntry[]).reverse();
    },
    enabled,
    refetchInterval: enabled ? 2000 : false,
    staleTime: 0,
  });
}
