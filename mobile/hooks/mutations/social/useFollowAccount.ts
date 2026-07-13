import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';
import type { SocialSignalAccount } from '@/common/types/social';

interface FollowAccountArgs {
  handle: string;
  parse_keywords?: string[];
}

/** Follows a new X account — the backend resolves the handle via X's own
 *  lookup immediately, so a typo/nonexistent handle fails fast here rather
 *  than silently never matching a tweet. */
export function useFollowAccount() {
  const qc = useQueryClient();
  return useMutation<SocialSignalAccount, Error, FollowAccountArgs>({
    mutationFn: async ({ handle, parse_keywords }) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/social-signals/accounts`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ handle, parse_keywords }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to follow account');
      return json.data as SocialSignalAccount;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-signal-accounts'] });
    },
  });
}
