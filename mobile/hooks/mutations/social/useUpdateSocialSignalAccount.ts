import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';
import type { SocialSignalAccount } from '@/common/types/social';

interface UpdateAccountArgs {
  id: string;
  active?: boolean;
  parse_keywords?: string[];
}

export function useUpdateSocialSignalAccount() {
  const qc = useQueryClient();
  return useMutation<SocialSignalAccount, Error, UpdateAccountArgs>({
    mutationFn: async ({ id, ...patch }) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/social-signals/accounts/${id}`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to update account');
      return json.data as SocialSignalAccount;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-signal-accounts'] });
    },
  });
}

export function useUnfollowAccount() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/social-signals/accounts/${id}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to unfollow account');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-signal-accounts'] });
    },
  });
}
