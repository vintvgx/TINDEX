import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface PlaidOAuthContextValue {
  receivedRedirectUri: string | null;
  setReceivedRedirectUri: (uri: string | null) => void;
}

const PlaidOAuthContext = createContext<PlaidOAuthContextValue>({
  receivedRedirectUri: null,
  setReceivedRedirectUri: () => {},
});

export function PlaidOAuthProvider({ children }: { children: ReactNode }) {
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | null>(null);
  return (
    <PlaidOAuthContext.Provider value={{ receivedRedirectUri, setReceivedRedirectUri }}>
      {children}
    </PlaidOAuthContext.Provider>
  );
}

export function usePlaidOAuth() {
  return useContext(PlaidOAuthContext);
}
