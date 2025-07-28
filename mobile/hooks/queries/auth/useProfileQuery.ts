import { useAuth } from "@/context/auth/AuthContext";
import { supabase } from "@/lib/supabase/supabase";
import { ProfileModel } from "@/types/user/authModel";
import { logDebug } from "@/utils/strings/function";
import { useQuery } from "@tanstack/react-query";

export function useProfile() {
  const { authState: { user } } = useAuth();

  return useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
        
      if (error) throw error;

      logDebug("Profile data fetched successfully.")
      return data as ProfileModel;
    },
    enabled: !!user,
  });
}