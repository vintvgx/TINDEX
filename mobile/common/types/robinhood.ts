export type RobinhoodAuthStatus = 'ok' | 'unauthenticated' | 'mfa_required' | 'error';

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
}
