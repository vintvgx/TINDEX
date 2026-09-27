import { useQuery } from "@tanstack/react-query";
import { RAILWAY_BASE_URL } from "@/lib/railway.config";

export interface SimulatedReturnsRequest {
  ticker: string;
  optionType: "CALL" | "PUT";
  strike: number;
  expirationDate: string; // YYYY-MM-DD
  currentSpot: number;
  impliedVolatility: number; // e.g. 0.7462 for 74.62%
  currentContractPrice: number; // live/last price — the grid's "now" point is anchored to this
  costBasis: number; // entry_price, or the tracked snapshot price if not yet entered
  quantity?: number; // default 1
  spotRangePct?: number; // default 0.10 (±10%)
  riskFreeRate?: number; // default 0.043
}

export interface SimulatedReturnsData {
  dates: string[]; // YYYY-MM-DD, "today" through expiration inclusive
  spotPrices: number[]; // ascending, current_spot at the center index
  pnl: number[][]; // pnl[dateIndex][spotIndex], dollars for the full position (qty x 100)
  maxLoss: number; // negative dollars — constant across the grid for a long option
  riskFreeRateUsed: number;
}

interface SimulatedReturnsResponse {
  success: boolean;
  data: SimulatedReturnsData;
  error?: string;
}

/**
 * Fetches the full (date x spot) P&L grid for the Simulated Returns view in
 * one call — see POST /options/simulate-returns and
 * docs/SIMULATED_RETURNS_PLAN.md. The whole grid comes back at once so the
 * price-ruler drag interaction is a local array lookup, not a request per
 * frame.
 */
export function useSimulatedReturns(request: SimulatedReturnsRequest | null) {
  return useQuery({
    queryKey: ["simulated-returns", request],
    queryFn: async (): Promise<SimulatedReturnsData> => {
      if (!request) throw new Error("Simulated returns request is required");

      const response = await fetch(`${RAILWAY_BASE_URL}/options/simulate-returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to simulate returns: ${response.statusText}`);
      }

      const data: SimulatedReturnsResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to simulate returns");
      }
      return data.data;
    },
    enabled: !!request,
    staleTime: 60 * 1000,
    retry: 1,
  });
}
