import React, { useState, useEffect } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { usePendingConfirmations } from '@/hooks/queries/strategy/usePendingConfirmations';
import { PendingConfirmationModal } from '@/common/components/strategy/PendingConfirmationModal';

/**
 * Mounted once at the app root (see app/_layout.tsx), alongside ToastProvider.
 * Polls for any confirm_entry trade awaiting a response and shows the
 * Enter/Skip modal over whatever screen is currently active — foregrounding
 * the app is enough to see it; a notification tap is a convenience, not the
 * only trigger.
 */
export function PendingConfirmationProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data: pendingList } = usePendingConfirmations();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Refetch immediately whenever the app comes back to the foreground, so a
  // confirmation that fired while backgrounded shows up without waiting for
  // the next poll tick.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') qc.invalidateQueries({ queryKey: ['pending-confirmations'] });
    });
    return () => sub.remove();
  }, [qc]);

  const active = (pendingList ?? []).find(p => !dismissedIds.has(p.id));

  const handleResolved = () => {
    if (active) setDismissedIds(prev => new Set(prev).add(active.id));
    qc.invalidateQueries({ queryKey: ['pending-confirmations'] });
  };

  return (
    <>
      {children}
      {active && (
        <PendingConfirmationModal
          visible
          pending={active}
          onResolved={handleResolved}
        />
      )}
    </>
  );
}
