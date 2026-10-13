import { useEffect, useMemo, useRef } from 'react';
import { useAlpacaBothAccounts } from './useAlpacaAccounts';
import { useAlpacaPositionValues, type AlpacaPositionSide } from './useAlpacaPositionValues';
import { useStrategyLiveValues } from './useStrategyLivePrice';
import { isFresh, type LiveSnapshot } from './strategyLiveStore';
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';
import type { PositionEntry } from './useStrategyPosition';
import { isSimId } from '@/lib/devSim/simPositions';

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
  /** Non-marginable buying power — actual unlevered spending power. */
  available_balance: number;
  options_buying_power: number;
  long_market_value: number;
  short_market_value: number;
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
 * positions   → the shared per-position WebSocket marks (see markSide), over
 *               /accounts/positions (60 s backup poll) as the list of what
 *               the broker actually holds
 *
 * When no positions are open, positions returns [] in <100 ms and we fall back
 * to the cached account equity — no wasted computation.
 *
 * Transition skew: cash and position market value are polled on different clocks,
 * so right after an open or close the two are briefly inconsistent (cash lags by
 * up to one slow-poll interval). We mitigate by force-refetching the account poll
 * the moment the open-position count changes, re-syncing cash within ~1 round trip.
 */
/**
 * Total market value + unrealized P&L for one account's broker positions,
 * with each contract re-marked from the live WS ticks when they fully cover
 * it: every strategy position on that contract has a fresh tick and their
 * qty adds up to what the broker holds. Anything else (a stale stream, a
 * position no strategy tracks, a partial fill mid-sync) keeps the broker's
 * own REST mark.
 */
function markSide(
  side: AlpacaPositionSide | undefined,
  positions: PositionEntry[],
  liveById: Record<string, LiveSnapshot>,
): { total_market_value: number; total_unrealized_pl: number } {
  const byContract = new Map<string, PositionEntry[]>();
  for (const p of positions) {
    // Dev simulated positions never touch the real account.
    if (!p.contract || isSimId(p.strategy_id)) continue;
    byContract.set(p.contract, [...(byContract.get(p.contract) ?? []), p]);
  }

  let total_market_value = 0;
  let total_unrealized_pl = 0;
  for (const row of side?.positions ?? []) {
    const holders = byContract.get(row.symbol) ?? [];
    const snaps = holders.map((p) => liveById[p.strategy_id]);
    const covered =
      holders.length > 0 &&
      snaps.every(isFresh) &&
      snaps.reduce((n, s) => n + (s?.data?.qty_remaining ?? 0), 0) === Math.abs(row.qty);
    if (covered) {
      for (const s of snaps) {
        total_market_value += s!.data!.market_value;
        total_unrealized_pl += s!.data!.pnl;
      }
    } else {
      total_market_value += row.market_value;
      total_unrealized_pl += row.unrealized_pl;
    }
  }
  return { total_market_value, total_unrealized_pl };
}

export function useAccountValueDisplay(): AccountValueDisplay {
  // Slow: full account data (equity, cash, PnL). Increase interval — we no longer
  // depend on it for live equity when positions are open.
  const { data: accountData, refetch: refetchAccount } = useAlpacaBothAccounts();

  // What the broker holds + its own marks — a 60s backup while positions are
  // open (useAlpacaPositionValues); the live marks come from the WS below.
  const { data: posData } = useAlpacaPositionValues('both');

  const livePositions = useLivePositionsData('live').filteredPositions;
  const paperPositions = useLivePositionsData('paper').filteredPositions;
  const strategyIds = useMemo(
    () => [...livePositions, ...paperPositions].map((p) => p.strategy_id),
    [livePositions, paperPositions],
  );
  const liveById = useStrategyLiveValues(strategyIds);
  const paperMarks = useMemo(
    () => markSide(posData?.paper, paperPositions, liveById),
    [posData, paperPositions, liveById],
  );
  const liveMarks = useMemo(
    () => markSide(posData?.live, livePositions, liveById),
    [posData, livePositions, liveById],
  );

  // Re-sync cash immediately when a position is opened or closed, so the
  // cash + market_value formula doesn't show a stale equity during the transition.
  const prevCount = useRef<number | null>(null);
  const positionCount =
    (posData?.paper?.positions?.length ?? 0) + (posData?.live?.positions?.length ?? 0);
  useEffect(() => {
    if (prevCount.current !== null && prevCount.current !== positionCount) {
      refetchAccount();
    }
    prevCount.current = positionCount;
  }, [positionCount, refetchAccount]);

  const paper = useMemo((): AccountDisplayValue | null => {
    const acct = accountData?.paper;
    if (!acct?.available) return null;

    const pos = posData?.paper;
    const hasPositions = (pos?.positions?.length ?? 0) > 0;

    const equity = hasPositions
      ? (acct.cash ?? 0) + paperMarks.total_market_value
      : (acct.equity ?? 0);

    return {
      equity,
      cash:                acct.cash ?? 0,
      buying_power:        acct.buying_power ?? 0,
      pnl_today:           acct.pnl_today ?? 0,
      pnl_today_pct:       acct.pnl_today_pct ?? 0,
      day_trade_count:     acct.day_trade_count ?? 0,
      live_derived:        hasPositions,
      total_unrealized_pl: paperMarks.total_unrealized_pl,
      available_balance:    acct.available_balance ?? 0,
      options_buying_power: acct.options_buying_power ?? 0,
      long_market_value:    acct.long_market_value ?? 0,
      short_market_value:   acct.short_market_value ?? 0,
      available:           true,
    };
  }, [accountData, posData, paperMarks]);

  const live = useMemo((): AccountDisplayValue | null => {
    const acct = accountData?.live;
    if (!acct?.available) return null;

    const pos = posData?.live;
    const hasPositions = (pos?.positions?.length ?? 0) > 0;

    const equity = hasPositions
      ? (acct.cash ?? 0) + liveMarks.total_market_value
      : (acct.equity ?? 0);

    return {
      equity,
      cash:                acct.cash ?? 0,
      buying_power:        acct.buying_power ?? 0,
      pnl_today:           acct.pnl_today ?? 0,
      pnl_today_pct:       acct.pnl_today_pct ?? 0,
      day_trade_count:     acct.day_trade_count ?? 0,
      live_derived:        hasPositions,
      total_unrealized_pl: liveMarks.total_unrealized_pl,
      available_balance:    acct.available_balance ?? 0,
      options_buying_power: acct.options_buying_power ?? 0,
      long_market_value:    acct.long_market_value ?? 0,
      short_market_value:   acct.short_market_value ?? 0,
      available:           true,
    };
  }, [accountData, posData, liveMarks]);

  const has_open_positions =
    (posData?.paper?.positions?.length ?? 0) > 0 ||
    (posData?.live?.positions?.length  ?? 0) > 0;

  return { paper, live, has_open_positions };
}
