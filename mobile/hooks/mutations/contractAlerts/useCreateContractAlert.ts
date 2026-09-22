import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { ContractPriceAlert, CreateContractAlertRequest } from "@/common/types/contractAlerts";

interface CreateContractAlertResponse {
  success: boolean;
  data: ContractPriceAlert;
  error?: string;
}

export function useCreateContractAlert(strategyId: string) {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateContractAlertRequest): Promise<ContractPriceAlert> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to add a price alert");
      }
      if (request.userId !== user.id) {
        throw new Error("User ID mismatch");
      }

      const response = await fetch(`${RAILWAY_BASE_URL}/strategy/positions/${strategyId}/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to add price alert: ${response.statusText}`);
      }

      const data: CreateContractAlertResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to add price alert");
      }
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contract-price-alerts", strategyId] });
    },
  });
}
