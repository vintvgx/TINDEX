import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

/**
 * Ticker Brief sections — one endpoint (and one query) per section of the
 * ticker sheet, so each renders as soon as its own data lands and a slow or
 * failing section never holds up the rest. See api/routes/ticker_brief_routes.py.
 *
 * Every endpoint answers 200 with {data, asOf, ttlSeconds, stale, error?}.
 * `data: null` means the section is unavailable; `stale: true` with data
 * means the server is serving its last good value after a failed refresh.
 */
export interface BriefEnvelope<T> {
  data: T | null;
  asOf?: string;
  ttlSeconds?: number;
  stale: boolean;
  error?: string;
}

export interface BriefZone {
  low: number;
  high: number;
  score: number;
  touches: number;
  type: 'support' | 'resistance';
  sources: string[];
  distance_pct?: number;
}

export interface BriefSnapshot {
  price: number;
  previous_close: number | null;
  change: number | null;
  change_pct: number | null;
  market_cap: number | null;
  name: string | null;
  summary: string | null;
  sector: string | null;
  industry: string | null;
}

export interface BriefLevels {
  price: number;
  support: BriefZone[];
  resistance: BriefZone[];
  above: BriefZone | null;
  below: BriefZone | null;
  inside: BriefZone | null;
  zone_stale: boolean;
}

export interface BriefFlow {
  expiries: string[];
  spot: number | null;
  pc_volume: number | null;
  pc_oi: number | null;
  call_volume: number;
  put_volume: number;
  call_oi: number;
  put_oi: number;
  unusual: { strike: number; type: 'call' | 'put'; expiry: string; volume: number; open_interest: number; vol_oi: number }[];
  atm_iv_pct: number | null;
  max_pain: number | null;
  call_wall: { strike: number; open_interest: number }[];
  put_wall: { strike: number; open_interest: number }[];
}

export interface BriefAnalysts {
  recommendation: string | null;
  target_mean: number | null;
  analyst_count: number | null;
  recent_changes: { date: string; firm: string | null; action: string | null; grade: string | null }[] | null;
}

export interface BriefInstitutional {
  top_holders: { holder: string | null; pct_out: number | null; shares: number | null; reported: string | null }[];
  trend: { top_holders_change_pct: number; holders_counted: number } | null;
  institutions_pct_held: number | null;
}

export interface BriefLinked {
  name: string;
  ticker: string;
  relation: 'Supplier' | 'Customer' | 'Competitor' | 'Partner' | 'Peer';
  note: string;
}

export interface BriefCatalysts {
  next_earnings: string | null;
  momentum: {
    return_20d_pct: number | null;
    spy_return_20d_pct: number | null;
    volume_5d_vs_20d: number | null;
    line: string | null;
  } | null;
  news: { title: string; date: string | null }[] | null;
  news_as_of: string | null;
  errors: Record<string, string> | null;
}

type SectionMap = {
  snapshot: BriefSnapshot;
  levels: BriefLevels;
  flow: BriefFlow;
  analysts: BriefAnalysts;
  institutional: BriefInstitutional;
  linked: BriefLinked[];
  catalysts: BriefCatalysts;
};

export type BriefSection = keyof SectionMap;

// Client refetch cadence per section — mirrors the server TTLs (the server
// cache is the real throttle; this just keeps the sheet from re-asking for
// data that can't have changed).
const STALE_MS: Record<BriefSection, number> = {
  snapshot: 60_000,
  levels: 90_000,
  flow: 15 * 60_000,
  analysts: 60 * 60_000,
  institutional: 60 * 60_000,
  linked: 60 * 60_000,
  catalysts: 60 * 60_000,
};

async function fetchSection<S extends BriefSection>(ticker: string, section: S): Promise<BriefEnvelope<SectionMap[S]>> {
  const resp = await fetch(`${RAILWAY_BASE_URL}/ticker/${encodeURIComponent(ticker)}/${section}`);
  try {
    return (await resp.json()) as BriefEnvelope<SectionMap[S]>;
  } catch {
    return { data: null, stale: true, error: `HTTP ${resp.status}` };
  }
}

