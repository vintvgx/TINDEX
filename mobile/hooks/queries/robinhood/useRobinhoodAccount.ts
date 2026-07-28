import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { RobinhoodAccountSummary, RobinhoodHolding } from '@/common/types/robinhood';

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
