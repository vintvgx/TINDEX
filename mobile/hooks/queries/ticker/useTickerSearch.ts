import { TickerSearchResponse } from "@/common/types/blogPosts/ticker";
import { useQuery } from "@tanstack/react-query";
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

/**
 * Hook to search for ticker.
 *
 * @param ticker - The stock ticker symbol
 *
 * @returns React Query result with basic ticker data
 */
export function useTickerSearch(ticker: string) {
  return useQuery({
    queryKey: ["search", ticker],
    queryFn: async (): Promise<TickerSearchResponse> => {
      try {
        const apiUrl = `${RAILWAY_BASE_URL}/options/${ticker}`;

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to search for ticker: ${response.statusText}`
          );
        }

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to fetch ticker data");
        }

        return data;
      } catch (error) {
        // Fallback to mock data when API fails
        console.warn(`API call failed for ${ticker}`, error);
        return {
          success: false,
          data: undefined,
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    enabled: !!ticker,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
    retryDelay: 1000,
  });
}
