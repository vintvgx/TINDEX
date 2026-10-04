// Mirrors the JSON shape MarketDigestGenerator (api/services/strategy/
// market_digest_generator.py) writes to market_digests.content_json.

export interface DigestSource {
  label: string;
  url: string;
}

export interface DigestMacroStat {
  label: string;
  symbol: string;
  value: number;
  change_percent: number | null;
  kind: 'index' | 'yield' | 'currency';
}

export interface DigestHeadline {
  text: string;
  source: string;
  url: string;
}

export interface DigestWatchlistTicker {
  ticker: string;
  price: number | null;
  change_percent: number | null;
  session: 'pre_market' | 'regular' | 'computed' | null;
  catalyst: string;
  level: string | null;
}

export interface DigestTrendingTicker {
  ticker: string;
  company: string;
  price: number | null;
  change_percent: number | null;
  volume: number | null;
}

export interface DigestMover {
  ticker: string;
  company: string;
  price: number | null;
  /** Dollar change vs. previous close — `price - change` gives the prior
   *  session's close for display alongside the live price. */
  change: number | null;
  change_percent: number | null;
  reason: string;
}

export interface DigestKeyLevel {
  ticker: string;
  level_low: number;
  level_high: number;
  direction: 'bullish' | 'bearish' | 'either';
  status: 'watching' | 'confirmed';
  price: number | null;
  change_percent: number | null;
  verdict: 'on_track' | 'stalling' | 'failing' | null;
  analysis: string;
}

export interface DigestEarning {
  ticker: string;
  when: 'before_open' | 'after_close';
  note: string;
}

export interface DigestEconomicEvent {
  time_et: string;
  label: string;
  consensus: string;
  prior: string;
}

export interface DigestTradingPeriod {
  net_pnl: number;
  trade_count: number;
  win_rate: number;
}

export interface DigestTradingLastSession extends DigestTradingPeriod {
  date: string;
}

export interface DigestTradingWeek extends DigestTradingPeriod {
  daily: Array<{ date: string; net_pnl: number }>;
}

export interface DigestTrading {
  last_session: DigestTradingLastSession | null;
  week: DigestTradingWeek | null;
  all_time: DigestTradingPeriod | null;
  advice: string;
}

export interface MarketDigestContent {
  digest_date: string;
  generated_at: string;
  market_setup: {
    note: string;
    source: DigestSource | null;
    stats: DigestMacroStat[];
  };
  headlines: DigestHeadline[];
  /** 3-4 AI bullets synthesizing `headlines` into the big picture — shown
   *  above the raw headline list, not a replacement for it. */
  headlines_summary: string[];
  watchlist: {
    mine: DigestWatchlistTicker[];
    trending: DigestTrendingTicker[];
    /** AI review of the trader's own active watched price levels against
     *  recent price action — empty when no levels are currently watched. */
    key_levels: DigestKeyLevel[];
  };
  movers: {
    gainers: DigestMover[];
    losers: DigestMover[];
  };
  events: {
    earnings: DigestEarning[];
    economic: DigestEconomicEvent[];
  };
  what_to_watch: string[];
  trading: DigestTrading;
}

export interface MarketDigestRow {
  id: string;
  digest_date: string;
  content_json: MarketDigestContent;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Muse brief v1 — the Muse-published morning digest
// (POST /muse/market-digest/publish → market_digests.content_json).
// Rendered by MuseDigestView; the Claude-era slides stay for history.
// ---------------------------------------------------------------------------

export interface MuseBriefLevels {
  support: number | null;
  resistance: number | null;
  orh: number | null;
  orl: number | null;
}

export interface MuseBriefTicker {
  ticker: string;
  score: number;
  /** Flat { component: points } — bars render each component's share of score. */
  components: Record<string, number>;
  direction: 'CALL' | 'PUT';
  setup: string;
  if_then: string;
  invalidation: string;
  levels: MuseBriefLevels;
  premium_tier: string;
  /** Present on muse_picks (Bandit's thesis); absent on watchlist picks. */
  thesis?: string;
}

export interface MuseBriefEtf {
  ticker: string;
  score: number;
  trend: 'up' | 'down' | 'flat';
  levels: { support: number | null; resistance: number | null };
  note: string;
}

export interface MuseBriefContent {
  version: 'muse-brief-v1';
  digest_date: string;
  generated_at: string;
  silent_update: boolean;
  market: {
    regime: 'risk-on' | 'risk-off' | 'chop';
    headline: string;
    futures: Record<string, string>;
    vix: number | null;
  };
  etfs: MuseBriefEtf[];
  watchlist: MuseBriefTicker[];
  muse_picks: MuseBriefTicker[];
  earnings_blackout: string[];
  correlation_note: string | null;
}

/** Narrow an unknown content_json to the Muse brief shape. */
export function isMuseBriefContent(c: unknown): c is MuseBriefContent {
  return (
    typeof c === 'object' && c !== null &&
    (c as { version?: unknown }).version === 'muse-brief-v1'
  );
}
