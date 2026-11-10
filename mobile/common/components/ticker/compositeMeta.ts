import type { CompositeScore, CompositeTier, EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';

/** Shared display helpers for the composite technicals score (strip + sheet). */

/** Which side the strip / header lead with, and from which lens. */
export interface LensView {
  side: 'CALL' | 'PUT' | 'WAIT';
  /** trade = an open position on this ticker took that side; intraday = the
   *  derived lens (entry-check `lens`); legacy = an API without `lens`. */
  source: 'trade' | 'intraday' | 'legacy';
  /** That side's composite — null on WAIT (both sides shown instead). */
  comp: CompositeScore | null;
  call: CompositeScore | null;
  put: CompositeScore | null;
  /** The other lens, spelled out, whenever it reads differently — e.g.
   *  "Daily: PUT (verdict ENTER)". Null when the lenses agree. */
  otherLens: string | null;
}

/**
 * The one read the strip and the header show (spec 2026-11-10 §2.2). An
 * open trade's side wins (the engine took it); otherwise the derived
 * intraday lens. Each side is graded on its own composite — a side the
 * engine did not take is never shown unlabelled, and WAIT shows both.
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
    side = lens.intraday.side;
    source = 'intraday';
  } else {
    // Older API: no lens — follow the signal, never a negated mirror.
    side = check.signal === 'CALL' || check.signal === 'PUT' ? check.signal : 'WAIT';
    source = 'legacy';
  }
  if (lens?.daily.side && lens.daily.side !== side) others.push(lens.daily.text);
  return {
    side, source,
    comp: side === 'WAIT' ? null : c[side],
    call: c.CALL, put: c.PUT,
    otherLens: others.length ? others.join(' · ') : null,
  };
}

/** Detail sheet: the lens side's composite, or the higher-scoring side on WAIT. */
export function chartComposite(check: EntryCheck | undefined): CompositeScore | null {
  const v = resolveLens(check);
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
