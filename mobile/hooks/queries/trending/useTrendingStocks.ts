import { SortBy } from "@/common/types/blogPosts/create";
import { logDebug } from "@/common/utils/strings/function";
import { useQuery } from "@tanstack/react-query";

interface TrendingStock {
    ticker: string;
    company: string;
    sector: string;
    industry: string;
    market_cap: string;
    pe: string;
    price: string;
    change: string; 
    volume: string;
}

interface TrendingStockResponse {
    count: number;
    data: TrendingStock[];
    sorted_by: string;
    success: boolean;
    timestamp: number;
    source?: string;
    error?: string; 
}

// type SortBy = 'volume' | 'change' | 'pe' | 'marketcap';

/**
 * Custom hook to fetch trending stocks from the API
 * 
 * @param sortBy - The parameter to sort by ('volume', 'change', 'pe', 'marketcap')
 * @returns React Query result with trending stocks data
 */
export function useTrendingStocks(sortBy: SortBy = SortBy.VOLUME) {

    return useQuery({
        queryKey: ['trending-stocks', sortBy],
        queryFn: async (): Promise<TrendingStockResponse> => {
            const response = await fetch(
                `https://alethia-test-eng.up.railway.app/trending-stocks-sort?sort_by=${sortBy}`
            );
            
            if (!response.ok) {
                throw new Error(`Failed to fetch trending stocks: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to fetch trending stocks');
            }
            
            logDebug("Trending stocks fetched")
            return data;
        },
        enabled: true, 
        staleTime: 5 * 60 * 1000,
        retry: 2,
        retryDelay: 1000,
        refetchOnMount: true,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
    });
}