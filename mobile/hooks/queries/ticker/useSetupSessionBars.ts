import { useQuery } from "@tanstack/react-query";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import type { TickerHistoryData } from "@/common/types/blogPosts/ticker";

/**
 * Prior regular session + today's bars for the Morning Brief setup chart.
 *
 * One windowed call to the chart's history endpoint (POST
 * /ticker/<ticker>/history {interval, start, end, extended_hours}) covering
 * the last week of 15m bars, split client-side by ET date: `yesterday` is
 * the most recent session before today trimmed to 09:30-16:00, `today` is
 * whatever today has so far (premarket before the open — the backend keeps
 * extended hours only outside the regular session).
 */

export interface SessionBar {
  o: number;
  h: number;
  l: number;
  c: number;
  /** Bar start, ET "HH:MM" — kept on today's bars only. */
  hhmm?: string;
}

export interface SetupSessionBars {
  yesterday: SessionBar[];
  today: SessionBar[];
  priorHigh: number | null;
  priorLow: number | null;
}

export const SETUP_BARS_INTERVAL = "15m";

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Split the window into prior session / today. Bar timestamps are
 *  exchange-local ("2026-10-06T09:30:00-0400"), so the date and HH:MM are
 *  read straight off the string. */
export function splitSessions(d: TickerHistoryData, today: string): SetupSessionBars {
  const bars = d.dates.map((date, i) => ({
    day: date.slice(0, 10),
    hhmm: date.slice(11, 16),
    o: d.opens?.[i] ?? d.prices[i],
    h: d.highs?.[i] ?? d.prices[i],
    l: d.lows?.[i] ?? d.prices[i],
    c: d.prices[i],
  }));
  const priorDay = bars.reduce<string | null>(
    (acc, b) => (b.day < today && (acc == null || b.day > acc) ? b.day : acc),
    null,
  );
  const strip = ({ o, h, l, c }: SessionBar) => ({ o, h, l, c });
  const yesterday = bars
    .filter((b) => b.day === priorDay && b.hhmm >= "09:30" && b.hhmm < "16:00")
    .map(strip);
  const todayBars = bars.filter((b) => b.day === today).map((b) => ({ ...strip(b), hhmm: b.hhmm }));
  return {
    yesterday,
    today: todayBars,
    priorHigh: yesterday.length ? Math.max(...yesterday.map((b) => b.h)) : null,
    priorLow: yesterday.length ? Math.min(...yesterday.map((b) => b.l)) : null,
  };
}

export function useSetupSessionBars(ticker: string, enabled = true) {
  return useQuery({
    queryKey: ["setup-session-bars", ticker],
    queryFn: async (): Promise<SetupSessionBars> => {
      const today = etToday();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(`${RAILWAY_BASE_URL}/ticker/${ticker}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Backend window is [start, end) — end tomorrow to include today.
        // A week back always reaches the prior session across weekends and
        // holidays.
        body: JSON.stringify({ interval: SETUP_BARS_INTERVAL, start: addDays(today, -7), end: addDays(today, 1), extended_hours: true }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));
      if (!res.ok) throw new Error(`setup bars ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "setup bars failed");
      return splitSessions(json.data as TickerHistoryData, today);
    },
    enabled: !!ticker && enabled,
    staleTime: 30_000,
    // Picks up new premarket / session bars; the live dot covers the gaps.
    refetchInterval: 60_000,
    retry: 1,
  });
}
