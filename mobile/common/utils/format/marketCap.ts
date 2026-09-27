/**
 * Formats a raw market cap number into a compact "$687.3B" style string.
 */
export const formatMarketCap = (marketCap: number): string => {
  if (marketCap >= 1_000_000_000_000) {
    return `$${(marketCap / 1_000_000_000_000).toFixed(1)}T`;
  } else if (marketCap >= 1_000_000_000) {
    return `$${(marketCap / 1_000_000_000).toFixed(1)}B`;
  } else if (marketCap >= 1_000_000) {
    return `$${(marketCap / 1_000_000).toFixed(1)}M`;
  }
  return `$${marketCap.toLocaleString()}`;
};
