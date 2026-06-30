import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';
import type { ZeroDTEPosition } from '@/common/types/zero_dte';

export function useZeroDTEPositions(status: 'open' | 'closed' | 'all' = 'open') {
  return useQuery<ZeroDTEPosition[]>({
    queryKey: ['zero-dte-positions', status],
    queryFn: async () => {
      const resp = await fetch(
        `${RAILWAY_BASE_URL}/zero-dte/positions?status=${status}`,
        { headers: await getAuthHeaders() },
      );
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch positions');
      return json.data as ZeroDTEPosition[];
    },
    staleTime: 60 * 1000,
  });
}
