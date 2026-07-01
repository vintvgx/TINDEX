import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';

export interface TpLadderStep {
  level: string;
  pct: number;
  qty_pct: number;
  hit: boolean;
}

export interface UpdateExitsPayload {
  positionId: string;
  stop_price?: number;
  tp_ladder?: TpLadderStep[];
}

export function useUpdateZeroDTEExits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ positionId, stop_price, tp_ladder }: UpdateExitsPayload) => {
      const body: Record<string, unknown> = {};
      if (stop_price !== undefined) body.stop_price = stop_price;
      if (tp_ladder !== undefined) body.tp_ladder = tp_ladder;

      const resp = await fetch(
        `${RAILWAY_BASE_URL}/zero-dte/positions/${positionId}/exits`,
        {
          method: 'PATCH',
          headers: await getAuthHeaders(),
          body: JSON.stringify(body),
        },
      );
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to update exits');
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zero-dte-positions'] });
    },
  });
}
