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
  | 'most-active'
  | 'insider_buying' 
  | 'congress_trading' 
  | 'top_gainers' 
  | 'top_losers';

  export interface WatchlistStock {
    /** Stock ticker symbol */
    ticker: string;
    /** Company name */
    company: string;
    /** Current stock price */
    price: number;
    /** Price change amount */
    change: number;
    /** Price change percentage */
    change_percent: number;
    /** Market capitalization in billions */
    market_cap: number;
    /** Price-to-earnings ratio (null if not available) */
    pe_ratio: number | null;
    /** Trading volume */
    volume: number;
    /** Average trading volume */
    avg_volume: number;
    /** Week price change percentage */
    week_change: number | null;
    /** 52-week price range */
    week_range: string;
  }
  
  export interface WatchlistData<T = WatchlistStock> {
    /** Whether the request was successful */
    success: boolean;
    /** Timestamp of the data */
    timestamp: number;
    /** Type of watchlist */
    watchlist_type: string;
    /** Number of items */
    count: number;
    /** Array of stock items */
    data: T[];
  }
  
  export interface WatchlistResponse {
    /** Whether the overall request was successful */
    success: boolean;
    /** Timestamp of the response */
    timestamp: number;
    /** Object containing different watchlists */
    watchlists: {
      gainers: WatchlistData;
      most_active: WatchlistData;
      trending: WatchlistData;
    };
  }

export const WATCHLIST_LABELS: Record<WatchlistType, string> = {
  'biggest-gainers': 'Biggest Gainers',
  'trending': 'Trending',
  'most-active': 'Most Active',
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

