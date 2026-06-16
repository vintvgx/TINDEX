import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

interface DebugModeResult {
  status: string;
  debug_enabled: boolean;
}

/**
 * Global debug switch — turns ORB engine decision-logging on/off for every engine
 * (saved strategies + ad-hoc immediate engines) at once and keeps it that way.
 */
export function useSetStrategyDebugMode() {
  const queryClient = useQueryClient();

  return useMutation<DebugModeResult, Error, boolean>({
    mutationFn: async (enabled) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/debug-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Failed to set debug mode');
      return res.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-debug-logs'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    },
  });
}
