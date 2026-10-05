import { useCallback, useEffect, useRef, useState } from "react";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { PricePeriod, TickerHistoryData } from "@/common/types/blogPosts/ticker";

/**
 * Lazy-loading chart history for the TradingView chart.
 *
 * The period slider is only the *initial viewport* — data is no longer
 * bounded by it. For intraday intervals the initial fetch is a ~3-month
 * windowed call (or as much as Yahoo serves for that bar size) (POST /ticker/<ticker>/history {interval, start, end}),
 * and `loadMore()` backfills older windows as the user pans left. Daily+
 * intervals keep the existing period fetch (they already span years).
 *
 * Bars merge by timestamp (dedupe + ascending sort), so the tail poll,
 * backfills and the initial load all fold into one growing array that the
 * chart's EMAs / VWAP / ORB boxes recompute from.
 */

const INTRADAY = new Set(["1m", "5m", "15m", "30m", "1h"]);
// Initial load sizes in days: ~3 months where Yahoo has it. 5m/15m/30m
// only exist for the last ~60 days and 1m for ~7 (backend caps match), so
// those load everything available.
const INITIAL_DAYS: Record<string, number> = { "1m": 7, "5m": 60, "15m": 60, "30m": 60, "1h": 92 };
// Daily+ bars load by period — never less than 3 months up front.
const MIN_DAILY_PERIOD: Partial<Record<PricePeriod, PricePeriod>> = { "1D": "3M", "1W": "3M", "1M": "3M" };
// Backfill chunk sizes in days — at or below the backend's Yahoo caps
// (5m/15m/30m ~60d, 1m ~7d, 1h ~730d).
const BACKFILL_DAYS: Record<string, number> = { "1m": 7, "5m": 55, "15m": 55, "30m": 55, "1h": 120 };
// Live tail poll re-fetches this many days back and merges.
const TAIL_DAYS = 5;

class HistoryHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Today in New York as YYYY-MM-DD. */
function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/** Add n days to a YYYY-MM-DD calendar date (exact — pure date arithmetic). */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

