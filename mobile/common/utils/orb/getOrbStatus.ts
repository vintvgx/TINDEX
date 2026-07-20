export type OrbStatus = 'above' | 'below' | 'in-range';

/**
 * Where a price sits relative to the day's Opening Range (9:30-9:45 AM ET
 * high/low). Shared between ORBCard (the ORB monitoring grid) and the ticker
 * chart's ORB range overlay so "above/below/in-range" means the same thing
 * everywhere in the app.
 */
export function getOrbStatus(currentPrice: number, orbHigh: number, orbLow: number): OrbStatus {
  if (currentPrice > orbHigh) return 'above';
  if (currentPrice < orbLow) return 'below';
  return 'in-range';
}
