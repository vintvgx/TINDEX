import { useAuth } from "@/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import { Topic } from "@/types";
import { logDebug } from "@/utils/strings/function";
import { useQuery } from "@tanstack/react-query";

export function useTopicsQuery() {
  //TODO ensure user is defined to view feed??? Not needed for Topics
  const {
    authState: { user },
  } = useAuth();

  return useQuery({
    queryKey: ["topics"],
    queryFn: async (): Promise<Topic[] | null> => {
      if (!user) return null; //TODO throw error to display Toast of user is not signed //

      // TODO look up alg to return topics as the user searches for them /
      const { data, error } = await supabase.from("topics").select("*");

      if (error) {
        // Handle case where no topics exist yet
        if (error.code === "PGRST116") return null;
        throw error;
      }

      logDebug("Assessment data fetched successfully.");
      //   return data as AssessmentResponse[]; //TODO create FeedResponse[]
      return data as Topic[];
    },

    enabled: !!user,
  });
}
