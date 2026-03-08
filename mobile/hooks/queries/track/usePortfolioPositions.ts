import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import type { PortfolioPosition } from "@/common/types/portfolio";

const PORTFOLIO_POSITIONS_QUERY_KEY = "portfolio-positions";

/**
 * Fetches the current user's portfolio positions from Supabase.
 * Invalidate this query after upsert/delete to refetch.
 * @param options.enabled - When false, query does not run (default: true when user is present).
 */
export function usePortfolioPositionsQuery(options?: { enabled?: boolean }) {
  const { authState: { user, isLoading: authLoading } } = useAuth();
  const enabled = (options?.enabled !== false) && !!user?.id && !authLoading;

  return useQuery({
    queryKey: [PORTFOLIO_POSITIONS_QUERY_KEY, user?.id],
    queryFn: async (): Promise<PortfolioPosition[]> => {
      if (!user?.id) {
        throw new Error("User must be authenticated to fetch portfolio");
      }

      const { data, error } = await supabase
        .from("portfolio_positions")
        .select("*")
        .eq("user_id", user.id)
        .order("ticker", { ascending: true });

      if (error) throw error;
      return (data ?? []) as PortfolioPosition[];
    },
    enabled,
    staleTime: 30 * 1000,
  });
}

export { PORTFOLIO_POSITIONS_QUERY_KEY };
