/**
 * Stable per-trade key for the client-only "hide this trade" feature (see
 * useHiddenPositions). strategy_id alone isn't safe to key on: a saved
 * strategy's engine has exactly one open trade at a time, but an "immediate"
 * (manual) trade's strategy_id is a synthetic per-ticker/mode id the backend
 * reuses across every sequential trade on that ticker — keying on strategy_id
 * alone would re-hide the *next* trade opened under the same engine too.
 * Folding in contract + entry_premium disambiguates those without needing
 * any backend-side trade-row id.
 */
export function positionHideKey(pos: {
  strategy_id: string;
  contract?: string | null;
  entry_premium?: number | null;
}): string {
  return `${pos.strategy_id}:${pos.contract ?? ''}:${pos.entry_premium ?? ''}`;
}
