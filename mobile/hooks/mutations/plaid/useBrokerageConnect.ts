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

// Plaid-hosted redirect page — iOS ASWebAuthenticationSession intercepts this automatically.
// Register this exact URL in Plaid dashboard → Team Settings → API → Allowed redirect URIs.
const PLAID_REDIRECT_URI = 'https://cdn.plaid.com/link/v2/stable/link.html';

interface BrokerageConnectOptions {
  onSuccess?: () => void;
  onError?: (err: Error) => void;
}

export function useBrokerageConnect(options?: BrokerageConnectOptions) {
  const queryClient = useQueryClient();
  const [isLinking, setIsLinking] = useState(false);

  const exchangeMutation = useMutation({
    mutationFn: exchangePublicToken,
    onSuccess: (data) => {
      console.log('[BrokerageConnect] exchangePublicToken succeeded:', JSON.stringify(data));
      queryClient.invalidateQueries({ queryKey: [LINKED_ACCOUNTS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [PLAID_HOLDINGS_QUERY_KEY] });
      options?.onSuccess?.();
    },
    onError: (err) => {
      console.error('[BrokerageConnect] exchangePublicToken failed:', err);
      options?.onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  });

  const connect = useCallback(async () => {
    console.log('[BrokerageConnect] connect() called');
    setIsLinking(true);
    try {
      console.log('[BrokerageConnect] requesting link token...');
      const { link_token } = await createLinkToken(PLAID_REDIRECT_URI);
      console.log('[BrokerageConnect] link token received, prefix =', link_token?.slice(0, 20));

      create({ token: link_token, noLoadingState: false });
      console.log('[BrokerageConnect] calling open()...');

      open({
        onSuccess: (success: LinkSuccess) => {
          const { publicToken, metadata } = success;
          console.log('[BrokerageConnect] onSuccess — institution =', metadata.institution?.name);
          setIsLinking(false);
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
            console.error('[BrokerageConnect] onExit error:', JSON.stringify(exit.error));
            options?.onError?.(
              new Error(exit.error.displayMessage ?? exit.error.errorCode ?? 'Link exited with error'),
            );
          } else {
            console.log('[BrokerageConnect] onExit — user cancelled');
          }
        },
      });
    } catch (error) {
      setIsLinking(false);
      console.error('[BrokerageConnect] error:', error);
      options?.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }, [exchangeMutation, options]);

  return {
    connect,
    isLinking,
    isExchanging: exchangeMutation.isPending,
    isSuccess: exchangeMutation.isSuccess,
    error: exchangeMutation.error,
  };
}
