import { useMemo } from 'react';
import { useAlpacaBothAccounts } from './useAlpacaAccounts';
import { useAlpacaPositionValues } from './useAlpacaPositionValues';

export interface AccountDisplayValue {
  equity: number;
  cash: number;
  buying_power: number;
  pnl_today: number;
  pnl_today_pct: number;
  day_trade_count: number;
  /** True when equity is derived from live position data rather than the slow account poll */
  live_derived: boolean;
  /** Total unrealized P&L across all open positions at this instant */
  total_unrealized_pl: number;
  available: boolean;
  error?: string;
}

export interface AccountValueDisplay {
  paper: AccountDisplayValue | null;
  live: AccountDisplayValue | null;
  /** True when at least one account has open positions */
  has_open_positions: boolean;
}

/**
 * Smart account value hook.
 *
 * Problem: /accounts/both polls every 30 s and makes two sequential Alpaca
 * REST calls. While trades are open the equity number is stale.
 *
 * Solution — split cash from position market value:
 *   displayEquity = cash + currentPositionMarketValue
 *
 * cash        → from /accounts/both (60 s poll) — stable; changes only on settlement
 * positions   → from /accounts/positions (5 s poll) — ticks with live option quotes
 *
 * When no positions are open, positions returns [] in <100 ms and we fall back
 * to the cached account equity — no wasted computation.
 */
export function useAccountValueDisplay(): AccountValueDisplay {
  // Slow: full account data (equity, cash, PnL). Increase interval — we no longer
  // depend on it for live equity when positions are open.
  const { data: accountData } = useAlpacaBothAccounts();

  // Fast: position market values. Always enabled; Alpaca returns [] quickly when empty.
  const { data: posData } = useAlpacaPositionValues('both', { refetchIntervalMs: 5_000 });

  const paper = useMemo((): AccountDisplayValue | null => {
    const acct = accountData?.paper;
    if (!acct?.available) return null;

    const pos = posData?.paper;
    const hasPositions = (pos?.positions?.length ?? 0) > 0;

    const equity = hasPositions
      ? (acct.cash ?? 0) + (pos!.total_market_value ?? 0)
      : (acct.equity ?? 0);

    return {
      equity,
      cash:                acct.cash ?? 0,
      buying_power:        acct.buying_power ?? 0,
      pnl_today:           acct.pnl_today ?? 0,
      pnl_today_pct:       acct.pnl_today_pct ?? 0,
      day_trade_count:     acct.day_trade_count ?? 0,
      live_derived:        hasPositions,
      total_unrealized_pl: pos?.total_unrealized_pl ?? 0,
      available:           true,
    };
  }, [accountData, posData]);

  const live = useMemo((): AccountDisplayValue | null => {
    const acct = accountData?.live;
    if (!acct?.available) return null;

    const pos = posData?.live;
    const hasPositions = (pos?.positions?.length ?? 0) > 0;

    const equity = hasPositions
      ? (acct.cash ?? 0) + (pos!.total_market_value ?? 0)
      : (acct.equity ?? 0);

    return {
      equity,
      cash:                acct.cash ?? 0,
      buying_power:        acct.buying_power ?? 0,
      pnl_today:           acct.pnl_today ?? 0,
      pnl_today_pct:       acct.pnl_today_pct ?? 0,
      day_trade_count:     acct.day_trade_count ?? 0,
      live_derived:        hasPositions,
      total_unrealized_pl: pos?.total_unrealized_pl ?? 0,
      available:           true,
    };
  }, [accountData, posData]);

  const has_open_positions =
    (posData?.paper?.positions?.length ?? 0) > 0 ||
    (posData?.live?.positions?.length  ?? 0) > 0;

  return { paper, live, has_open_positions };
}
