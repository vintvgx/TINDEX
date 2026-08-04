import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

interface EnterCandidateTradeRequest {
  strategy_id: string;
  direction: 'CALL' | 'PUT';
  contract_symbol: string;
}

interface EnterCandidateTradeResult {
  status: 'ok' | 'error';
  message: string;
  contract?: string;
  qty?: number;
}

/**
 * "Enter Now" on a candidate breakout card — POSTs the chosen contract
 * (default or alt strike) to the SAME strategy engine already tracking this
 * breakout via POST /configs/<id>/immediate-trade, skipping the 3-minute
 * confirmation wait on the user's own conviction. Not the ticker-scoped
 * /strategy/immediate-trade (useImmediateTradeByTicker) — that spins up a
 * separate synthetic engine; this reuses the real strategy's own exits.
 *
 * 20-second timeout mirrors useImmediateTradeByTicker: the backend verifies
 * the option stream (up to 8s) before placing the order.
 */
export function useEnterCandidateTrade() {
  const queryClient = useQueryClient();

  return useMutation<EnterCandidateTradeResult, Error, EnterCandidateTradeRequest>({
    mutationFn: async ({ strategy_id, ...body }) => {
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), 20_000);
      try {
        const res = await fetch(`${RAILWAY_BASE_URL}/strategy/configs/${strategy_id}/immediate-trade`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timerId);
        const json = (await res.json()) as EnterCandidateTradeResult;
        if (!res.ok || json.status !== 'ok') {
          throw new Error(json.message || 'Entry failed');
        }
        return json;
      } catch (e) {
        clearTimeout(timerId);
        if (e instanceof Error && e.name === 'AbortError') {
          throw new Error('Request timed out — please try again');
        }
        throw e;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-positions'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    },
  });
}
