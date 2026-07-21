import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

interface SellResult {
  status: 'ok' | 'error';
  message: string;
  qty_sold?: number;
  qty_remaining?: number;
  /** Actual blended fill price. Omitting a limitPrice makes the backend
   *  sample the bid and seek a good price itself (up to ~10s) rather than
   *  firing an instant market order — this is what it actually sold at. */
  avg_fill_price?: number;
}

/**
 * Manually sell contracts of an open position (saved strategy OR immediate trade).
 * Omit `qty` to sell the entire remaining position. Omit `limitPrice` to let
 * the backend seek a good price itself; supply one to use that exact price
 * instead. This call can legitimately take up to ~10s to resolve — that's
 * the backend actually trying for a good fill, not a hang.
 */
export function useSellPosition() {
  const queryClient = useQueryClient();

  return useMutation<SellResult, Error, { strategyId: string; qty?: number; limitPrice?: number }>({
    mutationFn: async ({ strategyId, qty, limitPrice }) => {
      const body: Record<string, number> = {};
      if (qty != null) body.qty = qty;
      if (limitPrice != null) body.limit_price = limitPrice;
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/positions/${strategyId}/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
