import { useAuth } from "@/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import { logDebug } from "@/utils/strings/function";
import { useQuery } from "@tanstack/react-query";


export function useFeedQuery() {
    //TODO ensure user is defined to view feed?
    const { authState: { user } } = useAuth();

    return useQuery({
        queryKey: ["feed"],
        queryFn: async () => {
          if (!user) return null; //TODO throw error to display Toast of user is not signed // 
          console.log("User:", user.email)
    
          const { data, error } = await supabase
          .from("blog_posts")
          .select("*")
          .eq("status", "published")
          .order("created_at", { ascending: false })
          .limit(20);

          if (error) {
            // If no assessment exists yet, that's not an error
            if (error.code === "PGRST116") return null;
            throw error;
          }
    
          // console.log(data)
          logDebug("Feed data fetched successfully.")
        //   return data as AssessmentResponse[]; //TODO create FeedResponse[]
        return data
        },
        enabled: !!user,
      });
}