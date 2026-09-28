import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export type EntryDecision = 'ENTER' | 'WAIT' | 'DONT_ENTER';
/** Direction-free signal for charts — see entry_check_service.chart_signal. */
export type ChartSignal = 'CALL' | 'PUT' | 'WAIT' | 'NA';

export interface EntryVerdict {
  decision: EntryDecision;
  score: number;
  factors_agree: number;
  factors_total: number;
  reason: string;
  blockers: string[];
  missing: string[];
  factors: { key: string; ok: boolean; points: number; note?: string | null }[];
}

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
  verdict: EntryVerdict;
  /** Optional: added in a later API version — older deploys omit them. */
  verdicts?: { CALL: EntryVerdict; PUT: EntryVerdict };
  signal?: ChartSignal;
  errors: Record<string, string> | null;
}

/**
 * Technicals gate for the trade entry sheet — see
 * api/services/entry_check_service.py. Refetches every 15s while the sheet
 * is open. Deliberately NO placeholderData: carrying the previous
 * ticker/direction's verdict over while a new one loads would let the buy
 * button offer Review on a stale ENTER. Refetches while the sheet stays open
 * keep the current verdict on screen; gcTime 0 covers reopening later.
 */
export async function fetchEntryCheck(ticker: string, direction: 'CALL' | 'PUT'): Promise<EntryCheck> {
  const resp = await fetch(`${RAILWAY_BASE_URL}/strategy/entry-check/${ticker}?direction=${direction}`);
  // A proxy/gateway error (502 HTML page, empty body) isn't JSON —
  // surface a readable message instead of the raw JSON parser error.
  let json: { success?: boolean; data?: EntryCheck; error?: string };
  try {
    json = await resp.json();
  } catch {
    throw new Error(`Technicals service unavailable (HTTP ${resp.status})`);
  }
  if (!resp.ok || !json.success || !json.data) {
    throw new Error(json.error ?? `Failed to load technicals (HTTP ${resp.status})`);
  }
  return json.data;
}

export function useEntryCheck(ticker: string | null | undefined, direction: 'CALL' | 'PUT', enabled = true) {
  return useQuery<EntryCheck>({
    queryKey: ['entry-check', ticker, direction],
    enabled: !!ticker && enabled,
    staleTime: 10_000,
    // Drop the verdict as soon as no sheet is using it, so reopening the
    // same contract minutes later never flashes (or gates on) an old one.
    gcTime: 0,
    refetchInterval: enabled ? 15_000 : false,
    queryFn: () => fetchEntryCheck(ticker!, direction),
  });
}
