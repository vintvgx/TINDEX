import { supabase } from "@/lib/supabase/supabase";
import {
  GoogleSignin,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import { prettyJSON } from "../strings/function";
import { UserProfile, UserProfileCreate } from "@/common/types/user/authModel";
import { DeviceInfo } from "@/common/types/util";
import { Platform } from "react-native";
import Constants from "expo-constants";

GoogleSignin.configure({
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  profileImageSize:
    Number(process.env.EXPO_PUBLIC_GOOGLE_PROFILE_IMAGE_SIZE) || 150,
});

export const signInWithGoogle = async () => {
  try {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (isSuccessResponse(response)) {
      const { idToken, user } = response.data;

      console.log("Google sign-in succeeded");
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: idToken!,
      });

      if (data.session && data.user) {
        console.log(`Google user signed in: ${data.user.email}`);

        // Create or update user profile
        const fullName =
          user?.name ||
          `${user?.givenName || ""} ${user?.familyName || ""}`.trim();

        const profileResult = await createOrUpdateUserProfile(data.user.id, {
          provider: "google",
          email: user?.email || undefined,
          fullName: fullName || undefined,
          firstName: user?.givenName || undefined,
          lastName: user?.familyName || undefined,
          avatarUrl: user?.photo || undefined,
        });

        if (!profileResult.success) {
          console.warn(
            "Google sign-in successful but profile creation/update failed:",
            profileResult.error
          );
          // Continue execution - user is still authenticated
        } else {
          console.log(
            "User profile created/updated successfully for Google user"
          );
        }
      } else {
        console.error(
          "Google sign-in failed with non-success response: ",
          error
        );
        throw new Error("Google sign-in failed: No session returned");
      }

      console.log("Google authentication successful:", data.user);
    }
  } catch (error: any) {
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      // user cancelled the login flow
      console.error("User cancelled the login flow");
    } else if (error.code === statusCodes.IN_PROGRESS) {
      // operation (e.g. sign in) is in progress already
      console.error("User sign in is in progress");
    } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      // play services not available or outdated
      console.error("Google play service is not available");
    } else {
      // some other error happened
      console.error("Unknown error occurred.");
    }
  }
};

export const signInWithApple = async () => {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    // Sign in via Supabase Auth.
    if (credential.identityToken) {
      console.log("Apple authentication successful:", credential.identityToken);
      const { error, data } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });

      console.log("Apple authentication successful:", prettyJSON(data));

      if (error) {
        console.log("Apple authentication error:", error);
        throw error;
      }

      if (data.user) {
        // Create or update user profile
        const fullName = credential.fullName
          ? `${credential.fullName.givenName || ""} ${credential.fullName.familyName || ""}`.trim()
          : undefined;
    

        const profileResult = await createOrUpdateUserProfile(data.user.id, {
          provider: "apple",
          email: credential.email || undefined,
          fullName: fullName || undefined,
          firstName: credential.fullName?.givenName || undefined,
          lastName: credential.fullName?.familyName || undefined,
        });

        if (!profileResult.success) {
          console.warn(
            "Apple sign-in successful but profile creation/update failed:",
            profileResult.error
          );
          // Continue execution - user is still authenticated
        } else {
          console.log(
            "User profile created/updated successfully for Apple user"
          );
        }
      }

      // User is signed in
      console.log("Apple authentication successful:", data.user);
    } else {
      throw new Error("No identityToken.");
    }
  } catch (e: unknown) {
    // showToast(TOAST.ERROR, e as string)
    if (
      e instanceof Error &&
      "code" in e &&
      e.code === "ERR_REQUEST_CANCELED"
    ) {
      console.log("User canceled Apple sign-in");
    } else {
      console.error("Apple sign-in error:", e);
    }
  }
};

/**
 * Signs out the current user
 * @returns Success status and any error
 */
export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Sign Out Error:", error);
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    console.error("Sign Out Error:", error);
    return { success: false, message: "An unexpected error occurred" };
  }
};

/**
 * Creates or updates a user profile in the database based on authentication data
 * @param userId - The user's unique identifier from Supabase Auth
 * @param providerData - Authentication provider data (Google or Apple)
 * @returns Success status and profile data
 */
