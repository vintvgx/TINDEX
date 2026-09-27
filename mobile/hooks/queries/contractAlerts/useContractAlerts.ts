import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { ContractPriceAlert } from "@/common/types/contractAlerts";

interface ContractAlertsResponse {
  success: boolean;
  data: ContractPriceAlert[];
  error?: string;
}

/** This position's contract price alerts (watching + triggered, not cancelled). */
export function useContractAlerts(strategyId: string | undefined, enabled: boolean = true) {
  const { authState: { user, isLoading: authLoading } } = useAuth();

  return useQuery({
    queryKey: ["contract-price-alerts", strategyId, user?.id],
    queryFn: async (): Promise<ContractPriceAlert[]> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to fetch price alerts");
      }
      const params = new URLSearchParams({ userId: user.id });
      const response = await fetch(`${RAILWAY_BASE_URL}/strategy/positions/${strategyId}/alerts?${params.toString()}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch price alerts: ${response.statusText}`);
      }

      const data: ContractAlertsResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to fetch price alerts");
      }
      return data.data || [];
    },
    enabled: enabled && !!strategyId && !!user?.id && !authLoading,
    staleTime: 15 * 1000,
    // A watching alert can trigger server-side any time the position is
    // open — poll so PositionInfoModal reflects a fire without needing to
    // be closed and reopened, same reasoning as useKeyLevels' poll.
    refetchInterval: 15 * 1000,
    retry: 2,
    retryDelay: 1000,
  });
}
