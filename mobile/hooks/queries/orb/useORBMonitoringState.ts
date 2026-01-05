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
  breakout_type: 'none' | 'invalidated' | 'Bullish' | 'Bearish' | 'Confirmed Bullish' | 'Confirmed Bearish' | 'reversal';
  breakout_price: number | null;
  volume: number | null;
  tracking: string | null;
  high_broken: boolean;
  low_broken: boolean;
  monitoring_active: boolean;
  timestamp?: string;
  reversal_data?: ReversalData;
  previous_close?: number | null;
  percentage_change?: number | null;
  data_source?: string | null;
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
    if (useMockData || useCalculationMockData) {
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
  }, [useMockData, useCalculationMockData, queryClient, queryKey]);

  return queryResult;
}

