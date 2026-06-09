import { useQuery } from '@tanstack/react-query';
import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import type { ContractsResponse } from '@/common/types/strategy';

/**
 * Fetch the live 0DTE option chain for a strategy's ticker + direction, used by
 * the Immediate Trade picker. Disabled until a strategy + direction is chosen.
 */
export function useStrategyContracts(
  strategyId: string | null,
  direction: 'CALL' | 'PUT',
  enabled: boolean,
) {
  return useQuery<ContractsResponse>({
    queryKey: ['strategy-contracts', strategyId, direction],
    queryFn: async () => {
      const res = await fetch(
        `${RAILWAY_BASE_URL}/strategy/configs/${strategyId}/contracts?direction=${direction}`,
      );
      if (!res.ok) throw new Error('Failed to fetch contracts');
      return res.json();
    },
    enabled: enabled && !!strategyId,
    staleTime: 10_000,
  });
}
