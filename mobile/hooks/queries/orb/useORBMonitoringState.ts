import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase/supabase";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

/**
 * ORB Monitoring State Record from Database
 */
export interface ORBMonitoringState {
  ticker: string;
  trade_date: string;
  opening_price: number | null;
  orb_high: number | null;
  orb_low: number | null;
  current_price: number | null;
  breakout_type: 'none' | 'invalidated' | 'Bullish' | 'Bearish' | 'Confirmed Bullish' | 'Confirmed Bearish';
  breakout_price: number | null;
  volume: number | null;
  tracking: string | null;
  high_broken: boolean;
  low_broken: boolean;
  monitoring_active: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Mock data for development/preview purposes
 */
const MOCK_ORB_DATA: ORBMonitoringState[] = [
  {
    ticker: 'AAPL',
    trade_date: new Date().toISOString().split('T')[0],
    opening_price: 175.50,
    orb_high: 178.25,
    orb_low: 174.80,
    current_price: 179.10,
    breakout_type: 'Confirmed Bullish',
    breakout_price: 178.30,
    volume: 45230000,
    tracking: null,
    high_broken: true,
    low_broken: false,
    monitoring_active: true,
  },
  {
    ticker: 'TSLA',
    trade_date: new Date().toISOString().split('T')[0],
    opening_price: 245.30,
    orb_high: 248.90,
    orb_low: 243.15,
    current_price: 242.50,
    breakout_type: 'Bearish',
    breakout_price: 243.00,
    volume: 67890000,
    tracking: null,
    high_broken: false,
    low_broken: true,
    monitoring_active: true,
  },
  {
    ticker: 'MSFT',
    trade_date: new Date().toISOString().split('T')[0],
    opening_price: 378.20,
    orb_high: 380.45,
    orb_low: 376.80,
    current_price: 379.25,
    breakout_type: 'none',
    breakout_price: null,
    volume: 23450000,
    tracking: null,
    high_broken: false,
    low_broken: false,
    monitoring_active: true,
  },
  {
    ticker: 'NVDA',
    trade_date: new Date().toISOString().split('T')[0],
    opening_price: 485.60,
    orb_high: 492.30,
    orb_low: 483.20,
    current_price: 495.80,
    breakout_type: 'Bullish',
    breakout_price: 492.50,
    volume: 56780000,
    tracking: null,
    high_broken: true,
    low_broken: false,
    monitoring_active: true,
  },
  {
    ticker: 'GOOGL',
    trade_date: new Date().toISOString().split('T')[0],
    opening_price: 142.40,
    orb_high: 144.20,
    orb_low: 141.50,
    current_price: 140.80,
    breakout_type: 'invalidated',
    breakout_price: null,
    volume: 34560000,
    tracking: null,
    high_broken: false,
    low_broken: false,
    monitoring_active: true,
  },
  {
    ticker: 'AMZN',
    trade_date: new Date().toISOString().split('T')[0],
    opening_price: 152.30,
    orb_high: 154.80,
    orb_low: 151.20,
    current_price: 153.45,
    breakout_type: 'none',
    breakout_price: null,
    volume: 41230000,
    tracking: null,
    high_broken: false,
    low_broken: false,
    monitoring_active: true,
  },
  {
    ticker: 'META',
    trade_date: new Date().toISOString().split('T')[0],
    opening_price: 312.50,
    orb_high: 318.90,
    orb_low: 310.20,
    current_price: 320.15,
    breakout_type: 'Confirmed Bullish',
    breakout_price: 319.00,
    volume: 28940000,
    tracking: null,
    high_broken: true,
    low_broken: false,
    monitoring_active: true,
  },
  {
    ticker: 'AMD',
    trade_date: new Date().toISOString().split('T')[0],
    opening_price: 128.40,
    orb_high: 131.20,
    orb_low: 127.10,
    current_price: 126.50,
    breakout_type: 'Confirmed Bearish',
    breakout_price: 127.00,
    volume: 52340000,
    tracking: null,
    high_broken: false,
    low_broken: true,
    monitoring_active: true,
  },
];

/**
 * Custom hook to fetch ORB monitoring state for all active tickers
 * Fetches today's monitoring state with real-time updates via Supabase Realtime
 * 
 * @param useMockData - Set to true to use mock data for preview (default: false)
 * @returns React Query result with ORB monitoring state data
 */
export function useORBMonitoringState(useMockData: boolean = false) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['orb-monitoring-state', useMockData], [useMockData]);

  // Main query for fetching ORB monitoring state
  const queryResult = useQuery({
    queryKey,
    queryFn: async (): Promise<ORBMonitoringState[]> => {
      // Return mock data if requested
      if (useMockData) {
        // Simulate async delay
        await new Promise(resolve => setTimeout(resolve, 500));
        return MOCK_ORB_DATA;
      }

      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      
      const { data, error } = await supabase
        .from('orb_monitoring_state')
        .select('*')
        .eq('trade_date', today)
        .eq('monitoring_active', true)
        .order('ticker', { ascending: true });

      if (error) {
        console.error('Error fetching ORB monitoring state:', error);
        throw error;
      }

      // Return real data (empty array if no data)
      return (data || []) as ORBMonitoringState[];
    },
    staleTime: Infinity, // Data is fresh as long as subscription is active
    refetchInterval: false, // No polling needed with real-time subscription
    retry: 2,
    retryDelay: 1000,
  });

  // Set up real-time subscription for live updates
  useEffect(() => {
    // Skip subscription if using mock data
    if (useMockData) {
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    // Create a unique channel name for this subscription
    const channelName = `orb-monitoring-state-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on<ORBMonitoringState>(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'orb_monitoring_state',
          filter: 'monitoring_active=eq.true', // Filter by monitoring_active at subscription level
        },
        (payload: RealtimePostgresChangesPayload<ORBMonitoringState>) => {
          // Additional filtering: only process events for today's trade_date
          // We filter here because 'today' is dynamic and can't be used in the subscription filter
          const record = payload.new || payload.old;
          if (
            record &&
            typeof record === 'object' &&
            'trade_date' in record &&
            record.trade_date === today
          ) {
            const typedRecord = record as ORBMonitoringState;
            console.log('ORB monitoring state changed:', payload.eventType, typedRecord.ticker);
            
            // Invalidate query to trigger refetch with latest filtered data
            // This ensures we always have the correct filtered and sorted results
            queryClient.invalidateQueries({ queryKey });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Subscribed to ORB monitoring state real-time updates');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Error subscribing to ORB monitoring state updates');
        }
      });

    // Cleanup: unsubscribe when component unmounts or dependencies change
    return () => {
      console.log('Unsubscribing from ORB monitoring state updates');
      supabase.removeChannel(channel);
    };
  }, [useMockData, queryClient, queryKey]);

  return queryResult;
}

