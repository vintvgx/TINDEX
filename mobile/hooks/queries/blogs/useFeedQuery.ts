import { useAuth } from "@/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import { logDebug } from "@/utils/strings/function";
import { useQuery } from "@tanstack/react-query";


export function useAssessment() {
    //TODO ensure user is defined to view feed?
    const { authState: { user } } = useAuth();

    return useQuery({
        queryKey: ["feed"],
        queryFn: async () => {
          if (!user) return null; //TODO throw error to display Toast of user is not signed // 
    
          const { data, error } = await supabase
            .from("feed")
            .select("*")
            // .eq("user_id", user.id)

          if (error) {
            // If no assessment exists yet, that's not an error
            if (error.code === "PGRST116") return null;
            throw error;
          }
    
          logDebug("Assessment data fetched successfully.")
        //   return data as AssessmentResponse[]; //TODO create FeedResponse[]
        return data
        },


        enabled: !!user,
      });
}