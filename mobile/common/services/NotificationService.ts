// services/supabaseNotificationService.ts
import { supabase } from "@/lib/supabase/supabase";
import { Alert } from "react-native";
import { getUserProfile } from "../utils/auth/function";
import { NotificationPreferences } from "../types/notifications/notificationModel";

export class NotificationService {
  /**
   * Save or update the user's expo push token in Supabase
   */
  static async saveExpoPushToken(userId: string, token: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .upsert({
          id: userId,
          expo_push_token: token,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'id'
        });

      if (error) {
        console.error('Error saving expo push token:', error);
        Alert.alert('Error saving expo push token')
        throw error;
      }

      console.log('Expo push token saved successfully');
      Alert.alert('Expo push token saved successfully')
    } catch (error) {
      console.error('Failed to save expo push token:', error);
      throw error;
    }
  }

  /**
   * Update notification preferences
   * TODO fix and check
   */
  static async updateNotificationPreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<void> {
    try {
      // First get current preferences
      const profile = await getUserProfile(userId);
      
      if (!profile) {
        throw new Error('User profile not found');
      }

      // Merge with existing preferences
      const updatedPreferences = {
        ...profile.notification_preferences,
        ...preferences,
      };

      const { error } = await supabase
        .from('user_profiles')
        .update({
          notification_preferences: updatedPreferences,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) {
        console.error('Error updating notification preferences:', error);
        throw error;
      }

      console.log('Notification preferences updated successfully');
    } catch (error) {
      console.error('Failed to update notification preferences:', error);
      throw error;
    }
  }

  /**
   * Get notification preferences for a user
   * TODO will be included within user profile / this can be removed
   */
  static async getNotificationPreferences(userId: string): Promise<NotificationPreferences | null> {
    try {
      const profile = await getUserProfile(userId);
      return profile?.notification_preferences || null;
    } catch (error) {
      console.error('Failed to fetch notification preferences:', error);
      return null;
    }
  }

  /**
   * Remove expo push token (e.g., on logout)
   */
  static async removeExpoPushToken(userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          expo_push_token: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) {
        console.error('Error removing expo push token:', error);
        throw error;
      }

      console.log('Expo push token removed successfully');
    } catch (error) {
      console.error('Failed to remove expo push token:', error);
      throw error;
    }
  }

  /**
   * Check if user has notifications enabled
   */
  static async isNotificationsEnabled(userId: string): Promise<boolean> {
    try {
      const preferences = await this.getNotificationPreferences(userId);
      return preferences?.enabled ?? true;
    } catch (error) {
      console.error('Failed to check notification status:', error);
      return false;
    }
  }
}