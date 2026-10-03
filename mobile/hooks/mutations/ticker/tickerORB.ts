import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/supabase";
import { prettyJSON } from "@/common/utils/strings/function";
import { FollowTickerORB } from "@/common/types/blogPosts/orb";

/**
 * Hook to check if user follows a ticker's ORB
 */
export function useIsFollowingORB(ticker: string) {
  const {
    authState: { user },
  } = useAuth();

  return useQuery({
    queryKey: ["followTickerORB", ticker, user?.id],
    queryFn: async () => {
      if (!user) return null;

      const { data, error } = await supabase
        .from("user_stock_follows")
        .select("*")
        .eq("user_id", user.id)
        .eq("ticker", ticker.toUpperCase())
        .single();

      console.log(`Does user follow ${ticker} ? : ${prettyJSON(data)}`);

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows returned
        console.error("Error fetching ORB follow status:", error);
        throw error;
      }

      return data as FollowTickerORB;
    },
    enabled: !!user && !!ticker,
  });
}

/**
 * Turns ORB following on/off for one ticker — the single implementation
 * behind every ORB follow control (TickerDetailSheet's star, the ORB detail
 * modal's Unfollow, the add-ticker sheet). Updates or inserts the
 * user_stock_follows row; on unfollow it also clears the ticker's
 * orb_monitoring_state rows so the card drops immediately.
 *
 * The monitoring-row delete is best-effort: the ORB grid already hides
 * anything you don't follow (see monitor.tsx), and the backend drops the
 * ticker's rows on its next ticker refresh (OrbService
 * _drop_unfollowed_tickers), so a failed delete must not fail the unfollow.
 */
export async function setTickerORBFollow(userId: string, ticker: string, orbEnabled: boolean) {
  const normalizedTicker = ticker.toUpperCase();

  const { data: existingFollow, error: fetchError } = await supabase
    .from("user_stock_follows")
    .select("*")
    .eq("user_id", userId)
    .eq("ticker", normalizedTicker)
    .maybeSingle();
  if (fetchError) throw fetchError;

  if (existingFollow) {
    console.debug(`User ORB status for ${normalizedTicker} updated to: ${orbEnabled}`);
    const { data, error } = await supabase
      .from("user_stock_follows")
      .update({
        orb_enabled: orbEnabled,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("ticker", normalizedTicker)
      .select()
      .maybeSingle();
    if (error) throw error;

    if (!orbEnabled) {
      // ALL rows for the ticker (not just "today"): the grid renders any
      // monitoring_active row, and a UTC "today" diverges from the ET
      // trade_date the backend stores.
      const { data: deleted, error: deleteError } = await supabase
        .from("orb_monitoring_state")
        .delete()
        .eq("ticker", normalizedTicker)
        .select("ticker, trade_date");
      if (deleteError) {
        console.warn("Could not remove ticker from orb_monitoring_state:", deleteError);
      } else {
        console.debug(`Removed ${deleted?.length ?? 0} orb_monitoring_state row(s) for ${normalizedTicker}`);
      }
    }
    return data;
  }

  // Not followed yet — nothing to turn off.
  if (!orbEnabled) return null;

  console.debug(`User following ORB of ${normalizedTicker}`);
  const { data, error } = await supabase
    .from("user_stock_follows")
    .insert({
      user_id: userId,
      ticker: normalizedTicker,
      orb_enabled: true,
      notification_enabled: true,
      notify_confirmed_breakout: true,
      notify_reversal: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Everything that shows ORB follow state: the star on any ticker, the
 *  followed-ticker lists (Charts tab, ORB grid filter), and the grid rows. */
export function invalidateORBFollowQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["followTickerORB"] });
  queryClient.invalidateQueries({ queryKey: ["userORBFollows"] });
  queryClient.invalidateQueries({ queryKey: ["orb-monitoring-state"] });
}

/**
 * Hook to toggle ORB following for a ticker
 */
export function useToggleORBFollow(ticker?: string) {
  const {
    authState: { user },
  } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orbEnabled: boolean) => {
      if (!user) throw new Error("User not authenticated");
      if (!ticker) throw new Error("Ticker not set");
      return setTickerORBFollow(user.id, ticker, orbEnabled);
    },
    onSuccess: () => invalidateORBFollowQueries(queryClient),
  });
}

