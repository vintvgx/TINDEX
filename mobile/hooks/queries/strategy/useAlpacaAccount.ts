import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { AlpacaAccount } from '@/common/types/strategy';

export function useAlpacaAccount(enabled: boolean = true) {
  return useQuery<AlpacaAccount>({
    queryKey: ['alpaca-account'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/account`);
      if (!res.ok) throw new Error('Failed to fetch account');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Account fetch failed');
      return json.data as AlpacaAccount;
    },
    enabled,
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: 1,
  });
}
