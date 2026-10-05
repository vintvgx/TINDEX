import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface ChartOverlay {
  /** Is the full-screen chart overlay open? */
  open: boolean;
  /** Ticker to show when the overlay opens (defaults to the chart's own selection). */
  ticker: string | null;
  openChart: (ticker?: string | null) => void;
  closeChart: () => void;
}

const Ctx = createContext<ChartOverlay | null>(null);

export function ChartOverlayProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState<string | null>(null);

  const openChart = useCallback((t?: string | null) => {
    setTicker(t ?? null);
    setOpen(true);
  }, []);
  const closeChart = useCallback(() => setOpen(false), []);

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
