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

export interface AccountTransfer {
  id: string;
  date: string;
  amount: number;
  direction: 'deposit' | 'withdrawal';
  status: string | null;
  description: string;
}

export interface AccountTransfersResponse {
  success: boolean;
  transfers: AccountTransfer[];
  error?: string;
}

/**
 * Live-account ACH transfer history — paper accounts start with a fixed
 * virtual balance and don't take real transfers, so there's nothing to show
 * for that side (see api/routes/strategy_routes.py's get_account_transfers).
 * Changes rarely, so a longer staleTime than the balance/history polls.
 */
export function useAlpacaTransfers() {
  return useQuery<AccountTransfersResponse>({
    queryKey: ['alpaca-transfers'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/accounts/transfers`);
      const json = await res.json();
      return json as AccountTransfersResponse;
    },
    staleTime: 5 * 60_000,
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
