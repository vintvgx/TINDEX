import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { SwingPosition } from '@/common/types/swing';

interface SwingPositionsResponse {
  success: boolean;
  data: SwingPosition[];
  error?: string;
}

export function useSwingPositions(userId: string | undefined) {
  return useQuery<SwingPositionsResponse>({
    queryKey: ['swing-positions', userId],
    enabled: !!userId,
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/swing/positions?user_id=${userId}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error(`Failed to fetch swing positions: ${resp.statusText}`);
      const json: SwingPositionsResponse = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch positions');
      return json;
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}
