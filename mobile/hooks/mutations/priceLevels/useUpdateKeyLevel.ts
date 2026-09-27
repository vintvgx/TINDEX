import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { UpdatePriceLevelRequest, WatchedPriceLevel } from "@/common/types/priceLevels";

interface UpdateKeyLevelResponse {
  success: boolean;
  data: WatchedPriceLevel;
  error?: string;
}

/**
 * Modifies an existing watch zone's bounds/direction in place (the chart's
 * Watch-mode edit flow — see AdvancedPriceChart's onUpdateWatchZone) rather
 * than deleting and recreating it.
 */
export function useUpdateKeyLevel() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ levelId, ...request }: UpdatePriceLevelRequest & { levelId: string }): Promise<WatchedPriceLevel> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to edit a key level");
      }
      if (request.userId !== user.id) {
        throw new Error("User ID mismatch");
      }

      const response = await fetch(`${RAILWAY_BASE_URL}/price-levels/${levelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to update key level: ${response.statusText}`);
      }

      const data: UpdateKeyLevelResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update key level");
      }
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["key-levels"] });
    },
  });
}
