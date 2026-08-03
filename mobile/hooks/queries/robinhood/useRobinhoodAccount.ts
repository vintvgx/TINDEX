import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type {
  RobinhoodAccountSummary,
  RobinhoodEquityHistory,
  RobinhoodEquityHistorySpan,
  RobinhoodHolding,
  RobinhoodOptionPosition,
} from '@/common/types/robinhood';

/**
 * Robinhood account summary — view-only (see api's robinhood_service.py;
 * no order-placement path exists for this integration by design).
 */
export function useRobinhoodAccount() {
  return useQuery<RobinhoodAccountSummary>({
    queryKey: ['robinhood-account'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/robinhood/account`);
      if (!res.ok) throw new Error('Failed to fetch Robinhood account');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Robinhood account fetch failed');
      return json.data as RobinhoodAccountSummary;
    },
    // Robinhood's client is an unofficial, reverse-engineered API — polled
    // less aggressively than Alpaca's official one to avoid drawing
    // attention from its abuse detection (see backend cache TTL).
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: 1,
  });
}

export interface RobinhoodHoldingsResponse {
  success: boolean;
  holdings: RobinhoodHolding[];
  status?: RobinhoodAccountSummary['status'];
  message?: string;
}

export function useRobinhoodHoldings() {
  return useQuery<RobinhoodHoldingsResponse>({
    queryKey: ['robinhood-holdings'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/robinhood/positions`);
      const json = await res.json();
      return json as RobinhoodHoldingsResponse;
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: 1,
  });
}

/** Backs the Day P/L sparkline — see robinhood_service.py's get_equity_history. */
export function useRobinhoodEquityHistory(span: RobinhoodEquityHistorySpan = 'day', enabled: boolean = true) {
  return useQuery<RobinhoodEquityHistory>({
    queryKey: ['robinhood-equity-history', span],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/robinhood/equity-history?span=${span}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.data?.message || 'Robinhood equity history fetch failed');
      return json.data as RobinhoodEquityHistory;
    },
    enabled,
    // Intraday marks don't need to be re-fetched as aggressively as the
    // live account summary — this is a background line, not the headline number.
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: 1,
  });
}

export interface RobinhoodOptionPositionsResponse {
  success: boolean;
  positions: RobinhoodOptionPosition[];
  status?: RobinhoodAccountSummary['status'];
  message?: string;
}

/** Open Robinhood option positions — separate from the stock holdings list. */
export function useRobinhoodOptionPositions(enabled: boolean = true) {
  return useQuery<RobinhoodOptionPositionsResponse>({
    queryKey: ['robinhood-option-positions'],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/robinhood/options`);
      const json = await res.json();
      return json as RobinhoodOptionPositionsResponse;
    },
    enabled,
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: 1,
  });
}
