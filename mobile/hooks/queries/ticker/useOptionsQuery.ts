import { useQuery } from "@tanstack/react-query";
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { OptionsResponse } from '@/common/types/blogPosts/ticker';

/**
 * Hook to fetch options data for a ticker from /options/<ticker> endpoint
 * 
 * @param ticker - The stock ticker symbol (e.g., 'AAPL', 'IWM')
 * @returns React Query result with options data (calls and puts)
 */
export function useOptionsQuery(ticker: string) {
  return useQuery({
    queryKey: ['options', ticker],
    queryFn: async (): Promise<OptionsResponse> => {
      if (!ticker || ticker.trim().length === 0) {
        throw new Error('Ticker is required');
      }

      try {
        const apiUrl = `${RAILWAY_BASE_URL}/options/${ticker.trim().toUpperCase()}`;

        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch options data: ${response.statusText}`);
        }

        const data: OptionsResponse = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch options data');
        }

        return data;
      } catch (error) {
        console.error('Error fetching options data:', error);
        throw error;
      }
    },
    enabled: !!ticker && ticker.trim().length >= 1 && ticker.trim().length <= 5,
    staleTime: 1 * 60 * 1000, // 1 minute (options data changes frequently)
    retry: 2,
    retryDelay: 1000,
  });
}
