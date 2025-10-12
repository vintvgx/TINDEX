/**
 * Watchlist Hooks - Public API
 * 
 * This file serves as the main export point for all watchlist-related hooks.
 * Import watchlist hooks from this file in your components.
 * 
 * @example
 * ```tsx
 * import { useBiggestGainers, useWatchlist } from '@/hooks/queries/watchlist';
 * ```
 */

// Core hooks
export { useWatchlist, fetchWatchlist } from './useWatchlist';
export { useBiggestGainers } from './useBiggestGainers';

// Types
export type { BiggestGainerStock } from './useBiggestGainers';
export type {
  WatchlistType,
  WatchlistStock,
  WatchlistResponse,
  WatchlistQueryParams,
  UseWatchlistOptions,
} from '@/common/types/watchlist';

// Placeholder hooks (uncomment as they become available)
// export { useTrendingStocks } from './placeholders';
// export { useInsiderBuying } from './placeholders';
// export { useCongressTrading } from './placeholders';
// export { useTopGainers } from './placeholders';
// export { useTopLosers } from './placeholders';

