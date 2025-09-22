import { supabase } from "@/lib/supabase/supabase";
import { AuthContextType, AuthState } from "@/types/user/authModel";
// import {
//   checkAssessmentStatus,
//   checkProfileStatus,
//   checkRoleStatus,
// } from "@/utils/auth/function";
import { logDebug } from "@/utils/strings/function";
import { Session } from "@supabase/supabase-js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
//@ts-ignore
import { router } from "expo-router";
import React, { createContext, useContext, useEffect, useState } from "react";

// Create the context with default values
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const [authState, setAuthState] = useState<AuthState>({
    session: null,
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  // state to track initial navigation
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize session data and set up auth listeners
  useEffect(() => {
    const initializeAuth = async () => {
      console.log("Initializing auth");
      try {
        // Retry logic for network errors
        let retries = 3;
        let success = false;
        let sessionData = null;

        while (retries > 0 && !success) {
          // Get current session
          const {
            data: { session },
            error,
          } = await supabase.auth.getSession();

          if (error) {
            if (error.message?.includes("network") && retries > 1) {
              console.log(
                `Network error, retrying... (${retries - 1} attempts left)`
              );
              retries--;
              await new Promise((resolve) => setTimeout(resolve, 1000));
              continue;
            }
            console.error("Error getting initial session:", error);
            setAuthState((prev) => ({
              ...prev,
              isLoading: false,
              isAuthenticated: false,
            }));
            return;
          }

          success = true;
          sessionData = session;
        }

        // Success
        if (sessionData) {
          // Process the session and update state
          await handleSessionChange(sessionData);
        } else {
          // No active session
          console.log("No active session");
          setAuthState((prev) => ({
            ...prev,
            isLoading: false,
            isAuthenticated: false,
          }));
        }

        // Mark initialization as complete after auth is processed
        setIsInitialized(true);
      } catch (error) {
        console.error("Fatal error during auth initialization:", error);
        setAuthState((prev) => ({
          ...prev,
          isLoading: false,
          isAuthenticated: false,
        }));
        setIsInitialized(true);
      }
    };

    // Set up auth state change listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log(`Supabase auth event: ${event}`);
      await handleSessionChange(session);

      if (session?.user?.id) {
        // Fetch feed
        queryClient.invalidateQueries({
          queryKey: ["feed"],
        });

        // Fetch user profile information
        queryClient.invalidateQueries({
          queryKey: ["profile", session.user.id],
        });
      }

      // TODO Invalidate queries that depend on authentication state
      //   if (session?.user?.id) {
      //     queryClient.invalidateQueries({
      //       queryKey: ["profile", session.user.id],
      //     });
      //     queryClient.invalidateQueries({
      //       queryKey: ["assessments", session.user.id],
      //     });
      //   } else {
      //     queryClient.invalidateQueries({
      //       queryKey: ["profile", session?.user?.id],
      //     });
      //     queryClient.invalidateQueries({
      //       queryKey: ["assessments", session?.user?.id],
      //     });
      //   }
    });

    // Start the initialization process
    initializeAuth();

    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, [queryClient]);

  // Handle navigation based on auth and onboarding state
  useEffect(() => {
    console.log("Handling navigation based on auth and onboarding state");
    if (authState.isLoading) return;

    if (isInitialized) {
      // Not authenticated
      if (!authState.session) {
        console.log("Navigating to Auth");
        router.replace("/(public)/auth");
        return;
      }

      // User is fully authenticated
      if (authState.isAuthenticated && authState.session) {
        console.log("Navigating to Feed");
        // Navigate to Home
        router.replace("/(app)/feed");
      }
    }
  }, [authState, isInitialized]);

  /**
   * Mutation for signing out the user
   * @returns void
   */
  const signOutMutation = useMutation({
    mutationFn: async () => {
      console.log("Signing out");
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => {
      setAuthState({
        session: null,
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });

      // Only navigate after signing out if initialization is complete
      if (isInitialized) {
        router.replace("/(public)/auth");
      }

      // Clear all queries from the cache on signout
      queryClient.clear();
    },
    onError: (error) => {
      console.error("Error signing out:", error);
      // reset the auth state to maintain consistent state
      setAuthState({
        session: null,
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });

      if (isInitialized) {
        router.replace("/(public)/auth");
      }
    },
  });

  /**
   * Refreshes the session
   * @returns void
   */
  const refreshSession = async () => {
    console.log("Refreshing session");
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error("Error refreshing session:", error);
      return;
    }

    if (data?.session) {
      console.log("Refreshing session", data.session);
      await handleSessionChange(data.session);
    } else {
      console.log("No session data");
      setAuthState((prev) => ({
        ...prev,
        session: null,
        user: null,
        isLoading: false,
        isAuthenticated: false,
      }));
    }
  };

  /**
   * Handles session state changes in the authentication flow.
   *
   * This function updates the authentication state based on the current session.
   * It follows a two-step approach to prevent premature navigation:
   * Updates user and session data while keeping the loading state active and sets isLoading to false when complete
   *
   *
   * @param session - The current Supabase session or null if no active session
   */
  const handleSessionChange = async (session: Session | null) => {
    logDebug("Handling session change");
    if (session) {
      setAuthState((prev) => ({
        ...prev,
        user: session.user,
        session,
        isAuthenticated: true,
        // Keep isLoading true until we check onboarding
        isLoading: true,
      }));

      // Fetch user profile and refresh feed
      if (session.user?.id) {
        queryClient.invalidateQueries({
          queryKey: ["feed", session.user.id],
        });

        queryClient.invalidateQueries({
          queryKey: ["profile", session.user.id],
        });
      }

      // Update the state
      setAuthState((prev) => ({
        ...prev,
        isLoading: false,
      }));
    } else {
      setAuthState({
        session: null,
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
      // Clear all queries from the cache on signout
      queryClient.clear();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        authState,
        signOutMutation,
        refreshSession,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook to use the auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
