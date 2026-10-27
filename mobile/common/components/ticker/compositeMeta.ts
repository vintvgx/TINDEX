import type { CompositeScore, CompositeTier, EntryCheck } from '@/hooks/queries/technicals/useEntryCheck';

/** Shared display helpers for the composite technicals score (strip + sheet). */

/**
 * The composite side the chart shows: the signal's side when it has one,
 * else whichever side scores higher (CALL on a tie). Null on an API that
 * predates the composite score.
 */
export function chartComposite(check: EntryCheck | undefined): CompositeScore | null {
  const c = check?.composite;
  if (!c) return null;
  if (check!.signal === 'CALL') return c.CALL;
  if (check!.signal === 'PUT') return c.PUT;
  return c.PUT.total > c.CALL.total ? c.PUT : c.CALL;
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