/** One brief section. A network failure resolves to an "unavailable"
 *  envelope rather than throwing, so every section has the same states. */
export function useBriefSection<S extends BriefSection>(ticker: string | null | undefined, section: S) {
  return useQuery<BriefEnvelope<SectionMap[S]>>({
    queryKey: ['ticker-brief', section, ticker],
    enabled: !!ticker,
    staleTime: STALE_MS[section],
    refetchInterval: section === 'snapshot' || section === 'levels' ? STALE_MS[section] : false,
    retry: 1,
    queryFn: async () => {
      try {
        return await fetchSection(ticker!, section);
      } catch (e) {
        return { data: null, stale: true, error: e instanceof Error ? e.message : 'network error' };
      }
    },
  });
}

/** Payload the explanation endpoint explains — exactly what the Bottom
 *  Line is showing. */
export interface GateForExplain {
  ticker: string;
  signal: string | null;
  price: number | null;
  rows: unknown;
  verdicts: { CALL: unknown; PUT: unknown };
}

/** ≤35-word explanation of the gate verdict on screen. Keyed on the
 *  verdict content, so a changed verdict never shows an old explanation. */
export function useGateExplanation(ticker: string | null | undefined, gate: GateForExplain | null, signature: string | null) {
  return useQuery<BriefEnvelope<{ text: string | null }>>({
    queryKey: ['ticker-brief', 'explain', ticker, signature],
    enabled: !!ticker && !!gate && !!signature,
    staleTime: 24 * 60 * 60_000,
    retry: 1,
    queryFn: async () => {
      try {
        const resp = await fetch(`${RAILWAY_BASE_URL}/ticker/${encodeURIComponent(ticker!)}/explain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gate),
        });
        return (await resp.json()) as BriefEnvelope<{ text: string | null }>;
      } catch (e) {
        return { data: null, stale: true, error: e instanceof Error ? e.message : 'network error' };
      }
    },
  });
}

export interface PositioningRead {
  direction: 'CALL' | 'PUT';
  expiry: string | null;
  is_0dte: boolean;
  target: number | null;
  modifier: -1 | 0 | 1;
  weighted_score: number;
  headline: string;
  reasons: { component: string; score: number; weight: number; text: string }[];
  flags: { target_beyond_wall: boolean; crowded_caution: boolean; expensive_premium: boolean; stale: boolean };
  notes: string[];
  chain_as_of: string;
  inputs: {
    spot: number | null;
    front_expiry: string;
    pc_vol: number | null;
    pc_oi: number | null;
    iv_est: number | null;
    max_pain: number | null;
    call_walls: { strike: number; open_interest: number }[];
    put_walls: { strike: number; open_interest: number }[];
  };
}

/** Positioning confluence for a trade (GET /ticker/<sym>/positioning).
 *  Display-only: it never changes the Technicals Gate verdict. With no
 *  direction it still returns the direction-free inputs (walls, max pain)
 *  the chart draws. */
export function usePositioning(
  ticker: string | null | undefined,
  direction: 'CALL' | 'PUT' = 'CALL',
  expiry?: string | null,
  enabled = true,
) {
  return useQuery<BriefEnvelope<PositioningRead>>({
    queryKey: ['ticker-brief', 'positioning', ticker, direction, expiry ?? null],
    enabled: !!ticker && enabled,
    staleTime: 90_000,
    refetchInterval: enabled ? 90_000 : false,
    retry: 1,
    queryFn: async () => {
      const params = new URLSearchParams({ direction });
      if (expiry) params.set('expiry', expiry.slice(0, 10));
      try {
        const resp = await fetch(`${RAILWAY_BASE_URL}/ticker/${encodeURIComponent(ticker!)}/positioning?${params}`);
        return (await resp.json()) as BriefEnvelope<PositioningRead>;
      } catch (e) {
        return { data: null, stale: true, error: e instanceof Error ? e.message : 'network error' };
      }
    },
  });
}
