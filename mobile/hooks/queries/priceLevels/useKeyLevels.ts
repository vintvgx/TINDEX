import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { WatchedPriceLevel, LevelStatus } from "@/common/types/priceLevels";

interface KeyLevelsResponse {
  success: boolean;
  data: WatchedPriceLevel[];
  error?: string;
}

/**
 * Hook to fetch the current user's watched price levels.
 *
 * @param statusFilter - Optional status filter ("watching", "confirmed", "expired", "cancelled")
 */
export function useKeyLevels(statusFilter?: LevelStatus) {
  const { authState: { user, isLoading: authLoading } } = useAuth();

  return useQuery({
    queryKey: ["key-levels", user?.id, statusFilter],
    queryFn: async (): Promise<WatchedPriceLevel[]> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to fetch key levels");
      }

      const params = new URLSearchParams({ userId: user.id });
      if (statusFilter) {
        params.append("status", statusFilter);
      }

      const response = await fetch(`${RAILWAY_BASE_URL}/price-levels?${params.toString()}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch key levels: ${response.statusText}`);
      }

      const data: KeyLevelsResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to fetch key levels");
      }

      return data.data || [];
    },
    enabled: !!user?.id && !authLoading,
    staleTime: 30 * 1000,
    // Confirmations happen server-side off a live bar stream and land as a
    // push notification — poll so a level that confirms while this screen
    // is open updates without the user having to pull-to-refresh.
    refetchInterval: 30 * 1000,
    retry: 2,
    retryDelay: 1000,
  });
}
