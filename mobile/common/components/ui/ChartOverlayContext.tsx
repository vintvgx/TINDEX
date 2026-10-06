import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface ChartOverlay {
  /** Is the full-screen chart overlay open? */
  open: boolean;
  /** Ticker to show when the overlay opens (defaults to the chart's own selection). */
  ticker: string | null;
  openChart: (ticker?: string | null) => void;
  closeChart: () => void;
}

const Ctx = createContext<ChartOverlay | null>(null);

// Module-level bridge so code OUTSIDE the provider can open the overlay —
// e.g. the ticker sheet (TickerSheetProvider sits at the app root, above the
// tabs layout that owns this provider). Same pattern as TickerSheetService.
let bridgeOpen: ((ticker?: string | null) => void) | null = null;

/** Open the full-screen chart (charts.tsx) on `ticker`, from anywhere. */
export function openChartOverlay(ticker?: string | null): void {
  bridgeOpen?.(ticker);
}

export function ChartOverlayProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState<string | null>(null);

  const openChart = useCallback((t?: string | null) => {
    setTicker(t ?? null);
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
    () => ({ open, ticker, openChart, closeChart }),
    [open, ticker, openChart, closeChart],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChartOverlay(): ChartOverlay {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChartOverlay must be used inside ChartOverlayProvider');
  return v;
}
