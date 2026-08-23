import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { CreatePriceLevelRequest, WatchedPriceLevel } from "@/common/types/priceLevels";

interface CreateKeyLevelResponse {
  success: boolean;
  data: WatchedPriceLevel;
  error?: string;
}

export function useCreateKeyLevel() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreatePriceLevelRequest): Promise<WatchedPriceLevel> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to add a key level");
      }
      if (request.userId !== user.id) {
        throw new Error("User ID mismatch");
      }

      const response = await fetch(`${RAILWAY_BASE_URL}/price-levels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to add key level: ${response.statusText}`);
      }

      const data: CreateKeyLevelResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to add key level");
      }
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["key-levels"] });
      // Creating a level always enables ORB follow for its ticker server-side
      // (see price_level_routes.py's create_price_level → follow_stock()) —
      // without this, a newly-watched ticker that wasn't already followed
      // stays invisible to every screen reading useUserORBFollows (e.g. the
      // Charts tab's ticker list) until something else happens to refetch it.
      queryClient.invalidateQueries({ queryKey: ["userORBFollows"] });
    },
  });
}