export const createOrUpdateUserProfile = async (
  userId: string,
  providerData: {
    provider: "google" | "apple";
    email?: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
    username?: string;
  }
): Promise<{ success: boolean; profile?: UserProfile; error?: string }> => {
  try {
    // Check if profile already exists
    const { data: existingProfile, error: fetchError } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    // If profile exists, update it with new data
    if (existingProfile && !fetchError) {
      const updateData: Partial<UserProfile> = {
        email: providerData.email || existingProfile.email,
        full_name: providerData.fullName || existingProfile.full_name,
        avatar_url: providerData.avatarUrl || existingProfile.avatar_url,
      };

      const { data: updatedProfile, error: updateError } = await supabase
        .from("user_profiles")
        .update(updateData)
        .eq("id", userId)
        .select()
        .single();

      if (updateError) {
        console.error("Error updating user profile:", updateError);
        return { success: false, error: updateError.message };
      }

      console.log("User profile updated successfully");
      return { success: true, profile: updatedProfile };
    }

    // Create new profile if it doesn't exist
    const deviceInfo: DeviceInfo = {
      device_type: Platform.OS,
      os_version: Platform.Version.toString(),
      model: Constants.deviceName,
      platform: Platform.OS as "ios" | "android",
    };

    //TODO all but the user id is optional fields within profile settings so can omit unnecessary values
    const newProfileData: UserProfileCreate = {
      id: userId,
      email: providerData.email || null,
      full_name: providerData.fullName || null,
      avatar_url: providerData.avatarUrl || null,
      username: providerData.username || null,
      bio: null,
      expo_push_token: null,
      // notification_preferences: {
      //   badge: true,
      //   sound: true,
      //   enabled: true,
      //   mentions: true,
      //   messages: true,
      //   market_news: true,
      //   feed_updates: true,
      //   price_alerts: true,
      //   daily_summary: true,
      //   portfolio_updates: true,
      // },
      theme: "system",
      language: "en",
      currency: "USD",
      timezone: null,
      default_chart_interval: "1D",
      default_chart_type: "candlestick",
      watchlist_sort_preference: "alphabetical",
      user_interests: [],
      portfolio_risk_tolerance: null,
      investment_goals: [],
      experience_level: null,
      most_viewed_stocks: [],
      search_history: [],
      favorite_stocks: [],
      trading_frequency: null,
      last_active_at: new Date().toISOString(),
      total_sessions: 1,
      app_version: Constants.expoConfig?.version || "1.0.0",
      device_info: deviceInfo,
      terms_accepted_at: null,
      privacy_policy_accepted_at: null,
      marketing_consent: false,
      data_sharing_consent: false,
      is_active: true,
      is_verified: false,
      is_premium: false,
      premium_expires_at: null,
    };

    const { data: newProfile, error: createError } = await supabase
      .from("user_profiles")
      .insert(newProfileData)
      .select()
      .single();

    if (createError) {
      console.error("Error creating user profile:", createError);
      return { success: false, error: createError.message };
    }

    console.log("User profile created successfully");
    return { success: true, profile: newProfile };
  } catch (error) {
    console.error("Unexpected error in createOrUpdateUserProfile:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
};

// /**
//  * Generates a username from the user's name or email
//  * @param fullName - User's full name
//  * @param email - User's email address
//  * @param provider - Authentication provider
//  * @returns Generated username
//  */
// const generateUsername = (
//   fullName?: string,
//   email?: string,
//   provider?: string
// ): string => {
//   if (fullName) {
//     // Convert full name to username format
//     const cleanName = fullName
//       .toLowerCase()
//       .replace(/[^a-z0-9\s]/g, "") // Remove special characters
//       .replace(/\s+/g, "") // Remove spaces
//       .substring(0, 15); // Limit length

//     if (cleanName.length >= 3) {
//       return cleanName;
//     }
//   }

//   if (email) {
//     // Use email prefix as username
//     const emailPrefix = email
//       .split("@")[0]
//       .toLowerCase()
//       .replace(/[^a-z0-9]/g, "") // Remove special characters
//       .substring(0, 15); // Limit length

//     if (emailPrefix.length >= 3) {
//       return emailPrefix;
//     }
//   }

//   // Fallback to provider-based username
//   const timestamp = Date.now().toString().slice(-6);
//   return `${provider || "user"}_${timestamp}`;
// };

/**
 * Get the user's profile.
 */
export const getUserProfile = async (
  userId: string
): Promise<UserProfile | null> => {
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error fetching user profile:", error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error("Failed to fetch user profile:", error);
    return null;
  }
};
