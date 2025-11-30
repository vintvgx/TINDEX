import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import { UserProfile } from "@/common/types/user/authModel";
import { logDebug } from "@/common/utils/strings/function";
import { useQuery } from "@tanstack/react-query";

export function useProfile() {
  const { authState: { user } } = useAuth();

  return useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", user.id)
        .single();
        
      if (error) throw error;

      logDebug("Profile data fetched.")
      return data as UserProfile;
    },
    enabled: !!user,
  });
}