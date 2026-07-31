import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/supabase";
import type { ORBRange } from "@/common/types/orb";

/**
 * Today's ORB range for a LIST of tickers in one query — batched sibling of
 * useTickerORBRange (which is scoped to a single chart's own ticker).
 * Needed because a live open trade's ticker may not be ORB-followed at all
 * (e.g. an ad-hoc immediate trade), and because hooks can't be called in a
 * loop for a dynamic-length ticker list — this fetches all of them at once
 * and returns a ticker -> ORBRange map, with entries simply absent for
 * tickers with no orb_ranges row today.
 */
export function useOrbRangesForTickers(tickers: string[]) {
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);
  const key = useMemo(() => [...new Set(tickers.map(t => t.toUpperCase()))].sort(), [tickers]);

  return useQuery({
    queryKey: ["orb-ranges-batch", key, today],
    queryFn: async (): Promise<Record<string, ORBRange>> => {
      if (key.length === 0) return {};
      const { data, error } = await supabase
        .from("orb_ranges")
        .select("*")
        .in("ticker", key)
        .eq("trade_date", today);

      if (error) {
        console.error("Error fetching batched orb_ranges:", error);
        throw error;
      }
      const map: Record<string, ORBRange> = {};
      for (const row of (data as ORBRange[] | null) ?? []) {
        map[row.ticker.toUpperCase()] = row;
      }
      return map;
    },
    enabled: key.length > 0,
    staleTime: 60 * 1000,
  });
}
