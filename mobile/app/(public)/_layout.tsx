/**
 * Layout for (public) directory
 */
import { Stack } from 'expo-router';

export default function PublicLayout() {

  return (
    <Stack screenOptions={{
      headerShown: false,
      animation: 'fade',
    }} />
  );
}