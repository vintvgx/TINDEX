import { SortBy } from "../blogPosts/create";

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
  isLoading: boolean;
  error: any;
  selectedSortBy: "volume" | "change" | "pe" | "marketcap";
  onSortChange: (sortBy: SortBy) => void;
  isQueryClientReady: boolean;
  scrollY: number; 
}