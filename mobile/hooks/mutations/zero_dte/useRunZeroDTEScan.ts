import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export function useRunZeroDTEScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/zero-dte/scan`, { method: 'POST' });
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Scan failed');
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zero-dte-watchlist'] }),
  });
}
