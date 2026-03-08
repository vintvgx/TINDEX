import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/supabase";
import type { ORBRange } from "@/common/types/orb";
import { MOCK_ORB_RANGES } from "./mockData/orbMockData";

/**
 * Fetches today's ORB ranges (including gap/trend columns) for display on ORB cards and detail modal.
 * Returns array and a map by ticker for quick lookup.
 * When useMockData is true, returns mock ranges with gap/trend examples for preview.
 */
export function useORBRanges(useMockData: boolean = false) {
  const today = useMemo(
    () => new Date().toISOString().split("T")[0],
    []
  );

  const query = useQuery({
    queryKey: ["orb-ranges", today, useMockData],
    queryFn: async (): Promise<ORBRange[]> => {
      if (useMockData) {
        return MOCK_ORB_RANGES;
      }
      const { data, error } = await supabase
        .from("orb_ranges")
        .select("*")
        .eq("trade_date", today)
        .order("ticker", { ascending: true });

      if (error) {
        console.error("Error fetching orb_ranges:", error);
        throw error;
      }
      return (data ?? []) as ORBRange[];
    },
    staleTime: 60 * 1000,
  });

  const rangesByTicker = useMemo(() => {
    const map: Record<string, ORBRange> = {};
    (query.data ?? []).forEach((r) => {
      map[r.ticker] = r;
    });
    return map;
  }, [query.data]);

  return {
    ...query,
    rangesByTicker,
  };
}
