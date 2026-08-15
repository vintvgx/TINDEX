import { useEffect, useId } from 'react';
import {
  useMarketStreamContext,
  type MarketStreamState,
  type MarketSentiment,
} from '@/common/utils/context/market/MarketStreamContext';

export type { MarketStreamState, MarketSentiment };

export interface UseMarketStreamOptions {
  /** Gate the subscription entirely — this consumer's tickers are removed
   *  from the shared socket's subscription while false. Defaults to true so
   *  existing always-on callers (e.g. TickerTape) are unaffected. */
  enabled?: boolean;
}

/**
 * Subscribes this component to the single app-wide market-price WebSocket
 * (owned by MarketStreamProvider — see common/utils/context/market/
 * MarketStreamContext.tsx). Registers `tickers` as this component's
 * interest; the provider merges every currently-mounted consumer's list
 * into one subscription sent over the shared socket, so N components
 * watching overlapping tickers still cost exactly one connection instead
 * of N independent ones each reconnecting on their own schedule.
 *
 * Signature is unchanged from the old per-component-socket implementation —
 * every existing call site (TickerTape, dashboard, monitor, watchlists,
 * PriceChartFullScreen, ...) works as-is.
 *
 * @param tickers - Stock tickers this component wants live prices for
 * @param options - `enabled` to gate the subscription without unmounting
 */
export function useMarketStream(tickers: string[], options?: UseMarketStreamOptions): MarketStreamState {
  const enabled = options?.enabled ?? true;
  const { state, setConsumerTickers, clearConsumer } = useMarketStreamContext();
  const id = useId();

  // Stabilize the effect dep on content rather than array identity — callers
  // typically pass a fresh literal (e.g. ['SPY','IWM','QQQ']) every render.
  const tickersKey = tickers.join(',');

  useEffect(() => {
    if (!enabled) {
      clearConsumer(id);
      return;
    }
    setConsumerTickers(id, tickersKey ? tickersKey.split(',') : []);
    return () => clearConsumer(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled, tickersKey]);

  return state;
}
