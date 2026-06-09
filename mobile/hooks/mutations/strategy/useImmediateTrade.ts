import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ImmediateTradeRequest } from '@/common/types/strategy';

interface ImmediateTradeResult {
  status: 'ok' | 'error';
  message: string;
  contract?: string;
  qty?: number;
  trade_id?: string;
}

/**
 * Submit a manual conviction trade for a user-chosen 0DTE contract. The backend
 * skips the breakout wait / sentiment / flow filters and enters immediately.
 */
export function useImmediateTrade() {
  const queryClient = useQueryClient();

  return useMutation<ImmediateTradeResult, Error, ImmediateTradeRequest>({
    mutationFn: async ({ strategyId, ...body }) => {
      const res = await fetch(
        `${RAILWAY_BASE_URL}/strategy/configs/${strategyId}/immediate-trade`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json()) as ImmediateTradeResult;
      if (!res.ok || json.status !== 'ok') {
        throw new Error(json.message || 'Immediate trade failed');
      }
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-position'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-positions'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-trades'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    },
  });
}
