import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { getHoldings } from '@/common/services/PlaidService';
import type { PlaidHoldingsResponse } from '@/common/types/plaid';

export const PLAID_HOLDINGS_QUERY_KEY = 'plaid_holdings';

export function usePlaidHoldings(itemId?: string) {
  const { authState: { user } } = useAuth();

  return useQuery<PlaidHoldingsResponse>({
    queryKey: [PLAID_HOLDINGS_QUERY_KEY, user?.id, itemId],
    queryFn: () => getHoldings(itemId),
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000,
  });
}
