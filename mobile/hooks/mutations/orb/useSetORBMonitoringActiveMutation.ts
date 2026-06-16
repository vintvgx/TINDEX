import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/supabase';
import { User } from '@supabase/supabase-js';

export interface SetORBMonitoringActiveParams {
  ticker: string;
  trade_date?: string;
  monitoring_active: boolean;
  user: User | null;
}

/**
 * TODO [2026-03-08] This call is already being made in ticker.tsx (useToggleORBFollow). Use that function or keep this one as the main throughout the application.
 *
 * Updates user_stock_follows (orb_enabled) for the ticker and, when unfollowing,
 * removes the ticker from orb_monitoring_state so it is no longer calculated or shown.
 */
async function unfollowTickerORB(
  params: SetORBMonitoringActiveParams
): Promise<void> {
  const { ticker, trade_date, monitoring_active, user } = params;
  const normalizedTicker = ticker.toUpperCase();

  if (!user?.id) {
    throw new Error('User must be authenticated to update ORB monitoring');
  }

  const { error: updateError } = await supabase
    .from('user_stock_follows')
    .update({
      orb_enabled: monitoring_active,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .eq('ticker', normalizedTicker)
    .select()
    .single();

  if (updateError) {
    console.error('Error updating ORB monitoring_active:', updateError);
    throw updateError;
  }

  // When unfollowing, remove the ticker's rows from orb_monitoring_state so it
  // drops out of the list. Delete ALL rows for the ticker rather than a single
  // trade_date: the grid shows any monitoring_active row regardless of date, and
  // the old UTC trade_date diverged from the backend's ET trade_date (matching
  // zero rows in the evening). A specific trade_date can still be passed to scope
  // the delete when needed.
  if (!monitoring_active) {
    let query = supabase
      .from('orb_monitoring_state')
      .delete()
      .eq('ticker', normalizedTicker);

    if (trade_date) {
      query = query.eq('trade_date', trade_date);
    }

    const { error: deleteError } = await query;

    if (deleteError) {
      console.error('Error removing ticker from orb_monitoring_state:', deleteError);
      throw deleteError;
    }
  }
}

/**
 * Hook to set monitoring_active for a ticker in the orb list.
 * On success invalidates orb-monitoring-state so the list refetches and
 * unfollowed tickers (monitoring_active=false) can be filtered out.
 */
export function useUnfollowTickerORB() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: unfollowTickerORB,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orb-monitoring-state'] });
    },
    onError: (error: Error) => {
      console.error('Set ORB monitoring_active failed:', error);
    },
  });
}
