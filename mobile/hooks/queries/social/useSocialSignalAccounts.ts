import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { loggedFetch } from '@/lib/loggedFetch';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';
import type { SocialSignalAccount } from '@/common/types/social';

/** Accounts the current user follows — the backend now scopes this per-user
 *  (previously it returned the whole global registry to anyone). */
export function useSocialSignalAccounts() {
  return useQuery<SocialSignalAccount[]>({
    queryKey: ['social-signal-accounts'],
    queryFn: async () => {
      const res = await loggedFetch(`${RAILWAY_BASE_URL}/social-signals/accounts`, {
        headers: await getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to fetch followed accounts (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch followed accounts');
      return json.data as SocialSignalAccount[];
    },
    staleTime: 30_000,
    retry: 1,
  });
}
