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
  console.log('[PlaidService] authHeaders: fetching Supabase session...');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    console.error('[PlaidService] authHeaders: NO active session — user not authenticated');
    throw new Error('Not authenticated');
  }
  console.log('[PlaidService] authHeaders: session OK, user_id =', session.user.id);
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

export async function createLinkToken(redirectUri?: string): Promise<PlaidLinkTokenResponse> {
  const url = `${RAILWAY_BASE_URL}/api/plaid/create-link-token`;
  console.log('[PlaidService] createLinkToken: POST', url, 'redirect_uri =', redirectUri);
  const headers = await authHeaders();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: redirectUri ? JSON.stringify({ redirect_uri: redirectUri }) : undefined,
  });
  console.log('[PlaidService] createLinkToken: status =', res.status);
  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)');
    console.error('[PlaidService] createLinkToken: FAILED — status', res.status, '| body:', body);
    let message: string | undefined;
    try { message = (JSON.parse(body) as { message?: string }).message; } catch { /* noop */ }
    throw new Error(message ?? `create-link-token failed: ${res.status}`);
  }
  const data = await res.json() as PlaidLinkTokenResponse;
  console.log('[PlaidService] createLinkToken: success, token prefix =', data.link_token?.slice(0, 20));
  return data;
}

export async function exchangePublicToken(
  payload: PlaidExchangeTokenRequest,
): Promise<PlaidExchangeTokenResponse> {
  const url = `${RAILWAY_BASE_URL}/api/plaid/exchange-token`;
  console.log('[PlaidService] exchangePublicToken: POST', url);
  console.log('[PlaidService] exchangePublicToken: institution =', payload.institution_name, '| accounts =', payload.accounts.length);
  const headers = await authHeaders();
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  console.log('[PlaidService] exchangePublicToken: status =', res.status);
  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)');
    console.error('[PlaidService] exchangePublicToken: FAILED — status', res.status, '| body:', body);
    let message: string | undefined;
    try { message = (JSON.parse(body) as { message?: string }).message; } catch { /* noop */ }
    throw new Error(message ?? `exchange-token failed: ${res.status}`);
  }
  const data = await res.json() as PlaidExchangeTokenResponse;
  console.log('[PlaidService] exchangePublicToken: success =', JSON.stringify(data));
  return data;
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