async function postHistory(ticker: string, body: object, signal?: AbortSignal): Promise<TickerHistoryData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(`${RAILWAY_BASE_URL}/ticker/${ticker}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new HistoryHttpError(err.error || res.statusText, res.status);
    }
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "history fetch failed");
    return json.data as TickerHistoryData;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Merge `incoming` into `current`: dedupe by date, ascending order.
 *  On a duplicate timestamp the INCOMING bar wins — a tail poll re-fetches
 *  the still-forming bar, and keeping the stale copy (the old behavior)
 *  meant the live candle never updated, only new ones got appended.
 *  Session lines come from the incoming payload only when it's the live
 *  tail (`sessionFromIncoming`); a backfill window's lines describe some
 *  older day and must not replace today's. */
function mergeHistory(
  current: TickerHistoryData,
  incoming: TickerHistoryData,
  sessionFromIncoming = false,
): TickerHistoryData {
  const a = incoming;
  const b = current;
  const seen = new Set<string>();
  const dates: string[] = [];
  const prices: number[] = [];
  const volumes: number[] = [];
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const push = (d: TickerHistoryData, i: number) => {
    dates.push(d.dates[i]);
    prices.push(d.prices[i]);
    volumes.push(d.volumes?.[i] ?? 0);
    opens.push(d.opens?.[i] ?? d.prices[i]);
    highs.push(d.highs?.[i] ?? d.prices[i]);
    lows.push(d.lows?.[i] ?? d.prices[i]);
  };
  for (const [d] of [[a], [b]] as const) {
    for (let i = 0; i < d.dates.length; i++) {
      if (seen.has(d.dates[i])) continue;
      seen.add(d.dates[i]);
      push(d, i);
    }
  }
  const order = dates.map((_, i) => i).sort((x, y) => (dates[x] < dates[y] ? -1 : 1));
  const at = <T,>(arr: T[]): T[] => order.map((i) => arr[i]);
  return {
    dates: at(dates),
    prices: at(prices),
    volumes: at(volumes),
    opens: at(opens),
    highs: at(highs),
    lows: at(lows),
    interval: b.interval ?? a.interval,
    session_lines: sessionFromIncoming
      ? (incoming.session_lines ?? current.session_lines)
      : current.session_lines,
  };
}

export interface LazyHistory {
  data: TickerHistoryData | null;
  isLoading: boolean;
  isError: boolean;
  /** Backfill the next older window. No-op when not intraday, already
   *  loading, or history is exhausted. */
  loadMore: () => void;
  loadingMore: boolean;
  exhausted: boolean;
}

export function useLazyTickerHistory(opts: {
  ticker: string;
  period: PricePeriod;
  interval?: string;
  /** Live tail poll (e.g. 30s on 1D) — merges the last few days. */
  pollMs?: number;
  enabled?: boolean;
  /** 1D/intraday: keep the extended-hours session (premarket candles). */
  extendedHours?: boolean;
}): LazyHistory {
  const { ticker, period, interval, pollMs, enabled = true, extendedHours = false } = opts;
  const [bars, setBars] = useState<TickerHistoryData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const live = useRef({ bars: null as TickerHistoryData | null, loadingMore: false, exhausted: false });
  live.current = { bars, loadingMore, exhausted };
  const prevTicker = useRef(ticker);
  // Generation: bumped every time the initial-load effect (re)runs. An
  // in-flight backfill or tail poll from the previous ticker/period/interval
  // must not merge its bars — or its exhausted flag — into the new one.
  const gen = useRef(0);

  const intraday = !!interval && INTRADAY.has(interval);

  // ── Initial load ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !ticker) return;
    const tickerChanged = prevTicker.current !== ticker;
    prevTicker.current = ticker;
    // Bump the generation: any in-flight backfill or tail poll captured the
    // previous value and will discard its result below.
    gen.current += 1;
    // New ticker → blank chart (never flash the previous ticker's bars);
    // period/interval switch keeps old bars until the new ones land.
    if (tickerChanged) setBars(null);
    let dead = false;
    const ctrl = new AbortController();
    setIsLoading(true);
    setIsError(false);
    setExhausted(false);
    (async () => {
      try {
        if (intraday) {
          const fullDays = INITIAL_DAYS[interval!] ?? 30;
          // Backend window is [start, end) — end on tomorrow so today's
          // bars are included on trading days.
          const end = addDays(etToday(), 1);
          // Staged initial load: the full 60-day window is ~3,100 bars /
          // ~330KB, which the phone then has to parse, inject into the
          // WebView, and render — that's the "chart takes a while" wait.
          // Stage 1 fetches just the last few days (~400 bars) so candles
          // paint immediately; the on-chart indicators (EMAs up to 200,
          // session-anchored VWAP) only need this much. Stage 2 backfills
          // the rest for pan-back in the background.
          const quickDays = Math.min(interval === "1m" ? 2 : 5, fullDays);
          const quickStart = addDays(end, -quickDays);
          const quick = await postHistory(ticker, { interval, start: quickStart, end,
            ...(extendedHours ? { extended_hours: true } : {}) }, ctrl.signal);
          if (!dead) {
            setBars(quick);
            setIsLoading(false);
          }
          if (!dead && fullDays > quickDays) {
            const rest = await postHistory(ticker, { interval, start: addDays(end, -fullDays), end: quickStart,
              ...(extendedHours ? { extended_hours: true } : {}) }, ctrl.signal);
            if (!dead) setBars((prev) => (prev ? mergeHistory(prev, rest) : rest));
          }
          if (dead) return;
          // Bars already set above (stage 1 + stage 2); nothing left to do.
        } else {
          const fetchPeriod = MIN_DAILY_PERIOD[period] ?? period;
          const data = await postHistory(ticker, { period: fetchPeriod, ...(interval ? { interval } : {}),
            ...(extendedHours ? { extended_hours: true } : {}) }, ctrl.signal);
          if (!dead) {
            setBars(data);
            setIsLoading(false);
          }
        }
      } catch (e) {
        // DOMException may not exist on Hermes — check the name instead.
        const aborted = (e as { name?: string } | null)?.name === "AbortError";
        if (!dead && !aborted) {
          setIsError(true);
          setIsLoading(false);
        }
      }
    })();
    return () => {
      dead = true;
      ctrl.abort();
    };
  }, [enabled, ticker, period, interval, intraday, extendedHours]);

  // ── Backfill ──────────────────────────────────────────────────────
  const loadMore = useCallback(() => {
    const s = live.current;
    if (!enabled || !intraday || s.loadingMore || s.exhausted || !s.bars?.dates?.length) return;
    const myGen = gen.current;
    setLoadingMore(true);
    (async () => {
      try {
        const oldest = s.bars!.dates[0].slice(0, 10);
        const chunk = BACKFILL_DAYS[interval!] ?? 55;
        const data = await postHistory(ticker, {
          interval,
          start: addDays(oldest, -chunk),
          end: oldest,
          ...(extendedHours ? { extended_hours: true } : {}),
        });
        // Ticker/period/interval moved on mid-flight: this window belongs to
        // the old one. Drop it — a 400 here must not mark the NEW ticker
        // exhausted, and its bars must not merge into the new series.
        if (myGen !== gen.current) return;
        if (!data.dates?.length) {
          setExhausted(true);
        } else {
          setBars((prev) => (prev ? mergeHistory(prev, data) : data));
        }
      } catch (e) {
        if (myGen !== gen.current) return;
        // 400 = past Yahoo's lookback cap (or bad window) → genuinely no
        // more history; stop asking. Anything else (network) just lets the
        // next pan retry.
        if (e instanceof HistoryHttpError && e.status === 400) setExhausted(true);
      } finally {
        // Always clear: a stuck `true` would block the new ticker's
        // backfills forever; a redundant `false` is harmless.
        setLoadingMore(false);
      }
    })();
  }, [enabled, intraday, ticker, interval, extendedHours]);

  // ── Live tail poll ────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !pollMs || !intraday) return;
    const id = setInterval(async () => {
      const s = live.current;
      if (!s.bars?.dates?.length || s.loadingMore) return;
      const myGen = gen.current;
      try {
        const end = addDays(etToday(), 1);
        const data = await postHistory(ticker, { interval, start: addDays(end, -TAIL_DAYS), end,
          ...(extendedHours ? { extended_hours: true } : {}) });
        // A ticker/period/interval switch mid-flight: don't merge the old
        // ticker's tail into the new ticker's chart.
        if (myGen !== gen.current) return;
        setBars((prev) => (prev ? mergeHistory(prev, data, true) : data));
      } catch {
        /* next poll retries */
      }
    }, pollMs);
    return () => clearInterval(id);
  }, [enabled, pollMs, ticker, interval, intraday, extendedHours]);

  return { data: bars, isLoading, isError, loadMore, loadingMore, exhausted };
}
