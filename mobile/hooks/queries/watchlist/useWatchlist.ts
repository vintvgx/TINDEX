import {
  WatchlistResponse
} from '@/common/types/watchlist';
import { prettyJSON } from '@/common/utils/strings/function';
import { useQuery } from '@tanstack/react-query';


/**
 * Custom hook to fetch biggest-gaining stocks from the FMP API call from backend
 * 
 * @param sortBy - The parameter to sort by ('volume', 'change', 'pe', 'marketcap')
 * @returns React Query result with trending stocks data
 */
export function useWatchlists()  {

  return useQuery({
    queryKey: ['watchlist'],
    queryFn: async(): Promise<WatchlistResponse> => {
      const response = await fetch(`https://alethia-production.up.railway.app/watchlist/all`)

      if (!response.ok) {
        throw new Error(`Failed to fetch watchlists: ${response.statusText}`);
      }

      const data = await response.json();
            
      if (!data.success) {
          throw new Error(data.error || 'Failed to fetch biggest-gainers watchlists');
      }
      
      console.log("All watchlists fetching successfully")
      console.log(prettyJSON(data))
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

