import { useEffect, useRef, useState } from 'react';
import { useStrategyTrades } from '@/hooks/queries/strategy/useStrategyTrades';
import type { ORBTrade } from '@/common/types/strategy';

export interface SoldAlert {
  trade: ORBTrade;
  /** Realized PnL across all of today's trades, including this one. */
  dayPnl: number;
  shownAt: number;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Watches recent trades for newly-closed contracts. When a sell is detected
 * (exit within the last 90s, not shown before), yields a SoldAlert with the
 * contract's PnL and the day's realized PnL. `dismiss` clears it.
 */
export function useSoldTradeAlert(): { alert: SoldAlert | null; dismiss: () => void } {
  // Poll every 15s — the alert must catch a sell within its 90s window.
  const { data: trades } = useStrategyTrades({ limit: 15, refetchIntervalMs: 15_000 });
  const [alert, setAlert] = useState<SoldAlert | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const dismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!trades) return;
    const now = Date.now();
    const today = todayISO();
    const dayPnl = trades
      .filter((t) => t.trade_date === today && t.pnl != null)
      .reduce((s, t) => s + (t.pnl ?? 0), 0);

    for (const t of trades) {
      if (!t.exit_time || t.pnl == null) continue;
      if (seenRef.current.has(t.id) || dismissedRef.current.has(t.id)) continue;
      seenRef.current.add(t.id);
      const exitMs = new Date(t.exit_time).getTime();
      if (!Number.isFinite(exitMs) || now - exitMs > 90_000) continue;
      setAlert({ trade: t, dayPnl, shownAt: now });
      break;
    }
  }, [trades]);

  // Auto-dismiss after 12s.
  useEffect(() => {
    if (!alert) return;
    const t = setTimeout(() => {
      dismissedRef.current.add(alert.trade.id);
      setAlert(null);
    }, 12_000);
    return () => clearTimeout(t);
  }, [alert]);

  return {
    alert,
    dismiss: () => {
      if (alert) dismissedRef.current.add(alert.trade.id);
      setAlert(null);
    },
  };
}
