import type { CompositeScore, CompositeTier, EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';

/** Shared display helpers for the composite technicals score (strip + sheet). */

/** Which side the strip / header lead with, and from which lens. */
export interface LensView {
  side: 'CALL' | 'PUT' | 'WAIT';
  /** trade = an open position on this ticker took that side; intraday = the
   *  derived lens (entry-check `lens`); legacy = an API without `lens`. */
  source: 'trade' | 'intraday' | 'legacy';
  /** That side's composite — the lead side (trade side, else the higher
   *  total). Null only on a partial payload; the strip falls back to the
   *  dual-total WAIT pill then. */
  comp: CompositeScore | null;
  call: CompositeScore | null;
  put: CompositeScore | null;
  /** The other lens, spelled out, whenever it reads differently — e.g.
   *  "Daily: PUT (verdict ENTER)". Null when the lenses agree. */
  otherLens: string | null;
}

/**
 * The one read the strip and the header show (spec 2026-11-10 §2.2, revised
 * 2026-11-10: the strip shows ONE side only — the trend the system is most
 * confident in). An open trade's side wins (the engine took it); otherwise
 * the higher composite total. Each side is graded on its own composite —
 * a side the engine did not take is never shown unlabelled, and the other
 * side's total lives in the detail sheet, not the strip.
 */
export function resolveLens(check: EntryCheck | undefined, tradeSide?: 'CALL' | 'PUT' | null): LensView | null {
  const c = check?.composite;
  if (!check || !c) return null;
  const lens = check.lens;
  const others: string[] = [];
  let side: LensView['side'];
  let source: LensView['source'];
  if (tradeSide) {
    side = tradeSide;
    source = 'trade';
    if (lens && lens.intraday.side !== tradeSide) others.push(lens.intraday.text);
  } else if (lens) {
    side = dominantSide(check);
    source = 'intraday';
    if (lens.intraday.side !== side) others.push(lens.intraday.text);
  } else {
    // Older API: no lens — follow the signal, else the dominant composite.
    side = check.signal === 'CALL' || check.signal === 'PUT' ? check.signal : dominantSide(check);
    source = 'legacy';
  }
  if (lens?.daily.side && lens.daily.side !== side) others.push(lens.daily.text);
  return {
    side, source,
    comp: c[side],
    call: c.CALL, put: c.PUT,
    otherLens: others.length ? others.join(' · ') : null,
  };
}

/** The trend the system is most confident in: the higher composite total.
 *  Ties keep the backend lens side so the pill doesn't flicker. */
export function dominantSide(check: EntryCheck): 'CALL' | 'PUT' {
  const c = check.composite;
  if (!c) return 'CALL';
  if (c.PUT.total > c.CALL.total) return 'PUT';
  if (c.CALL.total > c.PUT.total) return 'CALL';
  const ls = check.lens?.intraday.side;
  return ls === 'PUT' || ls === 'CALL' ? ls : 'CALL';
}

/** Does this tier pass the gate — an enterable side? */
export function isEnterTier(tier: CompositeTier): boolean {
  return tier === 'STRONG' || tier === 'MODERATE';
}

/** Strip pill color (2026-11-10): WAIT is orange on both sides; an
 *  enterable side is green for CALL, red for PUT. */
export function leadPillColor(comp: CompositeScore, colors: any): string {
  if (!isEnterTier(comp.tier)) return colors.warning;
  return comp.direction === 'CALL' ? colors.success : colors.error;
}

/** Detail sheet: the lens side's composite, or the higher-scoring side on WAIT.
 *  Pass the open trade's side so the sheet leads with the same side as the
 *  strip (PR #121 thread 10). */
export function chartComposite(check: EntryCheck | undefined, tradeSide?: 'CALL' | 'PUT' | null): CompositeScore | null {
  const v = resolveLens(check, tradeSide);
  if (!v) return null;
  return v.comp ?? (v.put && v.call && v.put.total > v.call.total ? v.put : v.call);
}

export function tierMeta(tier: CompositeTier, colors: any): { label: string; short: string; color: string; sub: string } {
  switch (tier) {
    case 'STRONG':   return { label: 'STRONG ENTRY', short: 'STRONG', color: colors.success, sub: 'Score ≥ +6' };
    case 'MODERATE': return { label: 'MODERATE', short: 'MODERATE', color: colors.warning, sub: '+4 to +5 · confirm-first' };
    case 'WATCH':    return { label: 'WATCH', short: 'WATCH', color: colors.textSecondary, sub: '+2 to +3 · wait for more' };
    default:         return { label: 'NO TRADE', short: 'NO TRADE', color: colors.error, sub: 'Below +2' };
  }
}

/** Green positive · gray zero/no data · red negative. */
export function scoreColor(score: number | null, colors: any): string {
  if (score == null || score === 0) return colors.textTertiary ?? colors.tabBarInactive;
  return score > 0 ? colors.success : colors.error;
}

export const fmtScore = (n: number) => (n > 0 ? `+${n}` : `${n}`);
