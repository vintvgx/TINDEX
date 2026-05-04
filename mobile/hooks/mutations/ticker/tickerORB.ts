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

      const normalizedTicker = ticker.toUpperCase();

      const { data: existingFollow } = await supabase
        .from("user_stock_follows")
        .select("*")
        .eq("user_id", user.id)
        .eq("ticker", normalizedTicker)
        .single();

      if (existingFollow) {
        console.debug(`User ORB status for ${ticker} updated to: ${orbEnabled}`);
        const { data, error } = await supabase
          .from("user_stock_follows")
          .update({
            orb_enabled: orbEnabled,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id)
          .eq("ticker", normalizedTicker)
          .select()
          .single();

        if (error) throw error;

        // When removing, clean up today's monitoring row so the card drops
        // from the ORB grid immediately without waiting for the service.
        if (!orbEnabled) {
          const tradeDate = new Date().toISOString().split("T")[0];
          const { error: deleteError } = await supabase
            .from("orb_monitoring_state")
            .delete()
            .eq("ticker", normalizedTicker)
            .eq("trade_date", tradeDate);
          if (deleteError) {
            console.error("Error removing ticker from orb_monitoring_state:", deleteError);
          }
        }

        return data;
      } else {
        // Only insert if actually following — no point inserting orb_enabled=false
        if (!orbEnabled) return null;

        console.debug(`User following ORB of ${ticker}`);
        const { data, error } = await supabase
          .from("user_stock_follows")
          .insert({
            user_id: user.id,
            ticker: normalizedTicker,
            orb_enabled: true,
            notification_enabled: true,
          })
          .select()
          .single();

        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followTickerORB", ticker, user?.id] });
      queryClient.invalidateQueries({ queryKey: ["userORBFollows", user?.id] });
      // Refresh the ORB grid so removals drop instantly and adds are reflected
      queryClient.invalidateQueries({ queryKey: ["orb-monitoring-state"] });
    },
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
 * Hook to manage notification settings for ORB follows
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
