import { RAILWAY_BASE_URL } from '@/lib/railway.config';
import { supabase } from '@/lib/supabase/supabase';
import type {
  PlaidLinkTokenResponse,
  PlaidExchangeTokenRequest,
  PlaidExchangeTokenResponse,
  PlaidHoldingsResponse,
  PlaidInvestmentTransactionsResponse,
  PlaidLinkedAccount,
} from '@/common/types/plaid';

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

export async function createLinkToken(): Promise<PlaidLinkTokenResponse> {
  const headers = await authHeaders();
  const res = await fetch(`${RAILWAY_BASE_URL}/api/plaid/create-link-token`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `create-link-token failed: ${res.status}`);
  }
  return res.json() as Promise<PlaidLinkTokenResponse>;
}

export async function exchangePublicToken(
  payload: PlaidExchangeTokenRequest,
): Promise<PlaidExchangeTokenResponse> {
  const headers = await authHeaders();
  const res = await fetch(`${RAILWAY_BASE_URL}/api/plaid/exchange-token`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `exchange-token failed: ${res.status}`);
  }
  return res.json() as Promise<PlaidExchangeTokenResponse>;
}

export async function getLinkedAccounts(): Promise<PlaidLinkedAccount[]> {
  const headers = await authHeaders();
  const res = await fetch(`${RAILWAY_BASE_URL}/api/plaid/accounts`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `get accounts failed: ${res.status}`);
  }
  return res.json() as Promise<PlaidLinkedAccount[]>;
}

export async function getHoldings(itemId?: string): Promise<PlaidHoldingsResponse> {
  const headers = await authHeaders();
  const url = itemId
    ? `${RAILWAY_BASE_URL}/api/plaid/holdings?item_id=${encodeURIComponent(itemId)}`
    : `${RAILWAY_BASE_URL}/api/plaid/holdings`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `get holdings failed: ${res.status}`);
  }
  return res.json() as Promise<PlaidHoldingsResponse>;
}

export async function getInvestmentTransactions(
  itemId?: string,
  startDate?: string,
  endDate?: string,
): Promise<PlaidInvestmentTransactionsResponse> {
  const headers = await authHeaders();
  const params = new URLSearchParams();
  if (itemId) params.set('item_id', itemId);
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  const query = params.toString();
  const url = query
    ? `${RAILWAY_BASE_URL}/api/plaid/investment-transactions?${query}`
    : `${RAILWAY_BASE_URL}/api/plaid/investment-transactions`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `get investment transactions failed: ${res.status}`);
  }
  return res.json() as Promise<PlaidInvestmentTransactionsResponse>;
}

export async function unlinkAccount(itemId: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${RAILWAY_BASE_URL}/api/plaid/accounts/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `unlink account failed: ${res.status}`);
  }
}
