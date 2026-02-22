import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { PORTFOLIO_SUMMARY_QUERY_KEY } from "./usePortfolioSummary";
import { PORTFOLIO_POSITIONS_QUERY_KEY } from "./usePortfolioPositions";

/**
 * Call after a successful portfolio refresh so summary/positions caches stay in sync.
 */
export function invalidatePortfolioCaches(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: [PORTFOLIO_SUMMARY_QUERY_KEY] });
  queryClient.invalidateQueries({ queryKey: [PORTFOLIO_POSITIONS_QUERY_KEY] });
}

export const PORTFOLIO_PRICES_QUERY_KEY = "portfolio-prices";

export interface PositionWithPnL {
  id: string;
  ticker: string;
  shares: number;
  average_cost: number;
  position_type: string;
  current_price: number | null;
  unrealized_pnl: number | null;
  current_value: number | null;
  cost_basis: number | null;
  pnl_pct: number | null;
}

export interface PortfolioRefreshSummary {
  total_cost_basis: number;
  total_current_value: number;
  total_unrealized_pnl: number;
  performance_pct: number;
}

export interface PortfolioRefreshResponse {
  success: boolean;
  positions: PositionWithPnL[];
  summary: PortfolioRefreshSummary | null;
  error?: string;
}

async function fetchPortfolioWithPrices(
  userId: string
): Promise<PortfolioRefreshResponse> {
  const res = await fetch(`${RAILWAY_BASE_URL}/portfolio/refresh-prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });

  if (!res.ok) {
    throw new Error(`Portfolio refresh failed: ${res.status}`);
  }

  const json = (await res.json()) as PortfolioRefreshResponse;
  if (!json.success && json.error) {
    throw new Error(json.error);
  }
  return json;
}

/**
 * Fetches portfolio with live prices: open positions + batch current prices,
 * unrealized P&L per position, and updated portfolio summary.
 * Invalidates portfolio-summary and portfolio-positions on success so headers/lists stay in sync.
 */
export function usePortfolioWithPrices() {
  const { authState: { user } } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [PORTFOLIO_PRICES_QUERY_KEY, user?.id],
    queryFn: async () => {
      const result = await fetchPortfolioWithPrices(user!.id);
      if (result.success) {
        invalidatePortfolioCaches(queryClient);
      }
      return result;
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnMount: true,
    retry: 2,
  });

  return query;
}
