import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { getLinkedAccounts } from '@/common/services/PlaidService';
import type { PlaidLinkedAccount } from '@/common/types/plaid';

export const LINKED_ACCOUNTS_QUERY_KEY = 'plaid_linked_accounts';

export function useLinkedAccounts() {
  const { authState: { user } } = useAuth();

  return useQuery<PlaidLinkedAccount[]>({
    queryKey: [LINKED_ACCOUNTS_QUERY_KEY, user?.id],
    queryFn: getLinkedAccounts,
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
}
