export type RobinhoodAuthStatus = 'ok' | 'unauthenticated' | 'mfa_required' | 'error';

/**
 * Cash-vs-margin breakdown — only present when Robinhood actually returns
 * usable margin figures for this account (a plain cash account has none;
 * see robinhood_service.py's _extract_margin_summary for why that's
 * surfaced as `margin: null` rather than a fake $0 block).
 */
export interface RobinhoodMarginSummary {
  day_trade_buying_power: number;
  overnight_buying_power: number;
  margin_limit: number;
  unallocated_margin_cash: number;
}

export interface RobinhoodAccountSummary {
  available: boolean;
  status?: RobinhoodAuthStatus;
  message?: string;
  equity?: number;
  cash?: number;
  buying_power?: number;
  market_value?: number;
  pnl_today?: number;
  pnl_today_pct?: number;
  is_margin_account?: boolean;
  margin?: RobinhoodMarginSummary | null;
  uncleared_deposits?: number;
  unsettled_funds?: number;
}

export interface RobinhoodHolding {
  ticker: string;
  name?: string;
  quantity: number;
  average_cost: number;
  price: number;
  market_value: number;
  unrealized_pl: number;
  unrealized_pl_pct: number;
  /** From Robinhood's fundamentals endpoint — null when Robinhood has none for this ticker. */
  sector?: string | null;
}

export interface RobinhoodEquityHistoryPoint {
  timestamp: string;
  equity: number;
}

export type RobinhoodEquityHistorySpan = 'day' | 'week' | 'month';

export interface RobinhoodEquityHistory {
  available: boolean;
  span: RobinhoodEquityHistorySpan;
  points: RobinhoodEquityHistoryPoint[];
  status?: RobinhoodAuthStatus;
  message?: string;
}

export interface RobinhoodOptionPosition {
  ticker: string;
  option_type: 'call' | 'put' | null;
  strike: number | null;
  expiration_date: string | null;
  quantity: number;
  position_type: 'long' | 'short' | string | null;
  average_price: number;
  cost_basis: number;
}
