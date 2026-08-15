import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { PricePeriod, TickerHistoryResponse } from "@/common/types/blogPosts/ticker";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";

/**
 * Fetches a single timeframe's price series for the ticker chart.
 * Kept separate from useTickerQuery (fundamentals) so switching timeframes
 * doesn't refetch/re-render company info, price, market cap, etc.
 *
 * @param ticker - Stock ticker symbol
 * @param period - Selected chart timeframe (1D/1W/1M/3M/YTD/1Y/5Y)
 * @param refetchIntervalMs - Optional background poll interval (e.g. so a 1D
 *   chart's 5-min candles pick up the newest bar on their own instead of
 *   requiring the screen to be closed and reopened). Omit for a one-shot fetch.
 */
export function useTickerHistoryQuery(ticker: string, period: PricePeriod, refetchIntervalMs?: number) {
  const { authState: { user, isLoading: authLoading } } = useAuth();

  return useQuery({
    queryKey: ["ticker-history", ticker, period],
    queryFn: async (): Promise<TickerHistoryResponse> => {
      try {
        // See useTickerQuery.ts for why this needs an explicit abort — same
        // uncached yfinance call underneath, same risk of hanging otherwise.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20_000);

        const response = await fetch(`${RAILWAY_BASE_URL}/ticker/${ticker}/history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ period }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));

        if (!response.ok) {
          throw new Error(`Failed to fetch ticker history: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to fetch ticker history");
        }

        return data;
      } catch (error) {
        // No mock fallback — let the error surface so the chart can show
        // "Unable to be fetched" instead of quietly rendering fake data.
        console.warn(`History API call failed for ${ticker} (${period}):`, error);
        throw error instanceof Error ? error : new Error("Failed to fetch ticker history");
      }
    },
    enabled: !!ticker && !!user?.id && !authLoading,
    // No staleTime — every mount/refetch hits the network so the chart never
    // silently replays an old in-memory series.
    staleTime: 0,
    retry: 1,
    retryDelay: 1000,
    refetchInterval: refetchIntervalMs ?? false,
    // Switching timeframes changes the query key (ticker-history includes
    // period) — without this, the chart would drop back to a loading state
    // on every tab tap. Keeping the previous period's data displayed while
    // the new one fetches, then swapping once it lands, is the smooth
    // Robinhood-style transition instead of a skeleton flash each time.
    placeholderData: keepPreviousData,
  });
}
