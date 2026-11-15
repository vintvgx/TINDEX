import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Dimensions } from 'react-native';

/** A rect in window coordinates (what `measureInWindow` reports). */
export interface ChartOriginRect { x: number; y: number; width: number; height: number }

/** Window rect of the ticker card at its last tap (`.current`). The chart
 *  overlay's expand starts from here when the caller passes no rect (e.g.
 *  the ticker detail sheet). Lives here, not in TickerCard, so this module
 *  doesn't import TickerCard (which imports this) — TickerCard re-exports it. */
export const lastTickerCardRect: { current: ChartOriginRect | null } = { current: null };

/** Is the overlay still mounted (open, expanding or collapsing)? Written by
 *  the tabs `_layout.tsx`. While true, Home may be scaled (it recedes), so
 *  `measureInWindow` on the card returns a transformed rect — the card must
 *  not record measurements then. A ref, not state: nothing re-renders on it. */
export const chartOverlayRendered: { current: boolean } = { current: false };

/** No card measured yet: a card-sized rect at the bottom center. */
function fallbackRect(): ChartOriginRect {
  const { width, height } = Dimensions.get('window');
  const w = 120;
  const h = 56;
  return { x: (width - w) / 2, y: height - 120 - h, width: w, height: h };
}

interface ChartOverlay {
  /** Does the user want the full-screen chart open? (Mount/unmount timing
   *  for the expand/collapse animation lives in the tabs `_layout.tsx`.) */
  open: boolean;
  /** Ticker to show when the overlay opens (defaults to the chart's own selection). */
  ticker: string | null;
  /** Window rect the chart expands out of / collapses back into. */
  originRect: ChartOriginRect;
  openChart: (ticker?: string | null, originRect?: ChartOriginRect | null) => void;
  closeChart: () => void;
}

const Ctx = createContext<ChartOverlay | null>(null);

// Module-level bridge so code OUTSIDE the provider can open the overlay —
// e.g. the ticker sheet (TickerSheetProvider sits at the app root, above the
// tabs layout that owns this provider). Same pattern as TickerSheetService.
let bridgeOpen: ((ticker?: string | null) => void) | null = null;

/** Open the full-screen chart (charts.tsx) on `ticker`, from anywhere. It
 *  expands from the ticker card's last measured rect. */
export function openChartOverlay(ticker?: string | null): void {
  bridgeOpen?.(ticker);
}

export function ChartOverlayProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState<string | null>(null);
  const [originRect, setOriginRect] = useState<ChartOriginRect>(fallbackRect);

  const openChart = useCallback((t?: string | null, rect?: ChartOriginRect | null) => {
    setTicker(t ?? null);
    setOriginRect(rect ?? lastTickerCardRect.current ?? fallbackRect());
    setOpen(true);
  }, []);
  const closeChart = useCallback(() => setOpen(false), []);

  useEffect(() => {
    bridgeOpen = openChart;
    return () => {
      if (bridgeOpen === openChart) bridgeOpen = null;
    };
  }, [openChart]);

  const value = useMemo(
    () => ({ open, ticker, originRect, openChart, closeChart }),
    [open, ticker, originRect, openChart, closeChart],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChartOverlay(): ChartOverlay {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChartOverlay must be used inside ChartOverlayProvider');
  return v;
}
