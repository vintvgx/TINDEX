import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

interface AddToPositionResult {
  status: 'ok' | 'error';
  message: string;
  qty_added?: number;
  fill_price?: number;
  new_entry_premium?: number;
  qty_remaining?: number;
}

/**
 * Buy more of an open position's contract to average down/up (saved strategy
 * OR immediate trade, live or paper). Server recomputes entry_premium as the
 * qty-weighted blend of old + new fills, and re-derives hard_stop/tp1/tp2 from
 * that blended price using the position's existing profile.
 */
export function useAddToPosition() {
  const queryClient = useQueryClient();

  return useMutation<AddToPositionResult, Error, { strategyId: string; qty: number }>({
    mutationFn: async ({ strategyId, qty }) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/positions/${strategyId}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty }),
      });
      const json = (await res.json()) as AddToPositionResult;
      if (!res.ok || json.status !== 'ok') {
        throw new Error(json.message || 'Add to position failed');
      }
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-position'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-positions'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-trades'] });
      queryClient.invalidateQueries({ queryKey: ['immediate-positions'] });
    },
  });
}
