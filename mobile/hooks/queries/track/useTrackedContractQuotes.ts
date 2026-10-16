import { useQuery } from "@tanstack/react-query";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";
import { isMarketHours } from "@/lib/marketHours";

export interface OptionQuote {
  bid: number;
  ask: number;
  last_price: number | null;
  /** Mid when two-sided, else the last trade. */
  mark: number;
}

const POLL_MS = 15_000;

/**
 * Current quotes for watched contracts — one batched request
 * (GET /tracked-options/quotes) for every symbol. Polls every 15s during
 * market hours while `enabled`; off-hours quotes don't move.
 */
export function useTrackedContractQuotes(symbols: string[], enabled = true) {
  const key = [...new Set(symbols)].sort().join(",");
  return useQuery({
    queryKey: ["tracked-contract-quotes", key],
    queryFn: async (): Promise<Record<string, OptionQuote>> => {
      const res = await fetch(`${RAILWAY_BASE_URL}/tracked-options/quotes?symbols=${encodeURIComponent(key)}`);
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || `Quotes failed: ${res.status}`);
      return json.data ?? {};
    },
    enabled: enabled && key.length > 0,
    staleTime: 10_000,
    refetchInterval: () => (enabled && isMarketHours() ? POLL_MS : false),
  });
}
