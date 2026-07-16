import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import type { PortfolioPosition, PortfolioPositionUpsert } from "@/common/types/portfolio";
import { PORTFOLIO_POSITIONS_QUERY_KEY } from "@/hooks/queries/track/usePortfolioPositions";
import { PORTFOLIO_SUMMARY_QUERY_KEY } from "@/hooks/queries/track/usePortfolioSummary";

/**
 * Upserts a portfolio position (insert or update by user_id + ticker).
 * On success, invalidates portfolio positions query so the list refetches.
 */
export function useUpsertPortfolioPosition() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: PortfolioPositionUpsert): Promise<PortfolioPosition | null> => {
      if (!user?.id) throw new Error("User must be authenticated");

      const ticker = payload.ticker.trim().toUpperCase();
      const shares = Number(payload.shares);
      const average_cost = Number(payload.average_cost);

      if (!ticker) throw new Error("Ticker is required");
      if (Number.isNaN(shares) || shares <= 0) throw new Error("Shares must be a positive number");
      if (Number.isNaN(average_cost) || average_cost < 0) throw new Error("Average cost must be a non-negative number");

      const row: Record<string, unknown> = {
        user_id: user.id,
        ticker,
        shares,
        average_cost,
        position_type: payload.position_type ?? "long",
        strategy: payload.strategy ?? "scalp",
      };
      if (payload.opened_at) row.opened_at = payload.opened_at;

      const { data, error } = await supabase
        .from("portfolio_positions")
        .upsert(row, { onConflict: "user_id,ticker" })
        .select()
        .single();

      if (error) throw error;
      return data as PortfolioPosition;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PORTFOLIO_POSITIONS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [PORTFOLIO_SUMMARY_QUERY_KEY] });
    },
  });
}
