export type ContractAlertDirection = 'above' | 'below';
export type ContractAlertStatus = 'watching' | 'triggered' | 'cancelled';

/**
 * "Notify me when THIS CONTRACT's price hits $X" — set from an open
 * position's PositionInfoModal. Watched against the option's own live
 * price (ExitManager.check_price_alerts, checked every tick alongside
 * SL/TP), NOT the underlying ticker — that's watched_price_levels'
 * (see common/types/priceLevels) job instead.
 */
export interface ContractPriceAlert {
  id: string;
  user_id: string;
  strategy_id: string;
  ticker: string;
  contract_symbol: string;
  target_price: number;
  direction: ContractAlertDirection;
  status: ContractAlertStatus;
  triggered_at: string | null;
  triggered_price: number | null;
  created_at: string;
}

export interface CreateContractAlertRequest {
  userId: string;
  targetPrice: number;
}
