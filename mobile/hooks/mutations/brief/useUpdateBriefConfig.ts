import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';

/** PATCH /brief/config — the server bounds-checks every key. */
export function useUpdateBriefConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Record<string, number>) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/brief/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify(patch),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.success) throw new Error(json.error ?? `Request failed (${resp.status})`);
      return json.data as Record<string, number>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brief-config'] }),
  });
}
