import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ImmediateTradeByTickerRequest } from '@/common/types/strategy';

interface ImmediateTradeResult {
  status: 'ok' | 'error' | 'stream_unavailable';
  message: string;
  contract?: string;
  qty?: number;
  trade_id?: string;
  strategy_id?: string;
  /** Only present when status is 'stream_unavailable' — the last REST-polled quote. */
  last_price?: number;
  bid?: number;
  ask?: number;
}

/**
 * Thrown instead of a plain Error when the backend couldn't get a live
 * websocket tick for a 0DTE contract within 8s (status: 'stream_unavailable').
 * Carries the last REST-polled quote so the caller can show a Blind Entry
 * confirmation (enter off that price anyway, or skip) instead of a bare
 * failure toast.
 */
export class StreamUnavailableError extends Error {
  payload: ImmediateTradeResult;
  constructor(payload: ImmediateTradeResult) {
    super(payload.message || 'Real-time stream unavailable');
    this.name = 'StreamUnavailableError';
    this.payload = payload;
  }
}

/**
 * Submit an immediate / conviction trade for ANY ticker (not tied to a saved
 * strategy). The backend creates/reuses a dedicated immediate engine for the
 * (ticker, paper/live) pair which manages the exits.
 *
 * 20-second client timeout: the backend verifies the option stream (up to 8s)
 * before placing the order, so the request can legitimately take several seconds.
 * If it hasn't resolved in 20s, surface a clear timeout error to the user.
 */
export function useImmediateTradeByTicker() {
  const queryClient = useQueryClient();

  return useMutation<ImmediateTradeResult, Error, ImmediateTradeByTickerRequest>({
    mutationFn: async (body) => {
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), 20_000);
      try {
        const res = await fetch(`${RAILWAY_BASE_URL}/strategy/immediate-trade`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
          signal:  controller.signal,
        });
        clearTimeout(timerId);
        const json = (await res.json()) as ImmediateTradeResult;
        if (json.status === 'stream_unavailable') {
          throw new StreamUnavailableError(json);
        }
        if (!res.ok || json.status !== 'ok') {
          throw new Error(json.message || 'Immediate trade failed');
        }
        return json;
      } catch (e) {
        clearTimeout(timerId);
        if (e instanceof StreamUnavailableError) throw e;
        if (e instanceof Error && e.name === 'AbortError') {
          throw new Error('Request timed out — please try again');
        }
        throw e;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['immediate-positions'] });
    },
  });
}
