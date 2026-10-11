import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

/**
 * Unified P&L (handoff spec 5, 2026-10-11) — the ONE source for account P&L
 * by period. Home's account card, the Trade Log header and the Accounts
 * screen all read this; none of them do period P&L math of their own.
 * Backend: GET /strategy/accounts/pnl-summary (services/strategy/pnl_summary.py).
 *
 *   total        realized_net + unrealized — the headline figure
 *   realized_net realized_gross − fees (fees estimated at $0.70/contract/side)
 *   unrealized   open positions marked live, the same for every period
 */

export type PnlPeriod = 'today' | 'week' | 'month' | 'ytd' | 'all_time';

export interface PnlPeriodSummary {
  realized_gross: number;
  fees: number;
  realized_net: number;
  unrealized: number;
  total: number;
  trades_closed: number;
}

export type PnlSummary = Record<PnlPeriod, PnlPeriodSummary> & {
  success: boolean;
  mode: 'live' | 'paper';
  as_of: string;
  cached: boolean;
  open_positions: number;
};

export const PNL_SUMMARY_KEY = 'pnl-summary';

export function usePnlSummary(mode: 'live' | 'paper', enabled = true) {
  return useQuery<PnlSummary>({
    queryKey: [PNL_SUMMARY_KEY, mode],
    queryFn: async () => {
      const res = await fetch(`${RAILWAY_BASE_URL}/strategy/accounts/pnl-summary?mode=${mode}`);
      if (!res.ok) throw new Error('Failed to fetch P&L summary');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'P&L summary failed');
      return json as PnlSummary;
    },
    enabled,
    // Unrealized moves with the market; realized is served from the cache
    // (invalidated server-side on every close), so a 30s poll is cheap.
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
}
