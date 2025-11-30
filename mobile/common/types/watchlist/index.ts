/**
 * Watchlist Types with Enum
 * 
 * Type definitions for watchlist data with enhanced type safety.
 * Uses enums for compile-time checking and runtime validation.
 */

/**
 * Enum for all supported watchlist types
 * Provides both type safety and runtime value checking
 */
export enum WatchlistTypeEnum {
  BIGGEST_GAINERS = 'gainers',
  TRENDING = 'trending',
  MOST_ACTIVE = 'most_active',
  INSIDER_BUYING = 'insider',
  CONGRESS_TRADING = 'congress',
  TOP_GAINERS = 'top_gainers',
  TOP_LOSERS = 'top_losers',
}

/**
 * Type alias for backwards compatibility and convenience
 */
export type WatchlistType = `${WatchlistTypeEnum}`;

/**
 * Array of all valid watchlist types for iteration/validation
 */
export const WATCHLIST_TYPES = Object.values(WatchlistTypeEnum) as WatchlistType[];

/**
 * Type guard to check if a string is a valid watchlist type
 * @param value - String to validate
 * @returns True if value is a valid WatchlistType
 */
export function isValidWatchlistType(value: unknown): value is WatchlistType {
  return typeof value === 'string' && WATCHLIST_TYPES.includes(value as WatchlistType);
}

/**
 * Validates and returns watchlist type or default
 * @param value - Value to validate
 * @param defaultValue - Fallback if invalid
 */
export function validateWatchlistType(
  value: unknown,
  defaultValue: WatchlistType = WatchlistTypeEnum.BIGGEST_GAINERS
): WatchlistType {
  return isValidWatchlistType(value) ? value : defaultValue;
}

export interface WatchlistStock {
    /** Stock ticker symbol */
    ticker: string;
    /** Company name */
    company: string;
    /** Current stock price */
    price: number | null;
    /** Price change amount */
    change: number | null;
    /** Price change percentage */
    change_percent: number | null;
    /** Market capitalization in billions */
    market_cap: number | null;
    /** Price-to-earnings ratio (null if not available) */
    pe_ratio: number | null;
    /** Trading volume */
    volume: number | null;
    /** Average trading volume */
    avg_volume: number | null;
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

/**
 * Update labels to use enum
 */
export const WATCHLIST_LABELS: Record<WatchlistTypeEnum, string> = {
  [WatchlistTypeEnum.BIGGEST_GAINERS]: 'Biggest Gainers',
  [WatchlistTypeEnum.TRENDING]: 'Trending',
  [WatchlistTypeEnum.MOST_ACTIVE]: 'Most Active',
  [WatchlistTypeEnum.INSIDER_BUYING]: 'Insider Buying',
  [WatchlistTypeEnum.CONGRESS_TRADING]: 'Congress Trading',
  [WatchlistTypeEnum.TOP_GAINERS]: 'Top Gainers',
  [WatchlistTypeEnum.TOP_LOSERS]: 'Top Losers',
};

/**
 * Helper to get label from watchlist type
 */
export function getWatchlistLabel(type: WatchlistType): string {
  return WATCHLIST_LABELS[type as WatchlistTypeEnum] || type;
}

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

