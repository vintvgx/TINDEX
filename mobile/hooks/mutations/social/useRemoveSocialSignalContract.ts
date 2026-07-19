import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';
import { useToast } from '@/common/components/ui/Toast';

/** Dismisses a signal card — marks the tracked contract 'cancelled' rather
 *  than deleting it, matching tracked_options_contracts' existing lifecycle. */
export function useRemoveSocialSignalContract() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (contractId) => {
      const res = await fetch(`${RAILWAY_BASE_URL}/social-signals/contracts/${contractId}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to remove contract');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-signal-contracts'] });
    },
    onError: (err) => {
      // Previously swallowed silently — the card just sat there with no
      // indication of why, which read as "the app won't let me delete this."
      toast.error(err.message || 'Failed to remove contract');
    },
  });
}
