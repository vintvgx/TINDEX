import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { WatchedPriceLevel } from "@/common/types/priceLevels";

interface CancelKeyLevelResponse {
  success: boolean;
  data: WatchedPriceLevel;
  error?: string;
}

export function useCancelKeyLevel() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (levelId: string): Promise<WatchedPriceLevel> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to remove a key level");
      }

      const response = await fetch(
        `${RAILWAY_BASE_URL}/price-levels/${levelId}?userId=${encodeURIComponent(user.id)}`,
        { method: "DELETE", headers: { "Content-Type": "application/json" } },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to remove key level: ${response.statusText}`);
      }

      const data: CancelKeyLevelResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to remove key level");
      }
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["key-levels"] });
    },
  });
}
