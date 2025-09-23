import { Stack } from 'expo-router';

export default function TickerLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Add slide animation for ticker screens
        // animation: 'slide_from_right',
        // animationDuration: 300,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
      }}
    >
      <Stack.Screen 
        name="[ticker]" 
        options={{
          title: 'Ticker Details',
          // Ensure full screen without tab bar
          presentation: 'card',
        }}
      />
    </Stack>
  );
} 