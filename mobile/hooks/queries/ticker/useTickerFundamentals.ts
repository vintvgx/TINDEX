import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { BriefEnvelope } from './useTickerBrief';

/**
 * Invest tab data (handoff spec 6) — GET /ticker/<sym>/fundamentals, same
 * {data, stale, error} envelope as the brief sections. Every field is
 * nullable: the tab hides any card whose value is missing.
 * Backend: api/services/ticker_brief/fundamentals.py.
 */

export interface RevenueBar {
  label: string;          // "FY26", "FY27E"
  value: number;          // USD
  estimate: boolean;
  fy_end?: string;
  low?: number | null;
  high?: number | null;
  analysts?: number | null;
}

export interface TickerFundamentals {
  name: string | null;
  sector: string | null;
  industry: string | null;
  about: string | null;
  price: number | null;
  market_cap: number | null;
  pe_trailing: number | null;
  pe_forward: number | null;
  peg: number | null;
  price_to_book: number | null;
  price_to_sales: number | null;
  ev_to_ebitda: number | null;
  dividend_yield_pct: number | null;
  ex_dividend_date: string | null;
  profit_margin_pct: number | null;
  operating_margin_pct: number | null;
  roe_pct: number | null;
  free_cashflow: number | null;
  revenue_growth_pct: number | null;
  earnings_growth_pct: number | null;
  beta: number | null;
  debt_to_equity: number | null;
  year_low: number | null;
  year_high: number | null;
  recommendation: string | null;
  target_mean: number | null;
  target_high: number | null;
  target_low: number | null;
  analyst_count: number | null;
  earnings_date: string | null;
  consensus: { buy: number; hold: number; sell: number } | null;
  revenue: { bars: RevenueBar[]; has_estimates: boolean; analysts: number | null } | null;
}

export function useTickerFundamentals(ticker: string | null | undefined, enabled = true) {
  return useQuery<BriefEnvelope<TickerFundamentals>>({
    queryKey: ['ticker-fundamentals', ticker],
    enabled: !!ticker && enabled,
    staleTime: 60 * 60_000,
    retry: 1,
    queryFn: async () => {
      try {
        const resp = await fetch(`${RAILWAY_BASE_URL}/ticker/${encodeURIComponent(ticker!)}/fundamentals`);
        return (await resp.json()) as BriefEnvelope<TickerFundamentals>;
      } catch (e) {
        return { data: null, stale: true, error: e instanceof Error ? e.message : 'network error' };
      }
    },
  });
}
