import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { getAuthHeaders } from '@/common/utils/api/getAuthHeaders';
import type { SwingWatchlistItem } from '@/common/types/swing';

interface SwingWatchlistResponse {
  success: boolean;
  data: SwingWatchlistItem[];
  error?: string;
}

export function useSwingWatchlist(userId: string | undefined) {
  return useQuery<SwingWatchlistResponse>({
    queryKey: ['swing-watchlist', userId],
    enabled: !!userId,
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/swing/watchlist`, {
        headers: await getAuthHeaders(),
      });
      if (!resp.ok) throw new Error(`Failed to fetch swing watchlist: ${resp.statusText}`);
      const json: SwingWatchlistResponse = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to fetch watchlist');
      return json;
    },
    staleTime: 60 * 1000,
  });
}
