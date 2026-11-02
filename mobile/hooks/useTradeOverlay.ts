import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  buildOverlayFrame, shouldRedraw,
  type DrawnFrame, type OverlayTradeInput, type TradeOverlayFrame,
} from '@/lib/chartTradeOverlay';

/** Re-check interval while a trade is on screen — catches staleness (no
 *  pushes arriving) and the 15s redraw when the price is quiet. Compute only;
 *  it draws only when shouldRedraw says so. */
const RECHECK_MS = 5_000;

/**
 * The overlay frame the chart should DRAW right now (brief §6): listens to
 * every push and recomputes in memory, but only hands a new frame to the
 * chart on a state change, a sim tick, every 15s, or a ≥ threshold move.
 * Paused (no draws) while `visible` is false or the app is backgrounded;
 * on return it draws the latest values once, without backfilling.
 */
export function useTradeOverlay(
  trades: OverlayTradeInput[],
  selectedKey: string | null,
  visible: boolean,
): TradeOverlayFrame | null {
  const [drawn, setDrawn] = useState<TradeOverlayFrame | null>(null);
  const drawnRef = useRef<DrawnFrame | null>(null);
  const inputRef = useRef({ trades, selectedKey });
  inputRef.current = { trades, selectedKey };
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const live = visible && appActive;

  const evaluate = (force = false) => {
    const now = Date.now();
    const next = buildOverlayFrame(inputRef.current.trades, inputRef.current.selectedKey, now);
    if (force || shouldRedraw(drawnRef.current, next, now)) {
      drawnRef.current = { frame: next, at: now };
      setDrawn(next);
    }
  };

  // Every push (trades identity changes) → compute; draw per cadence.
  useEffect(() => {
    if (live) evaluate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, selectedKey, live]);

  // Becoming visible again → draw the latest values once.
  useEffect(() => {
    if (live) evaluate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const hasTrade = trades.length > 0;
  useEffect(() => {
    if (!live || !hasTrade) return;
    const id = setInterval(() => evaluate(), RECHECK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, hasTrade]);

  return live ? drawn : drawnRef.current?.frame ?? null;
}
