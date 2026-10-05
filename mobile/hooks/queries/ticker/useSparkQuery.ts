import { useQuery } from "@tanstack/react-query";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import type { PricePeriod } from "@/common/types/blogPosts/ticker";

export interface SparkData {
  dates: string[];
  closes: number[];
  interval?: string;
}

interface SparkResponse {
  success: boolean;
  data: SparkData;
  period: PricePeriod;
  error?: string;
}

/**
 * Lightweight closes-only series for sparkline views (home chart deck).
 * Hits POST /ticker/<t>/spark — deliberately separate from the full history
 * endpoint: no OHLC, no volumes, no session lines, no technicals. The backend
 * caches ~45s per ticker+period, so a deck of tickers polling every minute
 * stays cheap.
 */
export function useSparkQuery(ticker: string, period: PricePeriod, refetchIntervalMs?: number) {
  const { authState: { user, isLoading: authLoading } } = useAuth();

  return useQuery({
    queryKey: ["ticker-spark", ticker, period],
    queryFn: async (): Promise<SparkResponse> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);

      const response = await fetch(`${RAILWAY_BASE_URL}/ticker/${ticker}/spark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
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
    staleTime: 30_000,
    refetchInterval: refetchIntervalMs,
  });
}
