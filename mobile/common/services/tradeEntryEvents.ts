import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Post-entry handoff (entry flow, 2026-10-11): once a trade sheet's success
 * state finishes, it emits `trade-entered`. Every modal that can host a trade
 * sheet (AgentModal, …) closes itself on it, and TradeEntryNavigator (tabs
 * shell) waits out the native dismiss animations, then lands on Home with the
 * new position highlighted + a toast. Module-level so no provider has to wrap
 * every modal that might host a trade sheet.
 */

export interface TradeEntered {
  ticker: string;
  contractSymbol: string;
  strategyId?: string;
  /** e.g. "SOFI 16.50C ×3" — the toast + success copy. */
  label: string;
  paperMode: boolean;
}

type Listener = (e: TradeEntered) => void;
const listeners = new Set<Listener>();

export function emitTradeEntered(e: TradeEntered): void {
  listeners.forEach((l) => l(e));
}

export function subscribeTradeEntered(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/**
 * Close a sheet/modal that can sit UNDER a trade sheet (ticker sheet, the
 * brief's pick sheet, contracts modal, …) the moment a trade is entered, so
 * TradeEntryNavigator lands on Home with no orphaned modal / ghost backdrop
 * left behind (entry-flow spec, acceptance #4). `close` is read from a ref —
 * passing a fresh closure each render never re-subscribes.
 */
export function useCloseOnTradeEntered(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    return subscribeTradeEntered(() => closeRef.current());
  }, [open]);
}

// --- Highlight: which position card Home should flag as just opened -------

/** How long the just-opened card stays highlighted on Home. */
const HIGHLIGHT_MS = 8_000;

interface Highlight {
  strategyId?: string;
  contractSymbol: string;
}

let highlight: Highlight | null = null;
let clearTimer: ReturnType<typeof setTimeout> | null = null;
const highlightListeners = new Set<() => void>();

export function setEntryHighlight(h: Highlight): void {
  highlight = h;
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    highlight = null;
    highlightListeners.forEach((l) => l());
  }, HIGHLIGHT_MS);
  highlightListeners.forEach((l) => l());
}

function subscribeHighlight(l: () => void) {
  highlightListeners.add(l);
  return () => {
    highlightListeners.delete(l);
  };
}

export function useEntryHighlight(): Highlight | null {
  return useSyncExternalStore(subscribeHighlight, () => highlight);
}

/** True when `pos` is the position the last entry opened. */
export function isHighlighted(
  h: Highlight | null,
  pos: { strategy_id?: string; contract?: string | null },
): boolean {
  if (!h) return false;
  if (h.strategyId && pos.strategy_id === h.strategyId) return true;
  return !!pos.contract && pos.contract === h.contractSymbol;
}
