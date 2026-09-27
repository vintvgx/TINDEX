import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export type EntryDecision = 'ENTER' | 'WAIT' | 'DONT_ENTER';

export interface EntryCheck {
  ticker: string;
  direction: 'CALL' | 'PUT';
  price: number;
  as_of: string;          // ISO, America/New_York
  market_open: boolean;
  session_date: string | null;
  rows: {
    trend: { label: 'Bullish' | 'Bearish' | 'Chop'; price: number; ema20: number; ema50: number | null; ema200: number | null } | null;
    rsi: { value: number; zone: 'Overbought' | 'Neutral' | 'Oversold' } | null;
    vwap: { value: number; position: 'Above' | 'Below'; distance_pct: number } | null;
    orb: { position: 'Above high' | 'Below low' | 'Inside' | 'Forming'; high: number; low: number; distance_pct: number | null; source: 'live' | 'bars' } | null;
    sector: {
      sector: string | null; etf: string | null; label: 'Leading' | 'Lagging' | 'Inline' | 'n/a';
      sector_change_pct: number | null; spy_change_pct: number | null; relative_pct: number | null;
    } | null;
  };
  verdict: {
    decision: EntryDecision;
    score: number;
    factors_agree: number;
    factors_total: number;
    reason: string;
    blockers: string[];
    missing: string[];
    factors: { key: string; ok: boolean; points: number }[];
  };
  errors: Record<string, string> | null;
}

/**
 * Technicals gate for the trade entry sheet — see
 * api/services/entry_check_service.py. Refetches every 15s while the sheet
 * is open; keepPreviousData means a reopened sheet (or a refetch) shows the
 * last verdict immediately instead of flashing a loader.
 */
export function useEntryCheck(ticker: string | null | undefined, direction: 'CALL' | 'PUT', enabled = true) {
  return useQuery<EntryCheck>({
    queryKey: ['entry-check', ticker, direction],
    enabled: !!ticker && enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 15_000 : false,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const resp = await fetch(`${RAILWAY_BASE_URL}/strategy/entry-check/${ticker}?direction=${direction}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to load technicals');
      return json.data as EntryCheck;
    },
  });
}
