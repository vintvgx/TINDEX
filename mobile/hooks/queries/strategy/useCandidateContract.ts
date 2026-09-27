import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';

export interface CandidateContract {
  symbol: string;
  strike: number;
  delta: number;
  bid: number;
  ask: number;
  mid: number;
}

export interface CandidateContractResponse {
  success: boolean;
  default: CandidateContract | null;
  alt: CandidateContract | null;
  error?: string;
}

/**
 * Live preview of the default + one-strike-further-OTM "alt" contract for a
 * candidate breakout card — GET /strategy/configs/<id>/candidate-contract,
 * a read-only wrapper around the same select_contract() a real entry would
 * use (see contract_selector.py), so the strike shown here is what would
 * actually get picked, not an approximation.
 */
export function useCandidateContract(
  strategyId: string, direction: 'CALL' | 'PUT', enabled: boolean = true,
) {
  return useQuery<CandidateContractResponse>({
    queryKey: ['candidate-contract', strategyId, direction],
    queryFn: async () => {
      const res = await fetch(
        `${RAILWAY_BASE_URL}/strategy/configs/${strategyId}/candidate-contract?direction=${direction}`,
      );
      return res.json();
    },
    enabled,
    // Matches the tape's own cadence — this is a preview, not a fill price,
    // so there's no need to poll tighter than what a human can even react to.
    refetchInterval: 8_000,
    staleTime: 6_000,
    retry: 1,
  });
}
