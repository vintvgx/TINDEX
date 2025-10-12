/**
 * Watchlist Types
 * 
 * Type definitions for watchlist data fetched from the backend API.
 * Supports multiple watchlist types including gainers, losers, trending, etc.
 */

/**
 * Valid watchlist types supported by the API
 */
export type WatchlistType = 
  | 'biggest-gainers'
  | 'trending' 
  | 'insider_buying' 
  | 'congress_trading' 
  | 'top_gainers' 
  | 'top_losers';

/**
 * Individual stock item in the biggest gainers watchlist
 */
export interface BiggestGainerStock {
  /** Stock ticker symbol */
  symbol: string;
  ticker?: string;
  /** Company name */
  name: string;
  /** Current price */
  price: number;
  /** Absolute price change */
  change: number;
  /** Percentage change */
  changesPercentage: number;
  /** Trading volume */
  volume?: number;
  /** Market capitalization */
  marketCap?: number;
}

/**
 * Generic watchlist stock item
 * This can be extended for different watchlist types
 */
export interface WatchlistStock {
  symbol: string;
  ticker?: string;
  name?: string;
  company?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  changesPercentage?: number;
  volume?: number;
  marketCap?: number;
  [key: string]: any; // Allow additional properties for different watchlist types
}

/**
 * API response for watchlist endpoint
 */
export interface WatchlistResponse<T = WatchlistStock> {
  /** Whether the request was successful */
  success: boolean;
  /** Array of stock items */
  data: T[];
  /** Whether data was served from cache */
  from_cache?: boolean;
  /** Error message if request failed */
  error?: string;
  /** Optional timestamp */
  timestamp?: number;
  /** Optional count of items */
  count?: number;
}

export const WATCHLIST_LABELS: Record<WatchlistType, string> = {
  'biggest-gainers': 'Biggest Gainers',
  'trending': 'Trending',
  'insider_buying': 'Insider Buying',
  'congress_trading': 'Congress Trading',
  'top_gainers': 'Top Gainers',
  'top_losers': 'Top Losers',
};

/**
 * Query parameters for watchlist API requests
 */
export interface WatchlistQueryParams {
  /** Number of results to return (default: 20, max: 50) */
  limit?: number;
  /** Whether to use cached data (default: true) */
  use_cache?: boolean;
}

/**
 * Hook configuration options
 */
export interface UseWatchlistOptions extends WatchlistQueryParams {
  /** Whether to enable the query */
  enabled?: boolean;
  /** Stale time in milliseconds */
  staleTime?: number;
  /** Number of retry attempts */
  retry?: number;
  /** Retry delay in milliseconds */
  retryDelay?: number;
  /** Refetch on mount */
  refetchOnMount?: boolean;
  /** Refetch on window focus */
  refetchOnWindowFocus?: boolean;
}

