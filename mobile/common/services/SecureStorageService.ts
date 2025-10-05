// services/secureStorageService.ts
import * as SecureStore from 'expo-secure-store';

const EXPO_PUSH_TOKEN_KEY = 'expo_push_token';

export class SecureStorageService {
  /**
   * Save expo push token to secure storage
   */
  static async saveExpoPushToken(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(EXPO_PUSH_TOKEN_KEY, token);
      console.log('Expo push token saved to secure storage');
    } catch (error) {
      console.error('Error saving expo push token to secure storage:', error);
      throw error;
    }
  }

  /**
   * Get expo push token from secure storage
   */
  static async getExpoPushToken(): Promise<string | null> {
    try {
      const token = await SecureStore.getItemAsync(EXPO_PUSH_TOKEN_KEY);
      return token;
    } catch (error) {
      console.error('Error getting expo push token from secure storage:', error);
      return null;
    }
  }

  /**
   * Remove expo push token from secure storage
   */
  static async removeExpoPushToken(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(EXPO_PUSH_TOKEN_KEY);
      console.log('Expo push token removed from secure storage');
    } catch (error) {
      console.error('Error removing expo push token from secure storage:', error);
      throw error;
    }
  }

  /**
   * Check if expo push token exists in secure storage
   */
  static async hasExpoPushToken(): Promise<boolean> {
    try {
      const token = await this.getExpoPushToken();
      return token !== null;
    } catch (error) {
      console.error('Error checking expo push token in secure storage:', error);
      return false;
    }
  }
}