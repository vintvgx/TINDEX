import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase/supabase";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { MOCK_ORB_DATA, CALCULATION_MOCK_ORB_DATA } from "./mockData/orbMockData";

/**
 * Reversal Data Structure (from JSONB field)
 */
export interface ReversalData {
  original_breakout_type: 'above' | 'below';
  reversal_detected_at: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  score: number;
  max_score: number;
  score_percentage: number;
  vwap: number | null;
  indicators: string[];
  reversal_price: number;
  orb_high: number;
  orb_low: number;
  detection_metadata: {
    bars_analyzed: number;
    reversal_detection_method: string;
    indicators_count: number;
  };
}

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
  breakout_type: 'none' | 'invalidated' | 'Bullish' | 'Bearish' | 'Retesting Bullish' | 'Retesting Bearish' | 'Confirmed Bullish' | 'Confirmed Bearish' | 'reversal' | 'Offline';
  breakout_price: number | null;
  /** ISO deadline for the 3-minute confirmation hold — non-null only while
   *  breakout_type is exactly 'Bullish'/'Bearish' (see monitoring_state_cache.py).
   *  Optional: rows written before the confirm_deadline migration/backend
   *  deploy, or offline mock data, simply won't have it. */
  confirm_deadline?: string | null;
  volume: number | null;
  tracking: string | null;
  high_broken: boolean;
  low_broken: boolean;
  monitoring_active: boolean;
  timestamp?: string;
  reversal_data?: ReversalData | Record<string, any>; // Allow generic JSONB structure
  previous_close?: number | null;
  percentage_change?: number | null;
  data_source?: string | null;
  options_data?: Record<string, any>; // Generic JSONB structure for options data
  created_at?: string;
  updated_at?: string;
}

/**
 * Custom hook to fetch ORB monitoring state for all active tickers
 * Fetches today's monitoring state with real-time updates via Supabase Realtime
 * 
 * @param useMockData - Set to true to use mock data for preview (default: false)
 * @param useCalculationMockData - Set to true to use calculation period mock data (default: false)
 * @returns React Query result with ORB monitoring state data
 */
export function useORBMonitoringState(
  useMockData: boolean = false,
  useCalculationMockData: boolean = false
) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ['orb-monitoring-state', useMockData, useCalculationMockData],
    [useMockData, useCalculationMockData]
  );

  // Main query for fetching ORB monitoring state
  const queryResult = useQuery({
    queryKey,
    queryFn: async (): Promise<ORBMonitoringState[]> => {
      // Return calculation mock data if requested
      if (useCalculationMockData) {
        // Simulate async delay
        await new Promise(resolve => setTimeout(resolve, 500));
        return CALCULATION_MOCK_ORB_DATA;
      }
      
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

        .order('ticker', { ascending: true });

      if (error) {
        console.error('Error fetching ORB monitoring state:', error);
        throw error;
      }

      console.log(`[ORB Query] Fetched ${data?.length || 0} records`);
      
      // Return real data (empty array if no data)
      return (data || []) as ORBMonitoringState[];
    },
    staleTime: 0, // Always consider data stale so real-time updates trigger refetch
    refetchInterval: false, // No polling needed with real-time subscription
    retry: 2,
    retryDelay: 1000,
  });

  // Set up real-time subscription for live updates
  useEffect(() => {
    // Skip subscription if using mock data
    if (useMockData || useCalculationMockData) {
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    // Create a unique channel name for this subscription
    const channelName = `orb-monitoring-state-${Date.now()}`;
    
    // Track subscription state to avoid logging transient errors that resolve
    let subscriptionState: 'connecting' | 'subscribed' | 'error' | 'closed' = 'connecting';
    let hasLoggedError = false;
    
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
          
          if (!record || typeof record !== 'object' || !('trade_date' in record)) {
            console.debug('ORB update: Skipping event - invalid record structure');
            return;
          }
          
          if (record.trade_date !== today) {
            console.debug(`ORB update: Skipping event - trade_date mismatch (${record.trade_date} !== ${today})`);
            return;
          }
          
          const typedRecord = record as ORBMonitoringState;
          console.log(`🔄 ORB monitoring state changed: ${payload.eventType} for ${typedRecord.ticker}`);
          
          // Refetch query to get latest data immediately
          // Using refetchQueries ensures data is fetched even with staleTime: 0
          queryClient.refetchQueries({ queryKey }).catch((error) => {
            console.error('Error refetching ORB monitoring state:', error);
          });
        }
      )
      .subscribe((status) => {
        // Update subscription state
        if (status === 'SUBSCRIBED') {
          subscriptionState = 'subscribed';
          // Only log success if we previously logged an error (to show recovery)
          if (hasLoggedError) {
            console.log('✅ Subscribed to ORB monitoring state real-time updates (recovered from error)');
            hasLoggedError = false;
          } else {
            console.log('✅ Subscribed to ORB monitoring state real-time updates');
          }
        } else if (status === 'CHANNEL_ERROR') {
          // Only log error if we haven't already logged one and aren't already subscribed
          // This prevents logging transient errors that resolve quickly
          if (!hasLoggedError && subscriptionState !== 'subscribed') {
            console.warn('⚠️ Temporary error subscribing to ORB monitoring state updates (will retry)');
            hasLoggedError = true;
            subscriptionState = 'error';
          }
        } else if (status === 'TIMED_OUT') {
          subscriptionState = 'error';
          console.warn('⏱️ Subscription to ORB monitoring state timed out');
        } else if (status === 'CLOSED') {
          subscriptionState = 'closed';
          console.log('🔌 ORB monitoring state subscription closed');
        } else {
          // Log other statuses at debug level to reduce noise
          console.debug('📡 ORB monitoring state subscription status:', status);
        }
      });

    // Cleanup: unsubscribe when component unmounts or dependencies change
    return () => {
      console.log('Unsubscribing from ORB monitoring state updates');
      supabase.removeChannel(channel);
    };
  }, [useMockData, useCalculationMockData, queryClient, queryKey]);

  return queryResult;
}

