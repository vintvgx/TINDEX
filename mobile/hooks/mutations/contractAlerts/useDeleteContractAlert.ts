import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { ContractPriceAlert } from "@/common/types/contractAlerts";

interface DeleteContractAlertResponse {
  success: boolean;
  data: ContractPriceAlert;
  error?: string;
}

export function useDeleteContractAlert(strategyId: string) {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alertId: string): Promise<ContractPriceAlert> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to remove a price alert");
      }

      const response = await fetch(
        `${RAILWAY_BASE_URL}/strategy/positions/${strategyId}/alerts/${alertId}?userId=${encodeURIComponent(user.id)}`,
        { method: "DELETE", headers: { "Content-Type": "application/json" } },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to remove price alert: ${response.statusText}`);
      }

      const data: DeleteContractAlertResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to remove price alert");
      }
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contract-price-alerts", strategyId] });
    },
  });
}
