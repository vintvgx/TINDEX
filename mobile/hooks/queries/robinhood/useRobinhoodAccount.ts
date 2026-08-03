import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { loggedFetch } from '@/lib/loggedFetch';
import type {
  RobinhoodAccountSummary,
  RobinhoodEquityHistory,
  RobinhoodEquityHistorySpan,
  RobinhoodHolding,
  RobinhoodOptionPosition,
} from '@/common/types/robinhood';

// robin_stocks's login() call is a synchronous network round-trip to
// Robinhood that this same request blocks on server-side (see
// robinhood_service.py's _ensure_login/_attempt_login) — if Robinhood's
// unofficial API just never responds, the request would otherwise hang
// indefinitely instead of surfacing as a failed connection attempt.
const ROBINHOOD_TIMEOUT_MS = 60_000;

/**
 * Robinhood account summary — view-only (see api's robinhood_service.py;
 * no order-placement path exists for this integration by design).
 *
 * `enabled` defaults to true for back-compat, but the one real caller
 * (robinhood_overview.tsx) always passes it explicitly — the backend GET
 * this hook fires makes a real Robinhood login attempt the first time
 * there's no active session (see robinhood_service.py's _ensure_login),
 * which can trigger a live SMS challenge, so it must never fire before the
 * user has explicitly asked to connect.
 */
export function useRobinhoodAccount(enabled: boolean = true) {
  return useQuery<RobinhoodAccountSummary>({
    queryKey: ['robinhood-account'],
    queryFn: async () => {
      const res = await loggedFetch(`${RAILWAY_BASE_URL}/robinhood/account`, {}, ROBINHOOD_TIMEOUT_MS);
      if (!res.ok) throw new Error('Failed to fetch Robinhood account');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Robinhood account fetch failed');
      return json.data as RobinhoodAccountSummary;
    },
    enabled,
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

export function useRobinhoodHoldings(enabled: boolean = true) {
  return useQuery<RobinhoodHoldingsResponse>({
    queryKey: ['robinhood-holdings'],
    queryFn: async () => {
      const res = await loggedFetch(`${RAILWAY_BASE_URL}/robinhood/positions`, {}, ROBINHOOD_TIMEOUT_MS);
      const json = await res.json();
      return json as RobinhoodHoldingsResponse;
    },
    enabled,
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
      const res = await loggedFetch(`${RAILWAY_BASE_URL}/robinhood/equity-history?span=${span}`, {}, ROBINHOOD_TIMEOUT_MS);
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
      const res = await loggedFetch(`${RAILWAY_BASE_URL}/robinhood/options`, {}, ROBINHOOD_TIMEOUT_MS);
      const json = await res.json();
      return json as RobinhoodOptionPositionsResponse;
    },
    enabled,
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: 1,
  });
}
