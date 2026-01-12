import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { TrackedOptionContract, UpdateContractStatusRequest } from "@/common/types/options";

interface UpdateContractStatusResponse {
  success: boolean;
  data: TrackedOptionContract;
  message?: string;
  error?: string;
}

/**
 * Hook to update contract status (entered, exited, cancelled)
 * 
 * @returns Mutation object with updateContractStatus function and state
 */
export function useUpdateContractStatus() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: UpdateContractStatusRequest): Promise<TrackedOptionContract> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to update contract status");
      }

      if (request.userId !== user.id) {
        throw new Error("User ID mismatch");
      }

      try {
        const apiUrl = `${RAILWAY_BASE_URL}/track-option/${request.contractId}`;

        const response = await fetch(apiUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: request.userId,
            status: request.status,
            entryPrice: request.entryPrice,
            exitPrice: request.exitPrice,
            positionSize: request.positionSize,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to update contract: ${response.statusText}`);
        }

        const data: UpdateContractStatusResponse = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to update contract");
        }

        return data.data;
      } catch (error) {
        console.error("Error updating contract status:", error);
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate tracked contracts queries
      queryClient.invalidateQueries({
        queryKey: ["tracked-contracts"],
      });

      // Invalidate portfolio metrics
      queryClient.invalidateQueries({
        queryKey: ["portfolio-metrics"],
      });
    },
    onError: (error: Error) => {
      console.error("Contract status update failed:", error);
    },
  });
}
