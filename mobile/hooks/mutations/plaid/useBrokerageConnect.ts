import { useState, useCallback, useRef, useEffect } from 'react';
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
import { usePlaidOAuth } from '@/common/utils/context/PlaidOAuthContext';

// Must match the universal link path registered in Plaid dashboard
// and associated with alethia.app via the AASA file.
const PLAID_REDIRECT_URI = 'https://alethia.app/plaid-redirect';

interface BrokerageConnectOptions {
  onSuccess?: () => void;
  onError?: (err: Error) => void;
}

export function useBrokerageConnect(options?: BrokerageConnectOptions) {
  const queryClient = useQueryClient();
  const [isLinking, setIsLinking] = useState(false);
  const linkTokenRef = useRef<string | null>(null);
  const { receivedRedirectUri, setReceivedRedirectUri } = usePlaidOAuth();

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

  const openLink = useCallback((redirectUri?: string) => {
    open({
      onSuccess: (success: LinkSuccess) => {
        const { publicToken, metadata } = success;
        console.log('[BrokerageConnect] onSuccess — institution =', metadata.institution?.name);
        setIsLinking(false);
        linkTokenRef.current = null;
        setReceivedRedirectUri(null);
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
  }, [exchangeMutation, options, setReceivedRedirectUri]);

  // When the app resumes from an OAuth redirect, re-open Link with the received URI
  useEffect(() => {
    const token = linkTokenRef.current;
    if (!receivedRedirectUri || !token) return;
    console.log('[BrokerageConnect] resuming Link after OAuth redirect...');
    setIsLinking(true);
    create({ token, receivedRedirectUri, noLoadingState: false });
    openLink(receivedRedirectUri);
  }, [receivedRedirectUri, openLink]);

  const connect = useCallback(async () => {
    console.log('[BrokerageConnect] connect() called');
    setIsLinking(true);
    try {
      console.log('[BrokerageConnect] requesting link token...');
      const { link_token } = await createLinkToken(PLAID_REDIRECT_URI);
      console.log('[BrokerageConnect] link token received, prefix =', link_token?.slice(0, 20));
      linkTokenRef.current = link_token;

      create({ token: link_token, noLoadingState: false });
      console.log('[BrokerageConnect] calling open()...');
      openLink();
    } catch (error) {
      setIsLinking(false);
      linkTokenRef.current = null;
      console.error('[BrokerageConnect] error:', error);
      options?.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }, [openLink, options]);

  return {
    connect,
    isLinking,
    isExchanging: exchangeMutation.isPending,
    isSuccess: exchangeMutation.isSuccess,
    error: exchangeMutation.error,
  };
}
