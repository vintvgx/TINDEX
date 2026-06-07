import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { AlpacaAccount } from '@/common/types/strategy';

export interface BothAccountsResponse {
  success: boolean;
  active_mode: boolean;  // true = paper is currently active
  paper: (AlpacaAccount & { available: boolean; error?: string });
  live:  (AlpacaAccount & { available: boolean; error?: string });
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
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: 1,
  });
}
