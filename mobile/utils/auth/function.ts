// //TODO FIX this file
// import { TOAST } from "@/components/ui/toast/useToast";
import { supabase } from "@/lib/supabase/supabase";
// import { UserMetaData, UserType } from "@/types/user/user";
import {
  GoogleSignin,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import { prettyJSON } from '../strings/function';

// GoogleSignin.configure({
//   scopes: ["https://www.googleapis.com/auth/drive.readonly"],
//   // iosClientId:
//   //   "1064184478567-3n1pm51cp4bm56nmruhvt5tpi0fulkqv.apps.googleusercontent.com",
//   // webClientId:
//   //   "1064184478567-832gl286kq3l3t1o14ue4rqb38fnjg2t.apps.googleusercontent.com",
//   // profileImageSize: 150,
//   iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
//   webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
//   profileImageSize:
//     Number(process.env.EXPO_PUBLIC_GOOGLE_PROFILE_IMAGE_SIZE) || 150,
// });

// //TODO swtich to this configuration for next build
GoogleSignin.configure({
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  profileImageSize: Number(process.env.EXPO_PUBLIC_GOOGLE_PROFILE_IMAGE_SIZE) || 150,
});

export const signInWithGoogle = async () => {
  try {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (isSuccessResponse(response)) {
      const { idToken, user } = response.data;

      console.log("Response: ", response)

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: idToken!,
      });

      if (data.session) {
        console.log(`Google user signed in: ${data.user.email}`);
      } else {
        console.error("Google sign-in failed with non-success response: ", error);
        throw new Error("Google sign-in failed: No session returned");
      }

      //TODO Update user metadata if sign-in was successful ?
      //   if (data.user) {
      //     const metadataResult = await updateUserMetadata({
      //       firstName: user?.givenName,
      //       lastName: user?.familyName,
      //       email: user.email,
      //     });

      //     if (!metadataResult.success) {
      //       console.warn(
      //         "User created but metadata update failed:",
      //         metadataResult.error
      //       );
      //       showToast(
      //         TOAST.INFO,
      //         `${data.user.email} authenticated successfully. METADATA NOT UPDATED!`
      //       );
      //       return;
      //     }
      //     console.log("User metadata saved successfully");
      //   }

      console.log("Google authentication successful:", data.user);
      //   showToast(TOAST.SUCCESS, `${user.email} authenticated successfully`)
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

      //TODO Update user metadata if sign-in was successful ?
      //   if (data.user) {
      //     const metadataResult = await updateUserMetadata({
      //       firstName: credential.fullName?.givenName,
      //       lastName: credential.fullName?.familyName,
      //       email: credential.email,
      //     });

      //     if (!metadataResult.success) {
      //       console.warn(
      //         "User created but metadata update failed:",
      //         metadataResult.error
      //       );
      //       showToast(
      //         TOAST.INFO,
      //         "User authenticated successfully. METADATA NOT UPDATED!"
      //       );
      //       return;
      //     }

      //     console.log("User metadata saved successfully");
      //   }

      // User is signed in
      console.log("Apple authentication successful:", data.user);
      //   showToast(TOAST.SUCCESS, `${data.user.email} authenticated successfully`)
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

// /**
//  * Generate a unique username
//  * TODO Delete / user name is updated within user name
//  */
// const generateUsername = () => {
//   return `user_${nanoid(8)}`;
// };

// /**
//  * Updates user metadata after successful authentication
//  * @param userData Optional user data from authentication provider
//  * @param phoneNumber Optional phone number (primarily for mobile auth)
//  * @returns Object containing success status and any error
//  */
// export const updateUserMetadata = async (userData?: UserMetaData) => {
//   try {
//     // Initialize user metadata with optional values from auth provider
//     // Empty values are acceptable as user will complete profile during onboarding
//     // All fields will be collected during the PROFILE step of onboarding flow
//     const metadataToUpdate = {
//       first_name: userData?.firstName || "",
//       last_name: userData?.lastName || "",
//       username: userData?.username || (await generateUsername()),
//       avatar_url: userData?.avatar || "",
//       mobile: userData?.phoneNumber || "",
//       email: userData?.email || "",
//     };

//     // Update user metadata
//     const { data, error } = await supabase.auth.updateUser({
//       data: metadataToUpdate,
//     });

//     if (error) {
//       console.warn("Failed to update user metadata:", error);
//       return { success: false, error };
//     }

//     return { success: true, error: null, user: data.user };
//   } catch (error) {
//     console.error("Error updating user metadata:", error);
//     return { success: false, error };
//   }
// };

// /**
//  * Sends an OTP to the provided mobile number
//  * @param mobile The phone number to send OTP to
//  * @returns Error object if the operation fails
//  */
// export const signInWithOtp = async (mobile: string) => {
//   try {
//     console.log("Signing in with mobile: ", mobile);
//     const { data, error } = await supabase.auth.signInWithOtp({
//       phone: mobile,
//     });

//     if (error) {
//       console.error("OTP Error:", error);
//       return { success: false, error };
//     }

//     // Log success with response data
//     console.log("OTP request successful. Response:", data);
//     return { success: true, data };
//   } catch (error) {
//     console.error("OTP Error:", error);
//     return { message: "An unexpected error occurred" };
//   }
// };

// /**
//  * Verifies an OTP code for a mobile number
//  * @param mobile The phone number
//  * @param token The OTP code
//  * @param type The verification type (sms or phone_change)
//  * @returns Object with success flag and session/user data
//  */
// export const verifyOtp = async (
//   mobile: string,
//   token: string,
//   type: "sms" | "phone_change" = "sms"
// ) => {
//   try {
//     const { data, error } = await supabase.auth.verifyOtp({
//       phone: mobile,
//       token: token,
//       type: type,
//     });

//     if (error) {
//       console.error("Verification Error:", error);
//       return { success: false, error };
//     }

//     if (data.session === undefined) {
//       return { success: false, data };
//     }

//     return { success: true, data };
//   } catch (error) {
//     console.error("Verification Error:", error);
//     return { success: false, message: "An unexpected error occurred" };
//   }
// };

// /**
//  * Links a phone number to an already authenticated user
//  * @param phoneNumber The phone number to link
//  * @returns Object with success flag and data/error
//  */
// export const linkPhoneNumber = async (phoneNumber: string) => {
//   try {
//     const { data, error } = await supabase.auth.updateUser({
//       phone: phoneNumber,
//     });

//     if (error) {
//       console.error("Phone Linking Error:", error);
//       return { success: false, error };
//     }

//     return { success: true, data };
//   } catch (error) {
//     console.error("Phone Linking Error:", error);
//     return { success: false, message: "An unexpected error occurred" };
//   }
// };

// /**
//  * Gets the current user session
//  * @returns Current session or null
//  */
// export const getCurrentSession = async () => {
//   const { data, error } = await supabase.auth.getSession();

//   if (error) {
//     console.error("Get Session Error:", error);
//     return null;
//   }

//   return data?.session;
// };

// /**
//  * Signs out the current user
//  * @returns Success status and any error
//  */
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

// /**
//  * Checks if the user has completed the role selection
//  * @param userId the user's id
//  * @returns true if the user has completed the role selection, false otherwise
//  */
// export const checkRoleStatus = async (userId: string | undefined) => {
//   if (userId === undefined) return false;

//   try {
//     // Query profiles table in Supabase
//     const { data, error } = await supabase
//       .from("profiles")
//       .select("role")
//       .eq("id", userId)
//       .single();

//     if (error) {
//       console.error("Error checking role:", error);
//       return false;
//     }

//     // Check if role exists and is either 'host' or 'client'
//     return (
//       data &&
//       data?.role &&
//       (data?.role === UserType.HOST || data.role === UserType.CLIENT)
//     );
//   } catch (error) {
//     console.error("Error in role check:", error);
//     return false;
//   }
// };

// /**
//  * Checks if the user has completed profile setup
//  * @param userId the user's id
//  * @returns true if the user has completed profile setup, false otherwise
//  */
// export const checkProfileStatus = async (userId: string | undefined) => {
//   if (userId === undefined) return false;

//   try {
//     // Query your profile table in Supabase
//     const { data, error } = await supabase
//       .from("profiles")
//       .select("*")
//       .eq("id", userId)
//       .single();

//     if (error) {
//       console.error("Error checking profile:", error);
//       return false;
//     }

//     // Check if profile exists and has required fields
//     return data && data?.id && data?.username; // adjust based on your required fields
//   } catch (error) {
//     console.error("Error in profile check:", error);
//     return false;
//   }
// };

// /**
//  * Checks if the user has completed the assessment
//  * @param userId the user's id
//  * @returns true if the user has completed the assessment, false otherwise
//  */
// export const checkAssessmentStatus = async (userId: string | undefined) => {
//   if (userId === undefined) return false;

//   try {
//     // Query the profile table and value of assessment_completed
//     const profile = await supabase
//       .from("profiles")
//       .select("assessment_completed")
//       .eq("id", userId)
//       .single();

//     return profile?.data?.assessment_completed || false;
//   } catch (error) {
//     console.error("Error in assessment check:", error);
//     return false;
//   }
// };
