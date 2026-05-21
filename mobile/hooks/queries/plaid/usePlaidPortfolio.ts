import { useMemo } from 'react';
import { usePlaidHoldings } from './usePlaidHoldings';
import { useLinkedAccounts } from './useLinkedAccounts';
import { useBatchPrices } from './useBatchPrices';
import { parsePlaidOptionName, isOptionSecurity } from '@/common/utils/parsePlaidOptionName';
import type { PlaidHolding, PlaidSecurity, PlaidAccountDetail } from '@/common/types/plaid';

export interface EnrichedHolding {
  holding: PlaidHolding;
  security: PlaidSecurity;
  account: PlaidAccountDetail;
  isOption: boolean;
  livePrice: number;
  liveValue: number;
  livePnl: number | null;
  livePnlPct: number | null;
  parsedOption: ReturnType<typeof parsePlaidOptionName> | null;
}

export interface AccountGroup {
  account: PlaidAccountDetail;
  institutionName: string;
  equities: EnrichedHolding[];
  options: EnrichedHolding[];
}

export function usePlaidPortfolio() {
  const { data: holdingsData, isLoading: holdingsLoading, error, refetch } = usePlaidHoldings();
  const { data: linkedAccounts } = useLinkedAccounts();

  // Collect equity tickers for live price fetching
  const equityTickers = useMemo<string[]>(() => {
    if (!holdingsData) return [];
    const secMap = new Map(holdingsData.securities.map(s => [s.security_id, s]));
    const seen = new Set<string>();
    const tickers: string[] = [];
    for (const h of holdingsData.holdings) {
      const sec = secMap.get(h.security_id);
      if (sec && !isOptionSecurity(sec.type) && sec.ticker_symbol && !seen.has(sec.ticker_symbol)) {
        seen.add(sec.ticker_symbol);
        tickers.push(sec.ticker_symbol);
      }
    }
    return tickers;
  }, [holdingsData]);

  const { data: livePrices, isLoading: pricesLoading } = useBatchPrices(equityTickers);

  const groups = useMemo<AccountGroup[]>(() => {
    if (!holdingsData) return [];

    const secMap = new Map<string, PlaidSecurity>(
      holdingsData.securities.map(s => [s.security_id, s]),
    );
    const acctMap = new Map<string, PlaidAccountDetail>(
      holdingsData.accounts.map(a => [a.account_id, a]),
    );
    const instMap = new Map<string, string>();
    linkedAccounts?.forEach(la => instMap.set(la.account_id, la.institution_name));

    const groupMap = new Map<string, AccountGroup>();

    for (const holding of holdingsData.holdings) {
      const security = secMap.get(holding.security_id);
      const account = acctMap.get(holding.account_id);
      if (!security || !account) continue;

      const isOption = isOptionSecurity(security.type);

      const livePrice = !isOption && security.ticker_symbol && livePrices?.[security.ticker_symbol] != null
        ? livePrices[security.ticker_symbol]
        : holding.institution_price;

      const liveValue = livePrice * holding.quantity;
      const livePnl = holding.cost_basis != null ? liveValue - holding.cost_basis : null;
      const livePnlPct =
        livePnl != null && holding.cost_basis != null && holding.cost_basis > 0
          ? (livePnl / holding.cost_basis) * 100
          : null;

      const enriched: EnrichedHolding = {
        holding,
        security,
        account,
        isOption,
        livePrice,
        liveValue,
        livePnl,
        livePnlPct,
        parsedOption: isOption && security.name ? parsePlaidOptionName(security.name) : null,
      };

      if (!groupMap.has(account.account_id)) {
        groupMap.set(account.account_id, {
          account,
          institutionName: instMap.get(account.account_id) ?? '',
          equities: [],
          options: [],
        });
      }

      const group = groupMap.get(account.account_id)!;
      if (isOption) group.options.push(enriched);
      else group.equities.push(enriched);
    }

    for (const group of groupMap.values()) {
      group.equities.sort((a, b) => b.liveValue - a.liveValue);
    }

    return Array.from(groupMap.values());
  }, [holdingsData, linkedAccounts, livePrices]);

  const totalValue = useMemo(() => {
    if (!groups.length) return null;
    return groups.reduce(
      (sum, g) => sum + [...g.equities, ...g.options].reduce((s, h) => s + h.liveValue, 0),
      0,
    );
  }, [groups]);

  const totalPnl = useMemo(() => {
    if (!groups.length) return null;
    let total = 0;
    let hasAny = false;
    for (const g of groups) {
      for (const h of [...g.equities, ...g.options]) {
        if (h.livePnl != null) { total += h.livePnl; hasAny = true; }
      }
    }
    return hasAny ? total : null;
  }, [groups]);

  return {
    groups,
    totalValue,
    totalPnl,
    isLoading: holdingsLoading || (pricesLoading && equityTickers.length > 0),
    error,
    refetch,
  };
}
