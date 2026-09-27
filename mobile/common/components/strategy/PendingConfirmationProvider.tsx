import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Mounted once at the app root (see app/_layout.tsx), alongside ToastProvider.
 *
 * Used to also auto-show a blocking Enter/Skip modal over whatever screen was
 * active the instant any confirm_entry trade existed — a second confirmation
 * arriving while the first was still open stacked a SECOND full-screen modal
 * on top of it, which is exactly the "two pop-ups blocking the UI" problem
 * that motivated the 2026-07-29 redesign. Every pending confirmation now
 * shows as its own non-blocking card on the Dashboard (see dashboard.tsx's
 * PendingConfirmationCard) and as an "Awaiting Trade Confirmation" banner on
 * TickerTape, both of which poll usePendingConfirmations() independently.
 *
 * This provider now only keeps that query fresh globally: refetching the
 * instant the app foregrounds means a confirmation that fired while
 * backgrounded is already visible on Dashboard/TickerTape without waiting for
 * the next 5s poll tick, even before the user navigates to Dashboard.
 */
export function PendingConfirmationProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') qc.invalidateQueries({ queryKey: ['pending-confirmations'] });
    });
    return () => sub.remove();
  }, [qc]);

  return <>{children}</>;
}
