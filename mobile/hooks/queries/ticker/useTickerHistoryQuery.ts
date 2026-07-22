import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { PricePeriod, TickerHistoryData, TickerHistoryResponse } from "@/common/types/blogPosts/ticker";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";

/**
 * Fetches a single timeframe's price series for the ticker chart.
 * Kept separate from useTickerQuery (fundamentals) so switching timeframes
 * doesn't refetch/re-render company info, price, market cap, etc.
 *
 * @param ticker - Stock ticker symbol
 * @param period - Selected chart timeframe (1D/1W/1M/3M/YTD/1Y/5Y)
 */
export function useTickerHistoryQuery(ticker: string, period: PricePeriod) {
  const { authState: { user, isLoading: authLoading } } = useAuth();

  return useQuery({
    queryKey: ["ticker-history", ticker, period],
    queryFn: async (): Promise<TickerHistoryResponse> => {
      try {
        // See useTickerQuery.ts for why this needs an explicit abort — same
        // uncached yfinance call underneath, same risk of hanging instead of
        // ever reaching the mock-data fallback below.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20_000);

        const response = await fetch(`${RAILWAY_BASE_URL}/ticker/${ticker}/history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ period }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));

        if (!response.ok) {
          throw new Error(`Failed to fetch ticker history: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to fetch ticker history");
        }

        return data;
      } catch (error) {
        console.warn(`History API call failed for ${ticker} (${period}), using mock data:`, error);
        return {
          success: true,
          data: generateMockHistory(ticker, period),
          period,
          timestamp: Date.now(),
        };
      }
    },
    enabled: !!ticker && !!user?.id && !authLoading,
    // Intraday timeframes go stale fast; longer ranges barely change minute to minute.
    staleTime: period === "1D" ? 30 * 1000 : period === "1W" ? 60 * 1000 : 5 * 60 * 1000,
    retry: 1,
    retryDelay: 1000,
    // Switching timeframes changes the query key (ticker-history includes
    // period) — without this, the chart would drop back to a loading state
    // on every tab tap. Keeping the previous period's data displayed while
    // the new one fetches, then swapping once it lands, is the smooth
    // Robinhood-style transition instead of a skeleton flash each time.
    placeholderData: keepPreviousData,
  });
}

/**
 * Deterministic-ish mock series generator used when the backend history
 * endpoint is unreachable, so the chart still has something to render
 * in local/offline development.
 */
const PERIOD_CONFIG: Record<PricePeriod, { points: number; stepMs: number }> = {
  "1D": { points: 78, stepMs: 5 * 60 * 1000 },
  "1W": { points: 65, stepMs: 30 * 60 * 1000 },
  "1M": { points: 22, stepMs: 24 * 60 * 60 * 1000 },
  "3M": { points: 65, stepMs: 24 * 60 * 60 * 1000 },
  YTD: { points: 140, stepMs: 24 * 60 * 60 * 1000 },
  "1Y": { points: 100, stepMs: 3.65 * 24 * 60 * 60 * 1000 },
  "5Y": { points: 130, stepMs: 14 * 24 * 60 * 60 * 1000 },
};

const generateMockHistory = (ticker: string, period: PricePeriod): TickerHistoryData => {
  const { points, stepMs } = PERIOD_CONFIG[period];

  // Simple seeded pseudo-random so the same ticker looks stable across renders.
  let seed = ticker.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) || 1;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const basePrice = rand() * 200 + 50;
  const dates: string[] = [];
  const prices: number[] = [];
  const volumes: number[] = [];
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];

  let price = basePrice;
  const now = Date.now();
  for (let i = points - 1; i >= 0; i--) {
    const timestamp = now - i * stepMs;
    dates.push(new Date(timestamp).toISOString());
    const open = Math.max(price, 0.5);
    price += (rand() - 0.5) * (basePrice * 0.015);
    const close = Math.max(price, 0.5);
    const wiggle = basePrice * 0.004;
    opens.push(open);
    prices.push(close);
    highs.push(Math.max(open, close) + rand() * wiggle);
    lows.push(Math.max(Math.min(open, close) - rand() * wiggle, 0.25));
    volumes.push(Math.floor(rand() * 5_000_000) + 500_000);
  }

  return { dates, prices, volumes, opens, highs, lows };
};
