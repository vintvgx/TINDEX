import { useQuery } from "@tanstack/react-query";
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { OptionsResponse } from '@/common/types/blogPosts/ticker';

export interface OptionsQueryParams {
  limit?: number;
  strike_price_gte?: number;
  strike_price_lte?: number;
  expiration_date_gte?: string; // Format: 'YYYY-MM-DD'
  expiration_date_lte?: string; // Format: 'YYYY-MM-DD'
}

/**
 * Hook to fetch options data for a ticker from /options/<ticker> endpoint
 * 
 * @param ticker - The stock ticker symbol (e.g., 'AAPL', 'IWM')
 * @param params - Optional query parameters for filtering
 * @returns React Query result with options data (calls and puts)
 */
export function useOptionsQuery(ticker: string, params?: OptionsQueryParams) {
  return useQuery({
    queryKey: ['options', ticker, params],
    queryFn: async (): Promise<OptionsResponse> => {
      if (!ticker || ticker.trim().length === 0) {
        throw new Error('Ticker is required');
      }

      try {
        const queryParams = new URLSearchParams();
        
        if (params?.limit !== undefined) {
          queryParams.append('limit', params.limit.toString());
        }
        if (params?.strike_price_gte !== undefined) {
          queryParams.append('strike_price_gte', params.strike_price_gte.toString());
        }
        if (params?.strike_price_lte !== undefined) {
          queryParams.append('strike_price_lte', params.strike_price_lte.toString());
        }
        if (params?.expiration_date_gte) {
          queryParams.append('expiration_date_gte', params.expiration_date_gte);
        }
        if (params?.expiration_date_lte) {
          queryParams.append('expiration_date_lte', params.expiration_date_lte);
        }

        const queryString = queryParams.toString();
        const apiUrl = `${RAILWAY_BASE_URL}/options/${ticker.trim().toUpperCase()}${queryString ? `?${queryString}` : ''}`;

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
