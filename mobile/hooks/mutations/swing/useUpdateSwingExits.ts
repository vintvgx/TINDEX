import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

interface UpdateSwingExitsPayload {
  position_id: string;
  user_id: string;
  hard_stop?: number;
  tp1_pct?: number;
  tp2_pct?: number;
}

export function useUpdateSwingExits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ position_id, ...body }: UpdateSwingExitsPayload) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/swing/positions/${position_id}/exits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to update exits');
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['swing-positions'] }),
  });
}
