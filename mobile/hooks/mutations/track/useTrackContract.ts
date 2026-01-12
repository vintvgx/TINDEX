import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { TrackedOptionContract, TrackOptionRequest } from "@/common/types/options";

interface TrackContractResponse {
  success: boolean;
  data: TrackedOptionContract;
  message?: string;
  error?: string;
}

/**
 * Hook to track an options contract
 * 
 * @returns Mutation object with trackContract function and state
 */
export function useTrackContract() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: TrackOptionRequest): Promise<TrackedOptionContract> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to track contracts");
      }

      if (request.userId !== user.id) {
        throw new Error("User ID mismatch");
      }

      try {
        const apiUrl = `${RAILWAY_BASE_URL}/track-option`;

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to track contract: ${response.statusText}`);
        }

        const data: TrackContractResponse = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to track contract");
        }

        return data.data;
      } catch (error) {
        console.error("Error tracking contract:", error);
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
      console.error("Contract tracking failed:", error);
    },
  });
}
