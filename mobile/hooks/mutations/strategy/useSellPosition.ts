import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

interface SellResult {
  status: 'ok' | 'error';
  message: string;
  qty_sold?: number;
  qty_remaining?: number;
}

/**
 * Manually sell contracts of an open position (saved strategy OR immediate trade).
 * Omit `qty` to sell the entire remaining position.
 */
export function useSellPosition() {
  const queryClient = useQueryClient();

  return useMutation<SellResult, Error, { strategyId: string; qty?: number }>({
    mutationFn: async ({ strategyId, qty }) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/positions/${strategyId}/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(qty != null ? { qty } : {}),
      });
      const json = (await res.json()) as SellResult;
      if (!res.ok || json.status !== 'ok') {
        throw new Error(json.message || 'Sell failed');
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
