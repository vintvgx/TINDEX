export interface PlaidLinkTokenResponse {
  link_token: string;
  expiration: string;
  request_id: string;
}

export interface PlaidAccountMetadata {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
}

export interface PlaidExchangeTokenRequest {
  public_token: string;
  institution_id: string;
  institution_name: string;
  accounts: PlaidAccountMetadata[];
}

export interface PlaidExchangeTokenResponse {
  item_id: string;
  institution_name: string;
  accounts: PlaidLinkedAccount[];
}

export interface PlaidLinkedAccount {
  id: string;
  item_id: string;
  user_id: string;
  institution_id: string;
  institution_name: string;
  account_id: string;
  account_name: string;
  account_type: string;
  account_subtype: string | null;
  created_at: string;
  updated_at: string;
}

export type PlaidSecurityType =
  | 'cash'
  | 'cryptocurrency'
  | 'derivative'
  | 'equity'
  | 'etf'
  | 'fixed income'
  | 'loan'
  | 'mutual fund'
  | 'other';

export interface PlaidSecurity {
  security_id: string;
  isin: string | null;
  cusip: string | null;
  name: string | null;
  ticker_symbol: string | null;
  is_cash_equivalent: boolean;
  type: PlaidSecurityType;
  close_price: number | null;
  close_price_as_of: string | null;
  iso_currency_code: string | null;
}

export interface PlaidHolding {
  account_id: string;
  security_id: string;
  institution_price: number;
  institution_price_as_of: string | null;
  institution_value: number;
  cost_basis: number | null;
  quantity: number;
  iso_currency_code: string | null;
}

export interface PlaidAccountDetail {
  account_id: string;
  balances: {
    available: number | null;
    current: number | null;
    limit: number | null;
    iso_currency_code: string | null;
  };
  mask: string | null;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
}

export interface PlaidHoldingsResponse {
  holdings: PlaidHolding[];
  securities: PlaidSecurity[];
  accounts: PlaidAccountDetail[];
}

export type PlaidInvestmentTransactionType =
  | 'buy'
  | 'sell'
  | 'cancel'
  | 'cash'
  | 'fee'
  | 'transfer';

export interface PlaidInvestmentTransaction {
  investment_transaction_id: string;
  account_id: string;
  security_id: string | null;
  date: string;
  name: string;
  quantity: number;
  amount: number;
  price: number;
  fees: number | null;
  type: PlaidInvestmentTransactionType;
  subtype: string;
  iso_currency_code: string | null;
}

export interface PlaidInvestmentTransactionsResponse {
  investment_transactions: PlaidInvestmentTransaction[];
  securities: PlaidSecurity[];
  accounts: PlaidAccountDetail[];
  total_investment_transactions: number;
}
