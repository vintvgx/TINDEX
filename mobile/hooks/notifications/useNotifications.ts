/**
 * Custom hook for managing push notifications in the mobile app.
 * 
 * This hook handles:
 * - Expo push token registration and caching
 * - Notification permission requests
 * - Setting up notification listeners
 * - Scheduling and sending notifications
 * - Token cleanup on logout
 * 
 * @fileoverview Centralized notification management hook
 * @author vintvgx
 * @version 1.0.0
 */

import { useState, useEffect, useRef, useCallback } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { useAuth } from "@/common/utils/context/auth/AuthContext";
import { SecureStorageService } from "@/common/services/SecureStorageService";
import { NotificationService } from "@/common/services/NotificationService";
import { SchedulableTriggerInputTypes } from "expo-notifications";

/**
 * Interface for notification content data.
 * 
 * @interface NotificationData
 * @property {string} title - The notification title displayed to the user
 * @property {string} body - The notification body/message content
 * @property {Record<string, any>} [data] - Optional additional data payload for the notification
 */
export interface NotificationData {
  title: string;
  body: string;
  data?: Record<string, any>;
}

/**
 * Custom hook for managing push notifications throughout the application.
 * 
 * Provides functionality for:
 * - Automatic token registration and caching
 * - Notification permission handling
 * - Event listener management
 * - Notification scheduling and sending
 * - Cleanup and token management
 * 
 * @returns {Object} Notification management object containing state and methods
 * @returns {string|undefined} returns.expoPushToken - Current Expo push token for the device
 * @returns {Notifications.Notification|undefined} returns.notification - Latest received notification
 * @returns {boolean} returns.isRegistering - Loading state during token registration
 * @returns {Function} returns.schedulePushNotification - Method to schedule future notifications
 * @returns {Function} returns.sendImmediateNotification - Method to send immediate notifications
 * @returns {Function} returns.clearNotificationToken - Method to clear stored notification token
 */
