import { useMemo } from 'react';
import { useAlpacaBothAccounts } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useAlpacaPositionValues } from '@/hooks/queries/strategy/useAlpacaPositionValues';
import { useStrategyLiveValues } from '@/hooks/queries/strategy/useStrategyLivePrice';
import { isFresh } from '@/hooks/queries/strategy/strategyLiveStore';
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';
import { isSimId } from '@/lib/devSim/simPositions';

/**
 * Live Equity for one account mode — the same figure the Positions screen
 * shows: cash (stable mid-trade, from the slow account poll) + the sum of
 * every open position's market value.
 *
 * Each position's value comes from its shared WebSocket tick (the same
 * socket a mounted position row uses — or opened here when no rows are on
 * screen, e.g. Home's account card). A position whose stream is stale or
 * not up yet falls back to the slow REST backup's broker mark. If any
 * position has neither, there is no honest live figure, so this returns the
 * broker's own equity rather than ever passing cost basis off as a mark.
 */
export function useLiveEquity(mode: 'live' | 'paper') {
  const { data: accounts } = useAlpacaBothAccounts();
  const account = accounts ? (mode === 'live' ? accounts.live : accounts.paper) : undefined;

  const { filteredPositions: allPositions } = useLivePositionsData(mode);
  // Dev simulated positions never touch the real account's equity.
  const filteredPositions = useMemo(() => allPositions.filter((p) => !isSimId(p.strategy_id)), [allPositions]);

  const strategyIds = useMemo(() => filteredPositions.map((p) => p.strategy_id), [filteredPositions]);
  const liveById = useStrategyLiveValues(strategyIds);

  // Slow backup only — shares the 'both' queryKey with useAccountValueDisplay
  // so React Query dedupes to ONE /accounts/positions poll.
  const { data: restPositions } = useAlpacaPositionValues('both', { enabled: filteredPositions.length > 0 });
  const restPriceBySymbol = useMemo(() => {
    const side = mode === 'live' ? restPositions?.live : restPositions?.paper;
    const map: Record<string, number> = {};
    for (const p of side?.positions ?? []) map[p.symbol] = p.current_price;
    return map;
  }, [restPositions, mode]);

  const liveDerivedEquity = useMemo(() => {
    if (!account?.available || filteredPositions.length === 0) return null;
    let sumMarketValue = 0;
    for (const pos of filteredPositions) {
      const snap = liveById[pos.strategy_id];
      if (isFresh(snap)) {
        sumMarketValue += snap.data.market_value;
        continue;
      }
      // Price × this position's own qty (not the broker row's market_value),
      // so two strategies holding the same contract don't double-count it.
      const restPrice = pos.contract != null ? restPriceBySymbol[pos.contract] : undefined;
      if (restPrice != null && pos.qty_remaining != null) {
        sumMarketValue += restPrice * pos.qty_remaining * 100;
        continue;
      }
      return null;
    }
    return account.cash + sumMarketValue;
  }, [account, filteredPositions, liveById, restPriceBySymbol]);

  // Any open position still waiting for its first post-background price →
  // the equity isn't real-time yet; the UI shows a skeleton instead.
  const resyncing = filteredPositions.some((p) => liveById[p.strategy_id]?.resyncing);

  return {
    account,
    liveDerivedEquity,
    resyncing,
    /** The hero number: live-derived when positions are open, else the broker's equity. */
    displayEquity: liveDerivedEquity ?? account?.equity ?? 0,
    positionCount: filteredPositions.length,
  };
}
