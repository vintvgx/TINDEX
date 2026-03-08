import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/supabase';
import { UserModel } from '@/common/types/user/authModel';
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
 * Updates user_stock_follows for a ticker in orb_monitoring_state.
 * Used to unfollow (stop monitoring) a ticker so it is no longer calculated.
 *
 */
async function setORBMonitoringActive(
  params: SetORBMonitoringActiveParams
): Promise<void> {
  const { ticker, monitoring_active, user } = params;
  const normalizedTicker = ticker.toUpperCase();

  const { error } = await supabase
    .from('user_stock_follows')
    .update({
      orb_enabled: monitoring_active,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user?.id)
    .eq('ticker', normalizedTicker)
    .select()
    .single();

  if (error) {
    console.error('Error updating ORB monitoring_active:', error);
    throw error;
  }
}

/**
 * Hook to set monitoring_active for a ticker in the orb list.
 * On success invalidates orb-monitoring-state so the list refetches and
 * unfollowed tickers (monitoring_active=false) can be filtered out.
 */
export function useSetORBMonitoringActiveMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setORBMonitoringActive,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orb-monitoring-state'] });
    },
    onError: (error: Error) => {
      console.error('Set ORB monitoring_active failed:', error);
    },
  });
}
