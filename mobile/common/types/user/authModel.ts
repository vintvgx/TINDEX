import { Session, User } from "@supabase/supabase-js";
import { UseMutationResult } from "@tanstack/react-query";
import { NotificationPreferences } from "../notifications/notificationModel";
import { DeviceInfo } from "../util";
import { WatchlistType } from "../watchlist";
import { SearchHistoryItem } from "../blogPosts/ticker";

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
  profile: UserProfile | null;
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
  profile: UserProfile;
  createdAt: Date;
  lastActiveAt: Date;
}

/**
 * Represents a user's profile basic info, preferences, data and notification settings.
 *
 * TODO ProfileModel is used below, replace useProfileQuery with UserProfile type
 */
export interface UserProfile {
  id: string;

  // Basic Profile Info
  username?: string | null;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;

  // Push Notifications
  expo_push_token?: string | null;
  watchlist_subscriptions: WatchlistType[]; //  ["gainers", "trending", "most_active", "favorites"]
  notification_preferences: NotificationPreferences;

  // User Preferences & Settings
  theme?: "light" | "dark" | "system" | null;
  language?: string | null;
  currency?: string | null;
  timezone?: string | null;

  // Stock-Related Preferences
  default_chart_interval?: "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y" | null;
  default_chart_type?: "line" | "candlestick" | "bar" | null;
  watchlist_sort_preference?:
    | "alphabetical"
    | "gain"
    | "loss"
    | "volume"
    | null;
  minimized_watchlist?:
    | "trending"
    | "gainers"
    | "most_active"
    | "favorites"
    | null;
  market_pulse_config?: string[] | null;

  // Algorithm Improvement Data
  user_interests?: string[] | null; // Array of stock sectors/industries
  portfolio_risk_tolerance?: "conservative" | "moderate" | "aggressive" | null;
  investment_goals?: string[] | null; // ['retirement', 'short_term_gains', 'dividend_income']
  experience_level?:
    | "beginner"
    | "intermediate"
    | "advanced"
    | "professional"
    | null;

  // Behavioral Analytics
  most_viewed_stocks?: string[] | null; // Array of stock symbols
  search_history?: SearchHistoryItem[] | null;
  favorite_stocks?: string[] | null; // Array of stock symbols
  trading_frequency?:
    | "day_trader"
    | "swing_trader"
    | "long_term"
    | "occasional"
    | null;

  // Engagement Metrics
  last_active_at?: string | null;
  total_sessions?: number | null;
  app_version?: string | null;
  device_info?: DeviceInfo | null;

  // Privacy & Consent
  terms_accepted_at?: string | null;
  privacy_policy_accepted_at?: string | null;
  marketing_consent?: boolean | null;
  data_sharing_consent?: boolean | null;

  // Account Status
  is_active?: boolean | null;
  is_verified?: boolean | null;
  is_premium?: boolean | null;
  premium_expires_at?: string | null;

  // Timestamps
  created_at: string;
  updated_at: string;
}

// Helper type for updating user profile (all fields optional except id)
export type UserProfileUpdate = Partial<
  Omit<UserProfile, "id" | "created_at">
> & {
  id: string;
};

// Helper type for creating initial user profile
// NOTE: removes id, created_at and updated_at from being included fields (should not be used when creating a profile =)
export type UserProfileCreate = Pick<UserProfile, "id"> &
  Partial<Omit<UserProfile, "id" | "created_at" | "updated_at">>;
