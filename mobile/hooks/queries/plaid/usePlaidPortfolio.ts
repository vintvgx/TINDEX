import { useMemo } from 'react';
import { usePlaidHoldings } from './usePlaidHoldings';
import { useLinkedAccounts } from './useLinkedAccounts';
import { parsePlaidOptionName, isOptionSecurity } from '@/common/utils/parsePlaidOptionName';
import type { PlaidHolding, PlaidSecurity, PlaidAccountDetail } from '@/common/types/plaid';

export interface EnrichedHolding {
  holding: PlaidHolding;
  security: PlaidSecurity;
  account: PlaidAccountDetail;
  isOption: boolean;
  pnl: number | null;
  pnlPct: number | null;
  parsedOption: ReturnType<typeof parsePlaidOptionName> | null;
}

export interface AccountGroup {
  account: PlaidAccountDetail;
  institutionName: string;
  equities: EnrichedHolding[];
  options: EnrichedHolding[];
}

export function usePlaidPortfolio() {
  const holdingsQuery = usePlaidHoldings();
  const { data: linkedAccounts } = useLinkedAccounts();
  const data = holdingsQuery.data;

  const groups = useMemo<AccountGroup[]>(() => {
    if (!data) return [];

    const securityMap = new Map<string, PlaidSecurity>(
      data.securities.map((s) => [s.security_id, s]),
    );
    const accountMap = new Map<string, PlaidAccountDetail>(
      data.accounts.map((a) => [a.account_id, a]),
    );
    const institutionMap = new Map<string, string>();
    linkedAccounts?.forEach((la) => institutionMap.set(la.account_id, la.institution_name));

    const groupMap = new Map<string, AccountGroup>();

    for (const holding of data.holdings) {
      const security = securityMap.get(holding.security_id);
      const account = accountMap.get(holding.account_id);
      if (!security || !account) continue;

      if (security.is_cash_equivalent) continue;

      const isOption = isOptionSecurity(security.type);
      const pnl =
        holding.cost_basis != null ? holding.institution_value - holding.cost_basis : null;
      const pnlPct =
        pnl != null && holding.cost_basis != null && holding.cost_basis > 0
          ? (pnl / holding.cost_basis) * 100
          : null;
      const parsedOption =
        isOption && security.name ? parsePlaidOptionName(security.name) : null;

      const enriched: EnrichedHolding = {
        holding,
        security,
        account,
        isOption,
        pnl,
        pnlPct,
        parsedOption,
      };

      if (!groupMap.has(account.account_id)) {
        groupMap.set(account.account_id, {
          account,
          institutionName: institutionMap.get(account.account_id) ?? 'Brokerage',
          equities: [],
          options: [],
        });
      }

      const group = groupMap.get(account.account_id)!;
      if (isOption) {
        group.options.push(enriched);
      } else {
        group.equities.push(enriched);
      }
    }

    // Sort equities by institution_value descending
    for (const group of groupMap.values()) {
      group.equities.sort((a, b) => b.holding.institution_value - a.holding.institution_value);
      group.options.sort((a, b) => b.holding.institution_value - a.holding.institution_value);
    }

    return Array.from(groupMap.values());
  }, [data, linkedAccounts]);

  const totalHoldingsValue = useMemo(() => {
    if (!data) return null;
    return data.holdings
      .filter((h) => {
        const sec = data.securities.find((s) => s.security_id === h.security_id);
        return !sec?.is_cash_equivalent;
      })
      .reduce((sum, h) => sum + h.institution_value, 0);
  }, [data]);

  const totalPnl = useMemo(() => {
    if (!data) return null;
    let total = 0;
    let hasAny = false;
    for (const h of data.holdings) {
      if (h.cost_basis != null) {
        total += h.institution_value - h.cost_basis;
        hasAny = true;
      }
    }
    return hasAny ? total : null;
  }, [data]);

  const totalCostBasis = useMemo(() => {
    if (!data) return null;
    let total = 0;
    let hasAny = false;
    for (const h of data.holdings) {
      if (h.cost_basis != null) {
        total += h.cost_basis;
        hasAny = true;
      }
    }
    return hasAny ? total : null;
  }, [data]);

  return {
    groups,
    totalHoldingsValue,
    totalPnl,
    totalCostBasis,
    accounts: data?.accounts ?? [],
    isLoading: holdingsQuery.isLoading,
    error: holdingsQuery.error,
    refetch: holdingsQuery.refetch,
  };
}
