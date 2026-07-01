import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export function useGenerateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (date?: string) => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/review/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(date ? { date } : {}),
      });
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Review generation failed');
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['performance-reviews'] });
      qc.invalidateQueries({ queryKey: ['performance-review'] });
    },
  });
}
