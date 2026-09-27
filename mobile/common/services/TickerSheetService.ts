/**
 * TickerSheetService - Singleton bridge between plain-JS navigation code
 * (NavigationService, which is not a React hook) and the React-rendered
 * global ticker bottom sheet (TickerSheetProvider).
 *
 * NavigationService.toTicker() calls open() here instead of pushing a route;
 * TickerSheetProvider subscribes on mount and renders the sheet whenever
 * the ticker changes.
 */

export interface TickerSheetOpenOptions {
  /** Opens straight into the full-screen chart view (e.g. the "Open Chart"
   *  button on a live position card) instead of the default sheet overview. */
  fullScreenChart?: boolean;
}

type Listener = (ticker: string | null, options: TickerSheetOpenOptions) => void;

class TickerSheetService {
  private static instance: TickerSheetService;
  private listeners: Set<Listener> = new Set();
  private activeTicker: string | null = null;
  private activeOptions: TickerSheetOpenOptions = {};

  static getInstance(): TickerSheetService {
    if (!TickerSheetService.instance) {
      TickerSheetService.instance = new TickerSheetService();
    }
    return TickerSheetService.instance;
  }

  open(ticker: string, options: TickerSheetOpenOptions = {}): void {
    if (!ticker || typeof ticker !== 'string') {
      console.warn('TickerSheetService.open: Invalid ticker provided');
      return;
    }
    this.activeTicker = ticker.toUpperCase();
    this.activeOptions = options;
    this.notify();
  }

  close(): void {
    this.activeTicker = null;
    this.activeOptions = {};
    this.notify();
  }

  getActiveTicker(): string | null {
    return this.activeTicker;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener(this.activeTicker, this.activeOptions));
  }
}

export default TickerSheetService;
