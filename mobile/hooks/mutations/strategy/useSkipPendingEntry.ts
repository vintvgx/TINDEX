import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';

interface SkipPendingEntryPayload {
  strategy_id: string;
  pending_id: string;
}

export function useSkipPendingEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ strategy_id, pending_id }: SkipPendingEntryPayload) => {
      const resp = await fetch(
        `${RAILWAY_BASE_URL}/strategy/configs/${strategy_id}/pending/${pending_id}/skip`,
        { method: 'POST', headers: await getAuthHeaders() },
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json.status !== 'ok') throw new Error(json.message ?? `Request failed (${resp.status})`);
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-confirmations'] }),
  });
}
