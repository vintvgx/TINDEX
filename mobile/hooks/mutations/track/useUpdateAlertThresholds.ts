import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { TrackedOptionContract } from "@/common/types/options";

export interface UpdateAlertThresholdsRequest {
  contractId: string;
  gain25?: number | null;
  gain50?: number | null;
  gain100?: number | null;
  loss25?: number | null;
  loss50?: number | null;
  loss100?: number | null;
}

interface UpdateAlertThresholdsResponse {
  success: boolean;
  data: TrackedOptionContract;
  message?: string;
  error?: string;
}

/**
 * Hook to set per-contract entered-position alert threshold overrides
 * (null resets a tier back to the 25/50/100 default). Independent of
 * status — see PATCH /track-option/<id>/alerts.
 */
export function useUpdateAlertThresholds() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: UpdateAlertThresholdsRequest): Promise<TrackedOptionContract> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to update alert thresholds");
      }

      const { contractId, ...thresholds } = request;
      const apiUrl = `${RAILWAY_BASE_URL}/track-option/${contractId}/alerts`;

      const response = await fetch(apiUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, ...thresholds }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to update alert thresholds: ${response.statusText}`);
      }

      const data: UpdateAlertThresholdsResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update alert thresholds");
      }
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracked-contracts"] });
    },
    onError: (error: Error) => {
      console.error("Alert threshold update failed:", error);
    },
  });
}
