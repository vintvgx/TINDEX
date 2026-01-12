import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";

export interface PortfolioMetrics {
  totalContracts: number;
  activeContracts: number;
  totalUnrealizedPnL: number;
  totalUnrealizedPnLPercent: number;
  totalCostBasis: number;
  totalCurrentValue: number;
  riskExposure: Array<{
    ticker: string;
    contractCount: number;
    totalCostBasis: number;
    unrealizedPnL: number;
    unrealizedPnLPercent: number;
    exposurePercent: number;
  }>;
}

interface PortfolioMetricsResponse {
  success: boolean;
  data: PortfolioMetrics;
  timestamp?: number;
  error?: string;
}

/**
 * Hook to fetch portfolio metrics for a user
 * 
 * @returns React Query result with portfolio metrics
 */
export function usePortfolioMetrics() {
  const { authState: { user, isLoading: authLoading } } = useAuth();

  return useQuery({
    queryKey: ["portfolio-metrics", user?.id],
    queryFn: async (): Promise<PortfolioMetrics> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to fetch portfolio metrics");
      }

      try {
        const params = new URLSearchParams({
          userId: user.id,
        });

        const apiUrl = `${RAILWAY_BASE_URL}/portfolio-metrics?${params.toString()}`;

        const response = await fetch(apiUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch portfolio metrics: ${response.statusText}`);
        }

        const data: PortfolioMetricsResponse = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to fetch portfolio metrics");
        }

        return data.data;
      } catch (error) {
        console.error("Error fetching portfolio metrics:", error);
        throw error;
      }
    },
    enabled: !!user?.id && !authLoading,
    staleTime: 60 * 1000, // 1 minute
    retry: 2,
    retryDelay: 1000,
  });
}
