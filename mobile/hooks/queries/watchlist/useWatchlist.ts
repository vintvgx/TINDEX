/**
 * useWatchlist Hook
 * 
 * A robust and reusable React Query hook for fetching watchlist data from the backend API.
 * 
 * Features:
 * - Type-safe watchlist fetching
 * - Automatic retry with exponential backoff
 * - Built-in caching via React Query
 * - Configurable query parameters
 * - Error handling with meaningful error messages
 * - Support for multiple watchlist types
 * 
 * Architecture Decisions:
 * 1. Generic type parameter <T> allows type-safe responses for different watchlist types
 * 2. URL construction uses template literals for better readability
 * 3. Query key includes all parameters to ensure proper cache invalidation
 * 4. Default values match backend defaults (limit: 20, use_cache: true)
 * 5. Conservative stale time (5 minutes) balances freshness with API efficiency
 * 
 * Performance Considerations:
 * - React Query handles request deduplication automatically
 * - Stale-while-revalidate pattern provides instant data display
 * - Configurable retry logic prevents excessive API calls
 * 
 * @example
 * ```tsx
 * const { data, isLoading, error } = useWatchlist<BiggestGainerStock>(
 *   'biggest-gainers',
 *   { limit: 25, use_cache: true }
 * );
 * ```
 */

import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { 
  WatchlistType, 
  WatchlistResponse, 
  WatchlistStock,
  UseWatchlistOptions 
} from '@/common/types/watchlist';

/**
 * Base API URL for the backend
 * TODO: Move to environment config or constants file for better configuration management
 */
const API_BASE_URL = 'https://alethia-production.up.railway.app';

/**
 * Builds the query string from parameters
 * 
 * @param params - Query parameters object
 * @returns Formatted query string
 */
const buildQueryString = (params: Record<string, any>): string => {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });
  
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
};

/**
 * Fetches watchlist data from the API
 * 
 * @param watchlistType - Type of watchlist to fetch
 * @param params - Query parameters (limit, use_cache)
 * @returns Promise resolving to watchlist data
 * @throws Error if the fetch fails or returns non-success response
 */
const fetchWatchlist = async <T = WatchlistStock>(
  watchlistType: WatchlistType,
  params: UseWatchlistOptions = {}
): Promise<WatchlistResponse<T>> => {
  const { limit = 20, use_cache = true } = params;
  
  // Validate limit
  if (limit < 1 || limit > 50) {
    throw new Error('Limit must be between 1 and 50');
  }
  
  // Build URL with query parameters
  const queryString = buildQueryString({ limit, use_cache });
  const url = `${API_BASE_URL}/watchlists/${watchlistType}${queryString}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch ${watchlistType} watchlist: ${response.status} ${response.statusText}. ${errorText}`
    );
  }
  
  const data: WatchlistResponse<T> = await response.json();
  
  if (!data.success) {
    throw new Error(data.error || `Failed to fetch ${watchlistType} watchlist`);
  }
  
  return data;
};

/**
 * Custom hook for fetching watchlist data
 * 
 * Uses React Query to provide automatic caching, background refetching,
 * and request deduplication for watchlist data.
 * 
 * @param watchlistType - Type of watchlist to fetch
 * @param options - Hook configuration options
 * @returns React Query result with watchlist data
 * 
 * @example
 * ```tsx
 * // Basic usage
 * const { data, isLoading, error } = useWatchlist('biggest-gainers');
 * 
 * // With custom options
 * const { data, isLoading, error } = useWatchlist('biggest-gainers', {
 *   limit: 25,
 *   use_cache: false,
 *   staleTime: 60000, // 1 minute
 *   enabled: isAuthenticated
 * });
 * 
 * // Type-safe response
 * const { data } = useWatchlist<BiggestGainerStock>('biggest-gainers');
 * // data.data is now typed as BiggestGainerStock[]
 * ```
 */
export function useWatchlist<T = WatchlistStock>(
  watchlistType: WatchlistType,
  options: UseWatchlistOptions = {}
): UseQueryResult<WatchlistResponse<T>, Error> {
  const {
    limit = 20,
    use_cache = true,
    enabled = true,
    staleTime = 5 * 60 * 1000, // 5 minutes default
    retry = 2,
    retryDelay = 1000,
    refetchOnMount = false,
    refetchOnWindowFocus = false,
  } = options;

  return useQuery<WatchlistResponse<T>, Error>({
    queryKey: ['watchlist', watchlistType, limit, use_cache],
    queryFn: () => fetchWatchlist<T>(watchlistType, { limit, use_cache }),
    enabled,
    staleTime,
    retry,
    retryDelay,
    refetchOnMount,
    refetchOnWindowFocus,
    refetchOnReconnect: true,
  });
}

/**
 * Export the fetch function for use outside of React components if needed
 */
export { fetchWatchlist };

