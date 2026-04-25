import { useColorScheme as useNativewindColorScheme } from 'nativewind';

// useAppColorScheme: only used by ThemeToggle and ThemeProvider — keep it isolated
export function useAppColorScheme() {
  const { colorScheme, setColorScheme, toggleColorScheme } = useNativewindColorScheme();
  return {
    colorScheme: colorScheme ?? 'dark',
    isDarkColorScheme: colorScheme === 'dark',
    setColorScheme,
    toggleColorScheme,
  };
}

// Re-export from ThemeContext so all imports stay consistent
export { useThemeColors } from '@/lib/ThemeContext';
