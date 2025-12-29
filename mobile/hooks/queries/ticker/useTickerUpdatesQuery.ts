import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/supabase';

/**
 * Ticker update interface matching the database schema
 */
export interface TickerUpdate {
  id: string;
  ticker: string;
  content: string;
  character_count: number | null;
  tags: string[] | null;
  stock_research_id: string | null;
  research_data: any | null;
  model_used: string | null;
  target_length: number | null;
  status: string;
  published_at: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Hook to fetch ticker updates for a specific ticker, sorted by date (newest first)
 * 
 * @param ticker - The stock ticker symbol
 * @param limit - Maximum number of updates to fetch (default: 50)
 * @returns Query object with ticker updates data
 */
export const useTickerUpdatesQuery = (ticker: string, limit: number = 50) => {
  return useQuery({
    queryKey: ['ticker-updates', ticker, limit],
    queryFn: async (): Promise<TickerUpdate[]> => {
      if (!ticker) {
        return [];
      }

      const { data, error } = await supabase
        .from('ticker_updates')
        .select('*')
        .eq('ticker', ticker.toUpperCase())
        .eq('status', 'published') // Only fetch published updates
        .order('published_at', { ascending: false }) // Sort by date, newest first
        .order('created_at', { ascending: false }) // Fallback to created_at if published_at is null
        .limit(limit);

      if (error) {
        console.error('Error fetching ticker updates:', error);
        throw error;
      }

      return (data || []) as TickerUpdate[];
    },
    enabled: !!ticker,
    staleTime: 30 * 1000, // 30 seconds - updates are relatively static
    retry: 2,
  });
};

