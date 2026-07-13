export interface SocialSignalAccount {
  id: string;
  handle: string;
  label: string | null;
  active: boolean;
  parse_keywords: string[];
  last_seen_tweet_id: string | null;
  last_polled_at: string | null;
  created_at: string;
}

export interface SocialSignalContract {
  id: string;
  user_id: string;
  ticker: string;
  contract_symbol: string;
  option_type: 'CALL' | 'PUT';
  strike: number;
  expiration_date: string;
  status: 'tracking' | 'entered' | 'exited' | 'expired' | 'cancelled';
  tracked_entry_price: number | null;
  current_price: number | null;
  price_change_pct: number | null;
  tracking_reason: string | null;
  tracking_snapshot: {
    source?: string;
    parser?: string;
    account_handle?: string;
    tweet_id?: string;
    tweet_url?: string;
    parse_method?: string;
  } | null;
  created_at: string;
}

export interface XApiUsageEstimate {
  estimated_spend_today_usd: number;
  estimated_spend_month_usd: number;
  posts_read_month: number;
  user_read_month: number;
  unit_costs: { posts_read: number; user_read: number };
  console_url: string;
  note: string;
}
