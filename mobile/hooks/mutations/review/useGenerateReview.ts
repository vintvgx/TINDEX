import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';

interface GenerateReviewArgs {
  date?: string;
  /** Which account to generate the review for — reviews are fully decoupled
   *  per account, so this always targets exactly one. Defaults to true (paper). */
  paperMode?: boolean;
}

export function useGenerateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args?: string | GenerateReviewArgs) => {
      // Back-compat: a bare date string still works (defaults to paper).
      const { date, paperMode = true } = typeof args === 'string' ? { date: args, paperMode: true } : (args ?? {});
      const resp = await fetch(`${RAILWAY_BASE_URL}/strategy/review/generate`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ ...(date ? { date } : {}), paper_mode: paperMode }),
      });
      const text = await resp.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Server error (${resp.status}): response was not JSON`);
      }
      if (!json.success) throw new Error((json.error as string) ?? 'Review generation failed');
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['performance-reviews'] });
      qc.invalidateQueries({ queryKey: ['performance-review'] });
    },
  });
}
