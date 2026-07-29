import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';

interface UpdateStrategyExitsPayload {
  strategy_id: string;
  hard_stop?: number;
  tp1?: number;
  tp2?: number;
  /** "Advanced" per-level contract counts — how many of the remaining
   *  position to sell at that level, replacing the profile's fixed close
   *  percentage. sl_qty is a one-time partial: it leaves whatever's left
   *  running unprotected rather than re-firing on the same breach. */
  sl_qty?: number;
  tp1_qty?: number;
  tp2_qty?: number;
}

export function useUpdateStrategyExits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ strategy_id, ...body }: UpdateStrategyExitsPayload) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/strategy/configs/${strategy_id}/exits`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        body: JSON.stringify(body),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json.status !== 'ok') throw new Error(json.message ?? `Request failed (${resp.status})`);
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['strategy-positions'] }),
  });
}
