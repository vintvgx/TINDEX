import { useQuery } from "@tanstack/react-query";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { isMarketHours } from "@/lib/marketHours";
import type { PricePeriod } from "@/common/types/blogPosts/ticker";

export interface SparkData {
  dates: string[];
  closes: number[];
  interval?: string;
  stale?: boolean;
}

interface SparkResponse {
  success: boolean;
  data: SparkData;
  period: PricePeriod;
  /** The bars are an expired copy the backend is refreshing right now. */
  stale?: boolean;
  error?: string;
}

/** A chart you land on refetches if its bars are older than this. */
export const SPARK_FRESH_MS = 15_000;
/** Re-ask this soon after a stale reply (the backend refresh is in flight). */
const STALE_RETRY_MS = 3_000;
/** The chart you're looking at polls for new bars at this cadence. Between
 *  polls its last point follows the live price stream. */
const ACTIVE_POLL_MS = 60_000;

/**
 * Lightweight closes-only series for the home chart deck.
 * Hits POST /ticker/<t>/spark — deliberately separate from the full history
 * endpoint: no OHLC, no volumes, no session lines, no technicals.
 *
 * Only the chart you're looking at (`active`) keeps polling — every 60s
 * during market hours, or every 3s while the backend says its copy is stale.
 * Neighbor pages load once (so a swipe lands on a drawn chart) and catch up
 * when they become active (see DynamicChartsView's TickerPage).
 */
export function useSparkQuery(
  ticker: string,
  period: PricePeriod,
  { interval, active = true }: { interval?: string; active?: boolean } = {},
) {
  const { authState: { user, isLoading: authLoading } } = useAuth();

  return useQuery({
    queryKey: ["ticker-spark", ticker, period, interval ?? null],
    queryFn: async (): Promise<SparkResponse> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);

      const response = await fetch(`${RAILWAY_BASE_URL}/ticker/${ticker}/spark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, interval }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      if (!response.ok) {
        throw new Error(`Failed to fetch spark: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to fetch spark");
      }

      return data;
    },
    enabled: !!ticker && !!user?.id && !authLoading,
    staleTime: SPARK_FRESH_MS,
    refetchInterval: (query) => {
      if (!active) return false;
      if (query.state.data?.stale) return STALE_RETRY_MS;
      return isMarketHours() ? ACTIVE_POLL_MS : false;
    },
  });
}
