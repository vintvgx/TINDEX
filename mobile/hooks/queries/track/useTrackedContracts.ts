import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { TrackedOptionContract } from "@/common/types/options";

interface TrackedContractsResponse {
  success: boolean;
  data: TrackedOptionContract[];
  message?: string;
  error?: string;
}

/**
 * Hook to fetch tracked contracts for a user
 * 
 * @param statusFilter - Optional status filter ("tracking", "entered", "exited", "expired", "cancelled")
 * @returns React Query result with tracked contracts
 */
export function useTrackedContracts(statusFilter?: string) {
  const { authState: { user, isLoading: authLoading } } = useAuth();

  return useQuery({
    queryKey: ["tracked-contracts", user?.id, statusFilter],
    queryFn: async (): Promise<TrackedOptionContract[]> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to fetch tracked contracts");
      }

      try {
        const params = new URLSearchParams({
          userId: user.id,
        });

        if (statusFilter) {
          params.append("status", statusFilter);
        }

        const apiUrl = `${RAILWAY_BASE_URL}/tracked-options?${params.toString()}`;

        const response = await fetch(apiUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch tracked contracts: ${response.statusText}`);
        }

        const data: TrackedContractsResponse = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to fetch tracked contracts");
        }

        return data.data || [];
      } catch (error) {
        console.error("Error fetching tracked contracts:", error);
        throw error;
      }
    },
    enabled: !!user?.id && !authLoading,
    staleTime: 30 * 1000, // 30 seconds
    retry: 2,
    retryDelay: 1000,
  });
}
