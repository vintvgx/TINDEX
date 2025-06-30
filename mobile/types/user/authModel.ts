import { Session, User } from "@supabase/supabase-js";
import { UseMutationResult } from "@tanstack/react-query";

// This state tracks:
// - user: The currently authenticated user (null if not logged in)
// - session: The active auth session (null if not authenticated)
// - loading: Whether auth state is being initialized/updated
// - isAuthenticated: Whether there is an active authenticated session
export enum OnboardingStep {
  NONE = "none",
  ROLE = "role",
  USERNAME = "username",
  MOBILE = "mobile",
  PROFILE = "profile",
  ASSESSMENT = "assessment",
  COMPLETED = "completed",
}

export type AuthContextType = {
  authState: AuthState;
  refreshSession: () => Promise<void>;
  signOutMutation?: UseMutationResult<void, Error, void>;
};

export type AuthState = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
};
