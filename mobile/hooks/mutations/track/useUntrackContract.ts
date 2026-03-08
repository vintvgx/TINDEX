import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";

interface UntrackContractResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    id: string;
  };
}

/**
 * Hook to untrack (delete) an options contract
 * 
 * @returns Mutation object with untrackContract function and state
 */
export function useUntrackContract() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (contractId: string): Promise<void> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to untrack contracts");
      }

      try {
        const apiUrl = `${RAILWAY_BASE_URL}/track-option/${contractId}?userId=${user.id}`;

        const response = await fetch(apiUrl, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to untrack contract: ${response.statusText}`);
        }

        const data: UntrackContractResponse = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to untrack contract");
        }
      } catch (error) {
        console.error("Error untracking contract:", error);
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
      console.error("Contract untracking failed:", error);
    },
  });
}
