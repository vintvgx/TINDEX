import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/supabase";
import { PORTFOLIO_POSITIONS_QUERY_KEY } from "@/hooks/queries/track/usePortfolioPositions";
import { PORTFOLIO_SUMMARY_QUERY_KEY } from "@/hooks/queries/track/usePortfolioSummary";

/**
 * Deletes a portfolio position by id.
 * On success, invalidates portfolio positions query so the list refetches.
 */
export function useDeletePortfolioPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("portfolio_positions")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PORTFOLIO_POSITIONS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [PORTFOLIO_SUMMARY_QUERY_KEY] });
    },
  });
}
