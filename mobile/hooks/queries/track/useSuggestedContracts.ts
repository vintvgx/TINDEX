import { useQuery } from "@tanstack/react-query";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import type { OptionsOpportunity } from "@/common/types/blogPosts/ticker";

interface SuggestedContractsResponse {
  success: boolean;
  data: {
    ticker: string;
    contracts: OptionsOpportunity[];
    count: number;
  };
  timestamp?: number;
  error?: string;
}

/**
 * Hook to fetch suggested contracts for a ticker
 * 
 * @param ticker - Stock ticker symbol
 * @param limit - Number of contracts to return (default: 3, max: 10)
 * @returns React Query result with suggested contracts
 */
export function useSuggestedContracts(ticker: string, limit: number = 3) {
  return useQuery({
    queryKey: ["suggested-contracts", ticker, limit],
    queryFn: async (): Promise<OptionsOpportunity[]> => {
      if (!ticker) {
        throw new Error("Ticker is required");
      }

      try {
        const params = new URLSearchParams({
          limit: Math.min(Math.max(limit, 1), 10).toString(),
        });

        const apiUrl = `${RAILWAY_BASE_URL}/suggested-contracts/${ticker}?${params.toString()}`;

        const response = await fetch(apiUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch suggested contracts: ${response.statusText}`);
        }

        const data: SuggestedContractsResponse = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to fetch suggested contracts");
        }

        return data.data.contracts || [];
      } catch (error) {
        console.error("Error fetching suggested contracts:", error);
        throw error;
      }
    },
    enabled: !!ticker,
    staleTime: 5 * 60 * 1000, // 5 minutes (options data changes frequently)
    retry: 2,
    retryDelay: 1000,
  });
}
