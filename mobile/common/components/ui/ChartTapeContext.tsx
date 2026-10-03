import React, { createContext, useContext, useState, useCallback } from 'react';

/**
 * ChartTapeContext — lets the Charts tab publish its active ticker's
 * headline info (ticker, price, day change, gate signal) up to the global
 * TickerTape, which swaps its market marquee for that info while the Charts
 * tab is mounted. Unmounting the tab clears it and the marquee returns.
 */
export type ChartTapeSignal = 'CALL' | 'PUT' | 'WAIT' | 'NA' | null;

export interface ChartTapeInfo {
  ticker: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  signal: ChartTapeSignal;
  loading: boolean;
}

interface Ctx {
  info: ChartTapeInfo | null;
  setInfo: (info: ChartTapeInfo | null) => void;
}

const ChartTapeContext = createContext<Ctx>({ info: null, setInfo: () => {} });

export function ChartTapeProvider({ children }: { children: React.ReactNode }) {
  const [info, setInfoState] = useState<ChartTapeInfo | null>(null);
  const setInfo = useCallback((i: ChartTapeInfo | null) => setInfoState(i), []);
  return (
    <ChartTapeContext.Provider value={{ info, setInfo }}>
      {children}
    </ChartTapeContext.Provider>
  );
}

export function useChartTape() {
  return useContext(ChartTapeContext);
}
