/**
 * Placeholder Watchlist Hooks
 * 
 * These are placeholder implementations for future watchlist types.
 * Each hook follows the same pattern as useBiggestGainers but is currently
 * commented out pending backend implementation.
 * 
 * Implementation Plan:
 * 1. Uncomment the relevant hook when backend endpoint is ready
 * 2. Update the type definitions if the response structure differs
 * 3. Adjust default options if needed for specific use cases
 * 4. Add any data transformations required
 * 
 * To implement a new watchlist type:
 * 1. Define the type in @/common/types/watchlist/index.ts
 * 2. Uncomment the corresponding hook below
 * 3. Update the type parameter in useWatchlist call
 * 4. Test with backend endpoint
 * 5. Export from index.ts
 */

import { UseQueryResult } from '@tanstack/react-query';
import { useWatchlist } from './useWatchlist';
import { 
  WatchlistResponse, 
  WatchlistStock,
  UseWatchlistOptions 
} from '@/common/types/watchlist';

// ============================================================================
// TRENDING STOCKS
// ============================================================================

/**
 * Hook for fetching trending stocks (most active by volume)
 * 
 * @param options - Configuration options
 * @returns React Query result with trending stocks data
 * 
 * @example
 * ```tsx
 * const { data, isLoading, error } = useTrendingStocks({ limit: 20 });
 * ```
 */
// export function useTrendingStocks(
//   options: UseWatchlistOptions = {}
// ): UseQueryResult<WatchlistResponse<WatchlistStock>, Error> {
//   return useWatchlist<WatchlistStock>('trending', options);
// }

// ============================================================================
// INSIDER BUYING
// ============================================================================

/**
 * Hook for fetching stocks with recent insider buying activity
 * 
 * @param options - Configuration options
 * @returns React Query result with insider buying data
 * 
 * @example
 * ```tsx
 * const { data, isLoading, error } = useInsiderBuying({ limit: 15 });
 * ```
 */
// export function useInsiderBuying(
//   options: UseWatchlistOptions = {}
// ): UseQueryResult<WatchlistResponse<WatchlistStock>, Error> {
//   return useWatchlist<WatchlistStock>('insider_buying', options);
// }

// ============================================================================
// CONGRESS TRADING
// ============================================================================

/**
 * Hook for fetching recent congressional stock trading activity
 * 
 * @param options - Configuration options
 * @returns React Query result with congress trading data
 * 
 * @example
 * ```tsx
 * const { data, isLoading, error } = useCongressTrading({ limit: 25 });
 * ```
 */
// export function useCongressTrading(
//   options: UseWatchlistOptions = {}
// ): UseQueryResult<WatchlistResponse<WatchlistStock>, Error> {
//   return useWatchlist<WatchlistStock>('congress_trading', options);
// }

// ============================================================================
// TOP GAINERS
// ============================================================================

/**
 * Hook for fetching top gaining stocks today
 * 
 * @param options - Configuration options
 * @returns React Query result with top gainers data
 * 
 * @example
 * ```tsx
 * const { data, isLoading, error } = useTopGainers({ limit: 20 });
 * ```
 */
// export function useTopGainers(
//   options: UseWatchlistOptions = {}
// ): UseQueryResult<WatchlistResponse<WatchlistStock>, Error> {
//   return useWatchlist<WatchlistStock>('top_gainers', options);
// }

// ============================================================================
// TOP LOSERS
// ============================================================================

/**
 * Hook for fetching top losing stocks today
 * 
 * @param options - Configuration options
 * @returns React Query result with top losers data
 * 
 * @example
 * ```tsx
 * const { data, isLoading, error } = useTopLosers({ limit: 20 });
 * ```
 */
// export function useTopLosers(
//   options: UseWatchlistOptions = {}
// ): UseQueryResult<WatchlistResponse<WatchlistStock>, Error> {
//   return useWatchlist<WatchlistStock>('top_losers', options);
// }

/**
 * IMPLEMENTATION NOTES:
 * 
 * When implementing these hooks:
 * 
 * 1. Type Definitions: Create specific interfaces in the types file if the
 *    response structure differs significantly from WatchlistStock
 * 
 * 2. Data Transformation: If backend returns data in a different format,
 *    add a transformation layer in the queryFn
 * 
 * 3. Caching Strategy: Adjust staleTime based on data volatility
 *    - Congress trading: Longer stale time (changes infrequently)
 *    - Trending stocks: Shorter stale time (changes frequently)
 * 
 * 4. Error Handling: Consider adding specific error messages for each
 *    watchlist type if needed
 * 
 * 5. Testing: Add unit tests for each hook before deploying to production
 */

export {};

