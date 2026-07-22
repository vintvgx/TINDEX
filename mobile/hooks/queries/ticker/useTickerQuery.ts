import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { TickerResponse } from "@/common/types/blogPosts/ticker";
import { useCallback, useRef } from "react";
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

/**
 * Custom hook to fetch detailed ticker information
 *
 * Defaults to the backend's cache (use_cache: true) — the server-side
 * research cache is short-lived (~60s, see perform_yfinance_research), so
 * this mainly saves a full yfinance + options-chain pass on rapid re-opens
 * of the same ticker; a cold/idle ticker will still take the same slow path
 * either way. That slow path is a full uncached yfinance research pass
 * (.info + .history + .news + .recommendations + a 5-expiration options-
 * chain fetch/score), which has no timeout of its own and can run
 * noticeably slower outside market hours — the abort below is what actually
 * bounds the wait, caching just reduces how often that path gets hit.
 *
 * `refetchFresh` (returned alongside the normal query fields) is the one
 * escape hatch: it forces the *next* fetch to bypass the cache — wire it
 * to pull-to-refresh so an explicit refresh always gets real fresh data
 * instead of possibly replaying whatever's still in that 60s cache window.
 *
 * @param ticker - The stock ticker symbol (e.g., 'AAPL', 'TSLA')
 * @returns React Query result with ticker data, plus refetchFresh()
 */
export function useTickerQuery(ticker: string) {
  const { authState: { user, isLoading: authLoading } } = useAuth();
  // A ref, not state: the queryFn below reads this at call time (not at
  // render/definition time), so setting it and immediately calling
  // refetch() takes effect on that very next fetch — no waiting on a state
  // update to flush through a re-render first.
  const bypassCacheRef = useRef(false);

  const query = useQuery({
    queryKey: ['ticker', ticker, user?.id],
    queryFn: async (): Promise<TickerResponse> => {
      if (!user?.id) {
        throw new Error('User must be authenticated to fetch ticker data');
      }

      try {
        const apiUrl = `${RAILWAY_BASE_URL}/ticker/${ticker}`;

        // Consume the one-shot bypass so only the fetch that triggered it
        // skips the cache — every fetch after goes back to using it.
        const useCache = !bypassCacheRef.current;
        bypassCacheRef.current = false;

        const requestBody = {
          userId: user.id,
          save_to_db: true,
          use_cache: useCache,
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
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
    retryDelay: 1000,
  });

  // Forces the next fetch to skip the backend cache — wire this to
  // pull-to-refresh instead of the plain `refetch` so an explicit refresh
  // always gets a genuinely fresh pull, not whatever's still sitting in the
  // server's ~60s research cache.
  const refetchFresh = useCallback(() => {
    bypassCacheRef.current = true;
    return query.refetch();
  }, [query.refetch]);

  return { ...query, refetchFresh };
}
