import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ImmediateTradeByTickerRequest } from '@/common/types/strategy';

interface ImmediateTradeResult {
  status: 'ok' | 'error';
  message: string;
  contract?: string;
  qty?: number;
  trade_id?: string;
  strategy_id?: string;
}

/**
 * Submit an immediate / conviction trade for ANY ticker (not tied to a saved
 * strategy). The backend creates/reuses a dedicated immediate engine for the
 * (ticker, paper/live) pair which manages the exits.
 */
export function useImmediateTradeByTicker() {
  const queryClient = useQueryClient();

  return useMutation<ImmediateTradeResult, Error, ImmediateTradeByTickerRequest>({
    mutationFn: async (body) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/immediate-trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as ImmediateTradeResult;
      if (!res.ok || json.status !== 'ok') {
        throw new Error(json.message || 'Immediate trade failed');
      }
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['immediate-positions'] });
    },
  });
}
