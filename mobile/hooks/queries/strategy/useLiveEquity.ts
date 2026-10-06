import { useMemo } from 'react';
import { useAlpacaBothAccounts } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useAlpacaPositionValues } from '@/hooks/queries/strategy/useAlpacaPositionValues';
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';

/**
 * Live Equity for one account mode — the same figure the Positions screen
 * shows: cash (stable mid-trade, from the slow account poll) + the sum of
 * every open position's market value. Each position's value prefers the
 * REST value (same source the Accounts screen uses), falls back to the
 * WebSocket tick (lower latency once it's ticked), and to static cost basis
 * only as the last resort before either has delivered anything.
 * Falls back to the broker's own equity figure when there are no positions.
 */
export function useLiveEquity(mode: 'live' | 'paper') {
  const { data: accounts } = useAlpacaBothAccounts();
  const account = accounts ? (mode === 'live' ? accounts.live : accounts.paper) : undefined;

  const { filteredPositions, liveByStrategy } = useLivePositionsData(mode);

  const { data: restPositions } = useAlpacaPositionValues(mode, { enabled: filteredPositions.length > 0 });
  const restMarketValueBySymbol = useMemo(() => {
    const side = mode === 'live' ? restPositions?.live : restPositions?.paper;
    const map: Record<string, number> = {};
    for (const p of side?.positions ?? []) map[p.symbol] = p.market_value;
    return map;
  }, [restPositions, mode]);

  const liveDerivedEquity = useMemo(() => {
    if (!account?.available || filteredPositions.length === 0) return null;
    let sumMarketValue = 0;
    for (const pos of filteredPositions) {
      const restValue = pos.contract != null ? restMarketValueBySymbol[pos.contract] : undefined;
      if (restValue != null) {
        sumMarketValue += restValue;
        continue;
      }
      const live = liveByStrategy[pos.strategy_id];
      if (live?.market_value != null) {
        sumMarketValue += live.market_value;
      } else if (pos.entry_premium != null && pos.qty_remaining != null) {
        sumMarketValue += pos.entry_premium * pos.qty_remaining * 100;
      }
    }
    return account.cash + sumMarketValue;
  }, [account, filteredPositions, liveByStrategy, restMarketValueBySymbol]);

  return {
    account,
    liveDerivedEquity,
    /** The hero number: live-derived when positions are open, else the broker's equity. */
    displayEquity: liveDerivedEquity ?? account?.equity ?? 0,
    positionCount: filteredPositions.length,
  };
}
