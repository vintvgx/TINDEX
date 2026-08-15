import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { TickerResponse } from "@/common/types/blogPosts/ticker";
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

/**
 * Custom hook to fetch detailed ticker information
 *
 * Always requests fresh data (use_cache: false) and never treats a previous
 * result as fresh client-side (no staleTime) — a stock's price moves
 * continuously during market hours, so both the backend's research cache
 * and React Query's default staleTime were serving visibly outdated prices
 * on quick re-opens of the same ticker. Every mount/refetch now hits
 * yfinance directly.
 *
 * `refetchFresh` (returned alongside the normal query fields) is just
 * `refetch` under this name — wire it to pull-to-refresh; it always returns
 * the most current data since there's no cache left to bypass.
 *
 * @param ticker - The stock ticker symbol (e.g., 'AAPL', 'TSLA')
 * @returns React Query result with ticker data, plus refetchFresh()
 */
export function useTickerQuery(ticker: string) {
  const { authState: { user, isLoading: authLoading } } = useAuth();

  const query = useQuery({
    queryKey: ['ticker', ticker, user?.id],
    queryFn: async (): Promise<TickerResponse> => {
      if (!user?.id) {
        throw new Error('User must be authenticated to fetch ticker data');
      }

      try {
        const apiUrl = `${RAILWAY_BASE_URL}/ticker/${ticker}`;

        const requestBody = {
          userId: user.id,
          save_to_db: true,
          use_cache: false,
        };

        // This request can trigger a full, uncached yfinance research pass
        // on the backend (.info + .history + .news + .recommendations + a
        // 5-expiration options-chain fetch/score) with no timeout anywhere
        // in that chain — Yahoo's endpoints can be markedly slower outside
        // market hours, and without an abort here a slow backend response
        // just hangs the screen forever instead of ever surfacing as an
        // error. 20s is generous for the request above while still
        // bounding the wait to something finite.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20_000);

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));

        if (!response.ok) {
          throw new Error(`Failed to fetch ticker data: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch ticker data');
        }

        return data;
      } catch (error) {
        // No mock fallback — let the error surface so the UI can show
        // "Unable to be fetched" instead of quietly rendering fake data.
        console.warn(`API call failed for ${ticker}:`, error);
        throw error instanceof Error ? error : new Error('Failed to fetch ticker data');
      }
    },
    enabled: !!ticker && !!user?.id && !authLoading,
    // No staleTime: every mount/refetch is treated as stale, so re-opening
    // the same ticker always hits the network instead of replaying whatever
    // price was in memory from the last visit.
    staleTime: 0,
    retry: 1,
    retryDelay: 1000,
  });

  // Kept as its own name so pull-to-refresh call sites don't need to change —
  // it's a plain alias for `refetch` now that there's no cache to bypass.
  return { ...query, refetchFresh: query.refetch };
}
