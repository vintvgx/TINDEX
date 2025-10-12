/**
 * useBiggestGainers Hook
 * 
 * Specialized hook for fetching the biggest gaining stocks.
 * This is a convenience wrapper around the generic useWatchlist hook
 * with proper typing for biggest gainers data.
 * 
 * High-Level Approach:
 * - Wraps the generic useWatchlist hook with specific typing
 * - Provides a simplified API for the most common use case
 * - Maintains all the robust features of the base hook
 * 
 * Key Technical Decisions:
 * 1. Type-specific wrapper instead of generic - improves developer experience
 * 2. Re-exports the base type for consistency
 * 3. Default options optimized for biggest gainers use case
 * 
 * Edge Cases Handled:
 * - Invalid limit values (validated by base hook)
 * - Network failures (automatic retry)
 * - Stale data (configurable refresh)
 * - Missing API data (type-safe null checks required in consumer)
 * 
 * Testing Strategy:
 * - Mock the useWatchlist hook in tests
 * - Test with various limit values
 * - Test error states
 * - Test loading states
 * - Verify type safety with TypeScript
 * 
 * Future Maintenance:
 * - If response format changes, update BiggestGainerStock type
 * - Consider adding data transformation if needed
 * - May add derived data (e.g., sorted by change %)
 * 
 * @example
 * ```tsx
 * // Simple usage
 * const { data, isLoading, error } = useBiggestGainers();
 * 
 * // With custom limit
 * const { data, isLoading, error } = useBiggestGainers({ limit: 30 });
 * 
 * // With all options
 * const { data, isLoading, error, refetch } = useBiggestGainers({
 *   limit: 25,
 *   use_cache: false,
 *   enabled: shouldFetch,
 *   staleTime: 2 * 60 * 1000 // 2 minutes
 * });
 * 
 * // Accessing the data
 * if (data?.success) {
 *   const stocks = data.data; // BiggestGainerStock[]
 *   stocks.forEach(stock => {
 *     console.log(`${stock.ticker}: ${stock.changesPercentage}%`);
 *   });
 * }
 * ```
 */

import {
  WatchlistResponse
} from '@/common/types/watchlist';
import { useQuery } from '@tanstack/react-query';

/**
 * Hook for fetching biggest gaining stocks
 * 
 * This is a type-safe wrapper around the generic useWatchlist hook
 * specifically for biggest gainers data. It provides:
 * - Automatic type inference for BiggestGainerStock
 * - Simplified API for common use case
 * - Same configuration options as base hook
 * 
 * Performance Notes:
 * - Data is cached for 5 minutes by default
 * - Backend caching provides additional performance layer
 * - React Query prevents duplicate requests
 * 
 * Security Considerations:
 * - No authentication required for public market data
 * - API key handled server-side
 * - Rate limiting handled by backend
 * 
 * @param options - Configuration options for the query
 * @returns React Query result with biggest gainers data
 */
// export function useBiggestGainers(
//   options: UseWatchlistOptions = {}
// ): UseQueryResult<WatchlistResponse<BiggestGainerStock>, Error> {
//   return useWatchlist<BiggestGainerStock>('biggest-gainers', options);
// }

// /**
//  * Re-export the type for convenience
//  */
// export type { BiggestGainerStock };

/**
 * Custom hook to fetch biggest-gaining stocks from the FMP API call from backend
 * 
 * @param sortBy - The parameter to sort by ('volume', 'change', 'pe', 'marketcap')
 * @returns React Query result with trending stocks data
 */
export function useBiggestGainersVersionOne()  {

  return useQuery({
    queryKey: ['watchlist', 'biggest-gainers'],
    queryFn: async(): Promise<WatchlistResponse> => {
      const response = await fetch(`https://alethia-test-eng.up.railway.app/biggest-gainers`)

      if (!response.ok) {
        throw new Error(`Failed to fetch biggest-gainers watchlists: ${response.statusText}`);
      }

      const data = await response.json();
            
      if (!data.success) {
          throw new Error(data.error || 'Failed to fetch biggest-gainers watchlists');
      }
      
      console.log("Biggest-gainers watchlists fetching successfully")
      return data;
    },
    enabled: true, 
    // enabled: delayComplete, // Only enable after delay
    staleTime: 5 * 60 * 1000, // TODO make this an 12 hour cache
    retry: 2,
    retryDelay: 1000,
    // refetchOnMount: true,
    // refetchOnWindowFocus: false,
    // refetchOnReconnect: true,
  })
}

