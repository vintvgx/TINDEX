import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';

interface UpdateStrategyExitsPayload {
  strategy_id: string;
  hard_stop?: number;
  tp1?: number;
  tp2?: number;
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