/**
 * Star / unstar a ticker for zone-alert priority (notification engine v2):
 * starred tickers get quiet pushes for approaches and active pushes for
 * confirmations; unstarred ones get approaches in-app only and quiet
 * confirmations. Until any ticker is starred, every followed ticker is
 * treated as starred (see api/services/notifications/alert_router.py).
 * Stored on the user_stock_follows row — inserted with orb_enabled=false if
 * the ticker isn't followed yet, so the star never turns ORB monitoring on.
 */
export function useToggleAlertStar(ticker?: string) {
  const {
    authState: { user },
  } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (starred: boolean) => {
      if (!user) throw new Error("User not authenticated");
      if (!ticker) throw new Error("Ticker not set");
      const normalizedTicker = ticker.toUpperCase();

      const { data: existing, error: fetchError } = await supabase
        .from("user_stock_follows")
        .select("id")
        .eq("user_id", user.id)
        .eq("ticker", normalizedTicker)
        .maybeSingle();
      if (fetchError) throw fetchError;

      if (existing) {
        const { error } = await supabase
          .from("user_stock_follows")
          .update({ alert_starred: starred, updated_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .eq("ticker", normalizedTicker);
        if (error) throw error;
        return starred;
      }
      if (!starred) return starred;
      const { error } = await supabase
        .from("user_stock_follows")
        .insert({ user_id: user.id, ticker: normalizedTicker, orb_enabled: false, alert_starred: true });
      if (error) throw error;
      return starred;
    },
    onSuccess: () => invalidateORBFollowQueries(queryClient),
  });
}

/**
 * Hook to get all ORB-enabled tickers for a user
 */
export function useUserORBFollows() {
  const {
    authState: { user },
  } = useAuth();

  return useQuery({
    queryKey: ["userORBFollows", user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from("user_stock_follows")
        .select("*")
        .eq("user_id", user.id)
        .eq("orb_enabled", true)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching user ORB follows:", error);
        throw error;
      }

      return data || [];
    },
    enabled: !!user,
  });
}

/**
 * Hook to manage the overall notification switch for an ORB follow
 */
export function useUpdateORBNotifications(ticker: string) {
  const {
    authState: { user },
  } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationEnabled: boolean) => {
      if (!user) throw new Error("User not authenticated");

      const { data, error } = await supabase
        .from("user_stock_follows")
        .update({
          notification_enabled: notificationEnabled,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .eq("ticker", ticker.toUpperCase())
        .eq("orb_enabled", true)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["followTickerORB", ticker, user?.id],
      });
    },
  });
}

/** Per-ticker notification types a user can independently enable/disable. */
export interface ORBNotificationTypePrefs {
  notify_confirmed_breakout: boolean;
  notify_reversal: boolean;
}

/**
 * Hook to manage which specific notification types fire for a single followed
 * ORB ticker (e.g. "Breakout Confirmed" vs "Reversal Detected"). Distinct from
 * useUpdateORBNotifications, which is the coarse on/off switch for the follow
 * as a whole — these two columns gate individual push types on the backend
 * (see OrbService.get_eligible_users' notification_type param).
 */
export function useUpdateORBNotificationTypes(ticker: string) {
  const {
    authState: { user },
  } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (prefs: Partial<ORBNotificationTypePrefs>) => {
      if (!user) throw new Error("User not authenticated");

      const { data, error } = await supabase
        .from("user_stock_follows")
        .update({
          ...prefs,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .eq("ticker", ticker.toUpperCase())
        .eq("orb_enabled", true)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["followTickerORB", ticker, user?.id],
      });
    },
  });
}
