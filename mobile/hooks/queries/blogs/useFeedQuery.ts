import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import { FeedType, UnifiedFeedItem } from "@/common/types";
import { logDebug } from "@/common/utils/strings/function";
import { useQuery } from "@tanstack/react-query";


export function useFeedQuery() {
    //TODO ensure user is defined to view feed?
    const { authState: { user } } = useAuth();

    return useQuery({
        queryKey: ["feed"],
        queryFn: async (): Promise<FeedType | null> => {
          logDebug("Fetching unified feed")

          if (!user) return null; //TODO throw error to display Toast of user is not signed // 
    
          const { data, error } = await supabase
          .from("unified_feed")
          .select("*")
          .order("published_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(50);

          if (error) {
            // If no items exist yet, that's not an error
            if (error.code === "PGRST116") return null;
            console.error("Error retrieving the unified feed:", error)
            throw error;
          }
    
          logDebug("Unified feed data fetched", { count: data?.length || 0 })
          return { items: (data || []) as UnifiedFeedItem[] };
      },
        enabled: !!user,
      });
}