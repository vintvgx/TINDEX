import { useMutation, useQueryClient } from '@tanstack/react-query';
import { boostPositionPolling } from '@/lib/positionPolling';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

interface SellResult {
  status: 'ok' | 'error' | 'accepted' | 'pending';
  /** Async sells (B2): the id to poll for the outcome. */
  sell_id?: string;
  message: string;
  qty_sold?: number;
  qty_remaining?: number;
  /** Actual blended fill price. Omitting a limitPrice makes the backend
   *  sample the bid and seek a good price itself (up to ~10s) rather than
   *  firing an instant market order — this is what it actually sold at. */
  avg_fill_price?: number;
  /** Dollar P&L for just this sell — (avg_fill_price - entry_premium) * qty_sold
   *  * 100. Reflects this trade's actual cost basis (post any add_to_position
   *  blending), not just this partial fill's own premium delta. */
  pnl?: number;
}

/**
 * Manually sell contracts of an open position (saved strategy OR immediate trade).
 * Omit `qty` to sell the entire remaining position. Omit `limitPrice` to let
 * the backend seek a good price itself; supply one to use that exact price
 * instead. This call can legitimately take up to ~10s to resolve — that's
 * the backend actually trying for a good fill, not a hang.
 *
 * 30-second timeout (2026-08-09 fix — same AbortController pattern as
 * useEnterCandidateTrade, just not previously applied here): without a
 * ceiling, a dropped connection or a request stuck in flight while the app
 * backgrounds mid-sell left this promise permanently unsettled — neither
 * onSuccess nor onError ever fired, so the ticker tape's "Selling…" status
 * (see useSellStatus/TickerTape) had nothing to transition it to "Sold…" or
 * clear it, and stayed hijacked indefinitely instead of reverting to prices.
 */
const SELL_TIMEOUT_MS = 45_000;
const SELL_POLL_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Async sell (polling audit B2): the backend reserves the contracts and
 * answers 202 at once instead of holding a server thread for its ~10s
 * price-seek; we poll the outcome here. The resolved value is the same
 * result dict the old synchronous call returned, so callers don't change.
 * An older backend that ignores `async` just answers 200 with the final
 * result — handled the same way.
 */
async function pollSellOutcome(strategyId: string, sellId: string, deadline: number): Promise<SellResult> {
  while (Date.now() < deadline) {
    await sleep(SELL_POLL_MS);
    try {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/positions/${strategyId}/sell/${sellId}`);
      if (!res.ok) continue;            // transient — keep trying until the deadline
      const json = (await res.json()) as SellResult;
      if (json.status === 'pending') continue;
      return json;
    } catch {
      // network blip — keep polling
    }
  }
  throw new Error('Request timed out — check your position, it may still have gone through');
}

export function useSellPosition() {
  const queryClient = useQueryClient();

  return useMutation<SellResult, Error, { strategyId: string; qty?: number; limitPrice?: number }>({
    mutationFn: async ({ strategyId, qty, limitPrice }) => {
      const body: Record<string, number | boolean> = { async: true };
      if (qty != null) body.qty = qty;
      if (limitPrice != null) body.limit_price = limitPrice;
      const deadline = Date.now() + SELL_TIMEOUT_MS;
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(`${RAILWAY_BASE_URL}/strategy/positions/${strategyId}/sell`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timerId);
        let json = (await res.json()) as SellResult;
        if (res.status === 202 && json.status === 'accepted' && json.sell_id) {
          json = await pollSellOutcome(strategyId, json.sell_id, deadline);
          if (json.status !== 'ok') throw new Error(json.message || 'Sell failed');
          return json;
        }
        if (!res.ok || json.status !== 'ok') {
          throw new Error(json.message || 'Sell failed');
        }
        return json;
      } catch (e) {
        clearTimeout(timerId);
        if (e instanceof Error && e.name === 'AbortError') {
          throw new Error('Request timed out — check your position, it may still have gone through');
        }
        throw e;
      }
    },
    onSuccess: () => {
      boostPositionPolling(queryClient); // show the close fast (audit A6)
      queryClient.invalidateQueries({ queryKey: ['strategy-position'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-positions'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
      queryClient.invalidateQueries({ queryKey: ['strategy-trades'] });
      queryClient.invalidateQueries({ queryKey: ['pnl-summary'] });
      queryClient.invalidateQueries({ queryKey: ['immediate-positions'] });
    },
  });
}
