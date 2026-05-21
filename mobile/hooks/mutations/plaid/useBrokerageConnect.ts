import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  create,
  open,
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
    onSuccess: (data) => {
      console.log('[BrokerageConnect] exchangePublicToken succeeded:', JSON.stringify(data));
      queryClient.invalidateQueries({ queryKey: [LINKED_ACCOUNTS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [PLAID_HOLDINGS_QUERY_KEY] });
    },
    onError: (err) => {
      console.error('[BrokerageConnect] exchangePublicToken failed:', err);
    },
  });

  const connect = useCallback(async () => {
    console.log('[BrokerageConnect] connect() called');
    setIsLinking(true);
    try {
      console.log('[BrokerageConnect] requesting link token from backend...');
      const { link_token } = await createLinkToken();
      console.log('[BrokerageConnect] link token received, prefix =', link_token?.slice(0, 20));

      console.log('[BrokerageConnect] calling create() with link token...');
      create({ token: link_token, noLoadingState: false });

      console.log('[BrokerageConnect] calling open() — Plaid Link UI should appear');
      open({
        onSuccess: (success: LinkSuccess) => {
          const { publicToken, metadata } = success;
          console.log('[BrokerageConnect] onSuccess fired');
          console.log('[BrokerageConnect]   publicToken prefix =', publicToken?.slice(0, 20));
          console.log('[BrokerageConnect]   institution =', metadata.institution?.name, '(', metadata.institution?.id, ')');
          console.log('[BrokerageConnect]   accounts =', JSON.stringify(metadata.accounts.map(a => ({
            id: a.id, name: a.name, type: String(a.type), subtype: a.subtype ? String(a.subtype) : null,
          }))));
          setIsLinking(false);
          console.log('[BrokerageConnect] calling exchangePublicToken...');
          exchangeMutation.mutate({
            public_token: publicToken,
            institution_id: metadata.institution?.id ?? '',
            institution_name: metadata.institution?.name ?? '',
            accounts: metadata.accounts.map((a) => ({
              id: a.id,
              name: a.name ?? '',
              mask: a.mask ?? null,
              type: String(a.type),
              subtype: a.subtype ? String(a.subtype) : null,
            })),
          });
        },
        onExit: (exit: LinkExit) => {
          setIsLinking(false);
          if (exit.error) {
            console.error('[BrokerageConnect] onExit — error:', JSON.stringify(exit.error));
            console.error('[BrokerageConnect] onExit — metadata:', JSON.stringify(exit.metadata));
          } else {
            console.log('[BrokerageConnect] onExit — user cancelled / closed Link (no error)');
            console.log('[BrokerageConnect] onExit — metadata:', JSON.stringify(exit.metadata));
          }
        },
      });
    } catch (error) {
      setIsLinking(false);
      console.error('[BrokerageConnect] caught error in connect():', error);
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
