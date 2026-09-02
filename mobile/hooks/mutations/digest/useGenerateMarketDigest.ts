import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';

export function useGenerateMarketDigest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (date?: string) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/market-digest/generate`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify(date ? { date } : {}),
      });
      const text = await resp.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Server error (${resp.status}): response was not JSON`);
      }
      if (!json.success) throw new Error((json.error as string) ?? 'Digest generation failed');
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['market-digests'] });
      qc.invalidateQueries({ queryKey: ['market-digest'] });
    },
  });
}