export function useNotifications() {
  // Authentication state for user verification
  const { authState } = useAuth();

  // Expo push token state - used to identify device for remote notifications
  const [expoPushToken, setExpoPushToken] = useState<string | undefined>();

  // Latest notification received state - for handling foreground notifications
  const [notification, setNotification] = useState<
    Notifications.Notification | undefined
  >();
  
  // Registration loading state - indicates if token registration is in progress
  const [isRegistering, setIsRegistering] = useState(false);

  // Refs to store notification event listeners for proper cleanup
  const notificationListener =
    useRef<Notifications.EventSubscription>(undefined);
  const responseListener = useRef<Notifications.EventSubscription>(undefined);

  /**
   * Initializes the notification system for the authenticated user.
   * 
   * This function:
   * - Retrieves cached push token if available
   * - Registers for push notifications and obtains new token
   * - Saves token to Supabase and secure storage
   * - Sets up notification event listeners
   * 
   * @async
   * @function initializeNotifications
   * @returns {Promise<void>} Promise that resolves when initialization is complete
   * @throws {Error} Throws error if initialization fails
   */
  const initializeNotifications = useCallback(async (): Promise<void> => {
    try {
      console.log("Initializing notifications")
      setIsRegistering(true);

      // Check if there is a cached token for faster initialization
      const cachedToken = await SecureStorageService.getExpoPushToken();

      // NOTE: Sets cached token immediately
      if (cachedToken) {
        console.log("Using cached expo push token");
        setExpoPushToken(cachedToken);
      } else {
        console.log("No cached token found. Registering for token.")
      }

      // Register for push notifications and get new token
      // NOTE: Validates token by confirming the token with Expo's service 
      const token = await registerForPushNotificationsAsync();

      if (token && authState.user?.id) {
        // Update state with new token
        setExpoPushToken(token);

        // Only save to Supabase and SecureStore if token changed to avoid unnecessary API calls
        if (token !== cachedToken) {
          // Save to Supabase for server-side notification sending
          await NotificationService.saveExpoPushToken(authState.user.id, token);

          // Save to secure storage for faster retrieval on next app launch
          await SecureStorageService.saveExpoPushToken(token);

          console.log("New expo push token saved");
        }
      }

      // Set up notification listeners for handling received notifications
      notificationListener.current =
        Notifications.addNotificationReceivedListener((notification) => {
          console.log("Notification received:", notification);
          setNotification(notification);
        });

      // Set up response listener for handling user interaction with notifications
      responseListener.current =
        Notifications.addNotificationResponseReceivedListener((response) => {
          console.log("Notification response:", response);
        });
    } catch (error) {
      console.error("Error initializing notifications:", error);
    } finally {
      setIsRegistering(false);
    }
  }, [authState.user?.id]);

  /**
   * Effect hook that manages notification setup and cleanup based on authentication state.
   * 
   * This effect:
   * - Initializes notifications when user is authenticated
   * - Clears token and listeners when user logs out
   * - Performs cleanup to prevent memory leaks
   * 
   * @effect
   * @dependencies authState.isAuthenticated, authState.user?.id, initializeNotifications
   */
  useEffect(() => {
    if (authState.isAuthenticated && authState.user?.id) {
      initializeNotifications();
    } else {
      console.log("User currently not authenticated. No push token retrieved/saved.")
      // Clear token on logout to prevent unauthorized notifications
      setExpoPushToken(undefined);

    }

    /**
     * Cleanup function that removes notification listeners to prevent memory leaks.
     * Runs when:
     * - Component unmounts
     * - Dependencies change (before effect re-runs)
     * - User logs out
     */
    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
        // Alternative cleanup method (commented for reference):
        // Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        responseListener.current.remove();
        // Alternative cleanup method (commented for reference):
        // Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [authState.isAuthenticated, authState.user?.id, initializeNotifications]);

  /**
   * Schedules a recurring weekly notification at specified time.
   * 
   * Creates a notification that will be triggered weekly on the specified day and time.
   * Useful for recurring reminders, market updates, or weekly summaries.
   * 
   * @async
   * @function schedulePushNotification
   * @param {NotificationData} notificationData - The notification content including title, body, and optional data
   * @param {SchedulableTriggerInputTypes} triggerInput - The trigger type (currently supports WEEKLY)
   * @param {number} [weekday=6] - Day of the week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
   * @param {number} [hour=8] - Hour of the day in 24-hour format (0-23)
   * @param {number} [minute=0] - Minute of the hour (0-59)
   * @param {number} [seconds=2] - Seconds (currently unused, kept for API consistency)
   * @returns {Promise<void>} Promise that resolves when notification is scheduled
   * @throws {Error} Throws error if scheduling fails
   * 
   * @example
   * ```typescript
   * await schedulePushNotification(
   *   { title: "Weekly Market Update", body: "Check your portfolio performance" },
   *   SchedulableTriggerInputTypes.WEEKLY,
   *   1, // Monday
   *   9, // 9 AM
   *   0  // 0 minutes
   * );
   * ```
   */
  const schedulePushNotification = async (
    notificationData: NotificationData,
    triggerInput: SchedulableTriggerInputTypes | SchedulableTriggerInputTypes.WEEKLY,
    weekday: number = 6,
    hour: number = 8,
    minute: number = 0,
    seconds: number = 2
  ): Promise<void> => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: notificationData.title,
          body: notificationData.body,
          data: notificationData.data,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: weekday,
          hour: hour,
          minute: minute
        },
      });
    } catch (error) {
      console.error("Error scheduling notification:", error);
      throw error;
    }
  };

  /**
   * Sends an immediate notification to the user's device.
   * 
   * This function triggers a notification that appears immediately on the device.
   * Useful for real-time alerts, urgent messages, or instant feedback.
   * 
   * @async
   * @function sendImmediateNotification
   * @param {NotificationData} notificationData - The notification content including title, body, and optional data payload
   * @returns {Promise<void>} Promise that resolves when notification is sent
   * @throws {Error} Throws error if notification sending fails
   * 
   * @example
   * ```typescript
   * await sendImmediateNotification({
   *   title: "Price Alert",
   *   body: "AAPL has reached your target price of $150",
   *   data: { ticker: "AAPL", price: 150.25 }
   * });
   * ```
   */
  const sendImmediateNotification = async (
    notificationData: NotificationData
  ): Promise<void> => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: notificationData.title,
          body: notificationData.body,
          data: notificationData.data,
          sound: true,
        },
        trigger: null, // null trigger means immediate delivery
      });
    } catch (error) {
      console.error("Error sending notification:", error);
      throw error;
    }
  };

  /**
   * Clears the stored notification token from all storage locations.
   * 
   * This function removes the Expo push token from:
   * - Supabase database (server-side)
   * - Secure storage (local device)
   * - Component state
   * 
   * Used during logout or when user wants to disable notifications.
   * 
   * @async
   * @function clearNotificationToken
   * @returns {Promise<void>} Promise that resolves when token is cleared from all locations
   * @throws {Error} Throws error if clearing fails (logged but not re-thrown)
   */
  const clearNotificationToken = async (): Promise<void> => {
    try {
      // Remove from Supabase if user is authenticated
      if (authState.user?.id) {
        await NotificationService.removeExpoPushToken(authState.user.id);
      }
      
      // Remove from secure storage
      await SecureStorageService.removeExpoPushToken();
      
      // Clear from component state
      setExpoPushToken(undefined);
      
      console.log("Notification token cleared");
    } catch (error) {
      console.error("Error clearing notification token:", error);
      // Note: Error is logged but not re-thrown to prevent breaking the logout flow
    }
  };

  /**
   * Returns the notification management interface with state and methods.
   * 
   * @returns {Object} Object containing notification state and management methods
   */
  return {
    expoPushToken,
    notification,
    isRegistering,
    schedulePushNotification,
    sendImmediateNotification,
    clearNotificationToken,
  };
}

/**
 * Registers the device to receive push notifications and obtains the Expo push token.
 * 
 * This function:
 * - Sets up Android notification channel (Android only)
 * - Requests notification permissions from the user
 * - Obtains the Expo push token for the device
 * - Handles permission denial and simulator restrictions
 * 
 * @async
 * @function registerForPushNotificationsAsync
 * @returns {Promise<string|undefined>} Promise that resolves to the Expo push token or undefined if registration fails
 * 
 * @throws {Error} Throws error if token generation fails
 * 
 * @example
 * ```typescript
 * const token = await registerForPushNotificationsAsync();
 * if (token) {
 *   console.log("Device registered for notifications:", token);
 * } else {
 *   console.log("Failed to register for notifications");
 * }
 * ```
 */
async function registerForPushNotificationsAsync(): Promise<string | undefined> {
  let token: string | undefined;

  // Configure Android notification channel with custom settings
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  // Only proceed if running on a physical device
  if (Device.isDevice) {
    // Check existing notification permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not already granted
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    } 

    // Exit early if permissions are denied
    if (finalStatus !== "granted") {
      console.warn("Failed to get push token for push notification!");
      return undefined;
    }

    try {
      // Obtain Expo push token using EAS project configuration
      token = (
        await Notifications.getExpoPushTokenAsync({
          projectId: Constants.expoConfig?.extra?.eas?.projectId,
        })
      ).data;

      console.log("Expo push token obtained:", token);
    } catch (error) {
      console.error("Error getting expo push token:", error);
      return undefined;
    }
  } else {
    console.warn("Must use physical device for Push Notifications");
    return undefined;
  }

  return token;
}
