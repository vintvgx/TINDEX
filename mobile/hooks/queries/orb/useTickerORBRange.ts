import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/supabase";
import type { ORBRange } from "@/common/types/orb";

/**
 * Today's ORB range (high/low + opening price) for a single ticker, if the
 * Opening Range has been computed for it today — i.e. it's past 9:45 AM ET
 * and the ticker was being monitored (SPY/QQQ/IWM always are; any other
 * ticker only if a user has ORB-followed it — see useToggleORBFollow).
 * Scoped fetch, unlike useORBRanges which pulls every monitored ticker for
 * the ORB grid — this is for a single chart's overlay.
 */
export function useTickerORBRange(ticker: string) {
  // trade_date is an ET trading day — toISOString() is UTC, which is already
  // "tomorrow" between 8pm-midnight ET and would miss today's row.
  const today = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()),
    [],
  );

  return useQuery({
    queryKey: ["orb-range", ticker, today],
    queryFn: async (): Promise<ORBRange | null> => {
      const { data, error } = await supabase
        .from("orb_ranges")
        .select("*")
        .eq("ticker", ticker.toUpperCase())
        .eq("trade_date", today)
        .maybeSingle();

      if (error) {
        console.error(`Error fetching orb_ranges for ${ticker}:`, error);
        throw error;
      }
      return (data as ORBRange | null) ?? null;
    },
    enabled: !!ticker,
    staleTime: 60 * 1000,
  });
}
