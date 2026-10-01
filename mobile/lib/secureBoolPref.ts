import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * On/off preferences stored in SecureStore as '1' / '0'. Chart prefs used
 * to live in AsyncStorage under the same keys: the first load after the
 * switch copies a saved AsyncStorage value into SecureStore and deletes the
 * old one, so nobody's setting resets.
 */
export async function loadSecureBoolPref(key: string, defaultValue: boolean): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (raw !== null) return raw === '1';
  } catch {
    return defaultValue;
  }
  try {
    const legacy = await AsyncStorage.getItem(key);
    if (legacy === null) return defaultValue;
    await SecureStore.setItemAsync(key, legacy);
    await AsyncStorage.removeItem(key);
    return legacy === '1';
  } catch {
    return defaultValue;
  }
}

/** Best-effort write — callers mirror the value in their query cache first. */
export async function saveSecureBoolPref(key: string, value: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value ? '1' : '0');
  } catch {
    // The query cache already reflects the change for this session.
  }
}
