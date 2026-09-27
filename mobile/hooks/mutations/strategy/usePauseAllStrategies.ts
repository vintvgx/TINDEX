import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export type KillSwitchScope = 'paper' | 'live' | 'all';

interface PauseAllRequest {
  scope: KillSwitchScope;
  active: boolean; // false = pause, true = resume
}

interface PauseAllResponse {
  status: string;
  scope: KillSwitchScope;
  active: boolean;
  strategy_ids: string[];
}

/**
 * Bulk kill switch — pause or resume every strategy config matching scope
 * in one call. See POST /strategy/configs/pause-all.
 */
export function usePauseAllStrategies() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ scope, active }: PauseAllRequest): Promise<PauseAllResponse> => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/configs/pause-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, active }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update strategies');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    },
  });
}
