import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme as useNativewindColorScheme } from 'nativewind';
import { lightTheme, darkTheme, Theme } from '@/styles/index';

const ThemeContext = createContext<Theme>(darkTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme } = useNativewindColorScheme();
  // Only recomputes when colorScheme actually changes (rare)
  const theme = useMemo(
    () => (colorScheme === 'light' ? lightTheme : darkTheme),
    [colorScheme]
  );
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

// All components use this — a simple useContext() read, not a new hook subscription
export function useThemeColors(): Theme {
  return useContext(ThemeContext);
}
