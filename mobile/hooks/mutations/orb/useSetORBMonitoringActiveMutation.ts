import { useMutation, useQueryClient } from '@tanstack/react-query';
import { User } from '@supabase/supabase-js';
import { setTickerORBFollow, invalidateORBFollowQueries } from '@/hooks/mutations/ticker/tickerORB';

export interface SetORBMonitoringActiveParams {
  ticker: string;
  monitoring_active: boolean;
  user: User | null;
}

/**
 * ORB detail modal's Unfollow. Same implementation and cache invalidation
 * as TickerDetailSheet's star (useToggleORBFollow): this used to be a
 * separate copy that only refreshed the ORB grid, so the star, the Charts
 * tab ticker list and the follow lists kept showing the ticker.
 */
export function useUnfollowTickerORB() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ticker, monitoring_active, user }: SetORBMonitoringActiveParams) => {
      if (!user?.id) throw new Error('User must be authenticated to update ORB monitoring');
      await setTickerORBFollow(user.id, ticker, monitoring_active);
    },
    onSuccess: () => invalidateORBFollowQueries(queryClient),
    onError: (error: Error) => {
      console.error('ORB unfollow failed:', error);
    },
  });
}
