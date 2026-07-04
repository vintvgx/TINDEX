import { useMutation } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

interface UpdateStrategyExitsPayload {
  strategy_id: string;
  hard_stop?: number;
  tp1?: number;
  tp2?: number;
}

export function useUpdateStrategyExits() {
  return useMutation({
    mutationFn: async ({ strategy_id, ...body }: UpdateStrategyExitsPayload) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/configs/${strategy_id}/exits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (json.status !== 'ok') throw new Error(json.message ?? 'Failed to update exits');
      return json;
    },
  });
}
