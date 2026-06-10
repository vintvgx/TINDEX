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
      const body = await res.json().catch(() => null);
      // The route returns a descriptive `error` (e.g. an Alpaca feed/entitlement
      // issue) alongside an empty contract list — surface it instead of a generic msg.
      if (!res.ok) {
        throw new Error(body?.error || `Failed to fetch contracts (HTTP ${res.status})`);
      }
      return body as ContractsResponse;
    },
    enabled: enabled && !!strategyId,
    staleTime: 10_000,
  });
}
