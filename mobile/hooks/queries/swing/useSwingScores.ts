import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { SwingScore } from '@/common/types/swing';

interface SwingScoresResponse {
  success: boolean;
  data: SwingScore[];
  scan_date: string;
  count: number;
  error?: string;
}

export function useSwingScores(scanDate?: string) {
  return useQuery<SwingScoresResponse>({
    queryKey: ['swing-scores', scanDate ?? 'latest'],
    queryFn: async () => {
      const params = scanDate ? `?scan_date=${scanDate}` : '';
      const resp = await fetch(`${RAILWAY_BASE_URL}/swing/scores${params}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error(`Failed to fetch swing scores: ${resp.statusText}`);
      const json: SwingScoresResponse = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch swing scores');
      return json;
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
