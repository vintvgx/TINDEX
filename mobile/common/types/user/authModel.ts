import { Session, User } from "@supabase/supabase-js";
import { UseMutationResult } from "@tanstack/react-query";

// This state tracks:
// - user: The currently authenticated user (null if not logged in)
// - session: The active auth session (null if not authenticated)
// - loading: Whether auth state is being initialized/updated
// - isAuthenticated: Whether there is an active authenticated session

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

export interface UserModel {
  user: User;
  firstName: string;
  lastName: string;
  username: string;
  dob: Date | string;
  isAnonymous: boolean; // Flag for anonymous users
  profileCompletionPercentage: number; // Track completion
  profile: ProfileModel;
  createdAt: Date;
  lastActiveAt: Date;
}


  /**
   * Represents a user's profile preferences, interests, and experiences.
   * * Note: Property names use snake_case to match the database schema
   */
  export type ProfileModel = {
    /** Unique identifier for the profile */
     id: string;
     /** Reference to the user's ID in the auth system */
     user_id: string;
     first_name: string;
     last_name: string;
     username: string;
     phone_number: string;
     dob: string | null;
     is_anon: boolean;
     updated_at: string;
   }