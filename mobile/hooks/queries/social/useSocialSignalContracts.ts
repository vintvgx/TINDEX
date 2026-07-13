import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { loggedFetch } from '@/lib/loggedFetch';
import type { SocialSignalContract } from '@/common/types/social';

/** Durable fallback for card data (entry price, status, tweet attribution) —
 *  the WS (useSocialSignalsSocket) layers live mid-price on top while a card
 *  is actually on screen; this poll keeps working even if the WS is down. */
export function useSocialSignalContracts() {
  return useQuery<SocialSignalContract[]>({
    queryKey: ['social-signal-contracts'],
    queryFn: async () => {
      const res = await loggedFetch(`${RAILWAY_BASE_URL}/social-signals/contracts`);
      if (!res.ok) throw new Error(`Failed to fetch tracked contracts (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch tracked contracts');
      return json.data as SocialSignalContract[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
}
