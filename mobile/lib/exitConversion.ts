// Stock price ↔ premium conversion for chart-set exits (spec 2026-11-10 §5).
//
// The stock price is the input language; the PREMIUM is what executes. Delta
// is the open contract's snapshot delta, signed by direction (CALL +, PUT −),
// and the same delta is used both ways so price ↔ % always agree. A missing,
// zero or stale delta disables conversion — never a silent fallback.

export interface DeltaInfo {
  delta: number | null | undefined;
  /** e.g. "snapshot", "chain", "entry" — shown next to every converted price. */
  source: string | null | undefined;
  /** Seconds since the delta was fetched, at the time the push was built. */
  ageS: number | null | undefined;
}

// Spec §9: stale past 5 minutes. The engine refreshes delta every 300s, so a
// 30s grace keeps a push built just before a refresh from flickering to
// "stale" every cycle.
export const DELTA_STALE_S = 5 * 60 + 30;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Usable delta, or the reason it isn't (shown on the card / chart). */
export function usableDelta(d: DeltaInfo): { delta: number; reason: null } | { delta: null; reason: string } {
  if (!isNum(d.delta) || d.delta === 0) return { delta: null, reason: 'delta unavailable' };
  if (isNum(d.ageS) && d.ageS > DELTA_STALE_S) return { delta: null, reason: `delta stale (${Math.round(d.ageS / 60)}m old)` };
  return { delta: d.delta, reason: null };
}

/** "Δ 0.42 · contract snapshot · fresh" */
export function deltaLabel(d: DeltaInfo): string {
  if (!isNum(d.delta) || d.delta === 0) return 'Δ — · delta unavailable';
  const src = d.source === 'snapshot' ? 'contract snapshot' : d.source || 'unknown source';
  const age = !isNum(d.ageS) ? 'age unknown'
    : d.ageS > DELTA_STALE_S ? `stale ${Math.round(d.ageS / 60)}m`
    : d.ageS < 60 ? 'fresh' : `${Math.round(d.ageS / 60)}m old`;
  return `Δ ${Math.abs(d.delta).toFixed(2)} · ${src} · ${age}`;
}

export interface Quote { stock: number; premium: number; delta: number }

/** premium_at(stock) = current_premium + (stock − current_stock) × delta */
export const premiumAt = (q: Quote, stock: number) => q.premium + (stock - q.stock) * q.delta;
/** stock_at(premium) = current_stock + (premium − current_premium) / delta */
export const stockAt = (q: Quote, premium: number) => q.stock + (premium - q.premium) / q.delta;
/** pct vs entry, as a whole-number percent */
export const pctVsEntry = (premium: number, entry: number) => (entry > 0 ? ((premium - entry) / entry) * 100 : 0);
export const premiumFromPct = (pct: number, entry: number) => entry * (1 + pct / 100);

/** Exit kind the sheet preselects for a pressed stock price (§4.2): CALL —
 *  above current → TP, below → SL; a PUT flips. */
export function smartDefault(direction: 'CALL' | 'PUT', pressed: number, currentStock: number): 'tp' | 'sl' {
  const above = pressed >= currentStock;
  return direction === 'CALL' ? (above ? 'tp' : 'sl') : (above ? 'sl' : 'tp');
}

/** Near-entry below-price press (within $0.10 of the breakeven stock price)
 *  offers Snap to BE. */
export const SNAP_TO_BE_STOCK = 0.10;
