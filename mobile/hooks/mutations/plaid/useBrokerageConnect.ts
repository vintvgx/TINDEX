import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  create,
  type LinkSuccess,
  type LinkExit,
} from 'react-native-plaid-link-sdk';
import { createLinkToken, exchangePublicToken } from '@/common/services/PlaidService';
import { LINKED_ACCOUNTS_QUERY_KEY } from '@/hooks/queries/plaid/useLinkedAccounts';
import { PLAID_HOLDINGS_QUERY_KEY } from '@/hooks/queries/plaid/usePlaidHoldings';

export function useBrokerageConnect() {
  const queryClient = useQueryClient();
  const [isLinking, setIsLinking] = useState(false);

  const exchangeMutation = useMutation({
    mutationFn: exchangePublicToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LINKED_ACCOUNTS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [PLAID_HOLDINGS_QUERY_KEY] });
    },
  });

  const connect = useCallback(async () => {
    setIsLinking(true);
    try {
      const { link_token } = await createLinkToken();

      const handler = create({
        token: link_token,
        noLoadingState: false,
        onSuccess: (success: LinkSuccess) => {
          setIsLinking(false);
          const { publicToken, metadata } = success;
          exchangeMutation.mutate({
            public_token: publicToken,
            institution_id: metadata.institution?.id ?? '',
            institution_name: metadata.institution?.name ?? '',
            accounts: (metadata.accounts as Array<{ id: string; name: string; mask: string | null; type: string; subtype: string | null }>).map((a) => ({
              id: a.id,
              name: a.name,
              mask: a.mask ?? null,
              type: a.type,
              subtype: a.subtype ?? null,
            })),
          });
        },
        onExit: (exit: LinkExit) => {
          setIsLinking(false);
          if (exit.error) {
            console.error('[Plaid] Link exited with error:', exit.error);
          }
        },
      });

      handler.open({ onEvent: () => {} });
    } catch (error) {
      setIsLinking(false);
      throw error;
    }
  }, [exchangeMutation]);

  return {
    connect,
    isLinking,
    isExchanging: exchangeMutation.isPending,
    isSuccess: exchangeMutation.isSuccess,
    error: exchangeMutation.error,
  };
}
