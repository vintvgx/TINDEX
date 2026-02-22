import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import type { PortfolioSummary } from "@/common/types/portfolio";

export const PORTFOLIO_SUMMARY_QUERY_KEY = "portfolio-summary";

/**
 * Fetches the current user's aggregated portfolio (totals, P&L, performance).
 * Updated by trigger when portfolio_positions change.
 */
export function usePortfolioSummaryQuery(options?: { enabled?: boolean }) {
  const { authState: { user, isLoading: authLoading } } = useAuth();
  const enabled = (options?.enabled !== false) && !!user?.id && !authLoading;

  return useQuery({
    queryKey: [PORTFOLIO_SUMMARY_QUERY_KEY, user?.id],
    queryFn: async (): Promise<PortfolioSummary | null> => {
      if (!user?.id) return null;

      const { data, error } = await supabase
        .from("portfolio")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      return data as PortfolioSummary | null;
    },
    enabled,
    staleTime: 30 * 1000,
  });
}
