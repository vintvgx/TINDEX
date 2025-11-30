import { SortBy } from "../blogPosts/create";
import { UserProfile } from "../user/authModel";
import { WatchlistResponse, WatchlistType } from "../watchlist";

export interface Stock {
  ticker: string;
  company: string;
  price: string;
  change: string;
  volume: string;
}

export interface TrendingStocksCardProps {
  stocks?: { data: Stock[] };
  isLoading: boolean;
  error: any;
  selectedSortBy: "volume" | "change" | "pe" | "marketcap";
  onSortChange: (sortBy: SortBy) => void;
  isQueryClientReady: boolean;
}

export interface MinimizedTrendingStocksProps {
    stocks?: { data: Stock[] }
    isLoading: boolean
    error: any
}

// New unified component interface
export interface UnifiedTrendingStocksProps {
  stocks?: { data: Stock[], timestamp: number };
  watchlists?: WatchlistResponse;
  isLoading: boolean;
  error: any;
  isQueryClientReady: boolean;
  openSetWatchlistModal: () => void
  profile: UserProfile | null;
  onErrorOrNoDataChange?: (hasErrorOrNoData: boolean) => void;
}