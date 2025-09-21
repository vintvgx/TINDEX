import { SortBy } from "@/types/blogPosts/create";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

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
}

// type SortBy = 'volume' | 'change' | 'pe' | 'marketcap';

/**
 * Custom hook to fetch trending stocks from the API
 * 
 * @param sortBy - The parameter to sort by ('volume', 'change', 'pe', 'marketcap')
 * @returns React Query result with trending stocks data
 */
// In your useTrendingStocks hook
export function useTrendingStocks(sortBy: SortBy = SortBy.VOLUME) {
    // const [delayComplete, setDelayComplete] = useState(false);
    
    // // Add a delay before enabling the query
    // useEffect(() => {
    //     const timer = setTimeout(() => {
    //         setDelayComplete(true);
    //     }, 500); // 500ms delay - adjust as needed
        
    //     return () => clearTimeout(timer);
    // }, []);

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
            
            console.log("Trending stocks fetching successfully")
            return data;
        },
        enabled: true, //TODO Verify this works before deleting delay ref
        // enabled: delayComplete, // Only enable after delay
        staleTime: 5 * 60 * 1000,
        retry: 2,
        retryDelay: 1000,
        refetchOnMount: true,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
    });
}