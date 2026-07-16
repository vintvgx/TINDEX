import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { AlpacaAccount } from '@/common/types/strategy';

export interface BothAccountsResponse {
  success: boolean;
  active_mode: boolean;  // true = paper is currently active
  paper: (AlpacaAccount & { available: boolean; error?: string });
  live:  (AlpacaAccount & { available: boolean; error?: string });
}

export interface AccountHistoryEntry {
  available: boolean;
  equity?: number;
  pnl_today?: number;
  pnl_today_pct?: number;
  pnl_week?: number | null;
  pnl_week_pct?: number | null;
  pnl_month?: number | null;
  pnl_month_pct?: number | null;
  pnl_ytd?: number | null;
  pnl_ytd_pct?: number | null;
  pnl_all_time?: number | null;
  pnl_all_time_pct?: number | null;
  total_deposited?: number;
  total_withdrawn?: number;
  net_contributions?: number;
  paper_mode?: boolean;
  error?: string;
}

export interface AccountsHistoryResponse {
  success: boolean;
  paper: AccountHistoryEntry;
  live: AccountHistoryEntry;
}

export function useAlpacaBothAccounts(enabled: boolean = true) {
  return useQuery<BothAccountsResponse>({
    queryKey: ['alpaca-both-accounts'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/accounts/both`);
      if (!res.ok) throw new Error('Failed to fetch accounts');
      const json = await res.json();
      if (!json.success) throw new Error('Accounts fetch failed');
      return json as BothAccountsResponse;
    },
    enabled,
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: 1,
  });
}

export function useAlpacaAccountsHistory() {
  return useQuery<AccountsHistoryResponse>({
    queryKey: ['alpaca-accounts-history'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/accounts/history`);
      if (!res.ok) throw new Error('Failed to fetch account history');
      const json = await res.json();
      if (!json.success) throw new Error('Account history fetch failed');
      return json as AccountsHistoryResponse;
    },
    refetchInterval: 60_000,
    staleTime: 50_000,
    retry: 1,
  });
}
