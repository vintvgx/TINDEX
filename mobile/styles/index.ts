// Light theme — CollectPure look: warm light-gray canvas, white rounded cards,
// near-black text, black primary, light bottom tab.
export const lightTheme = {
  background: '#F4F4F2',
  surface: '#FFFFFF',
  surfaceSecondary: '#F0F0EE',
  surfaceTertiary: '#E7E7E4',
  text: '#111111',
  textSecondary: '#6B6B6B',
  textTertiary: '#A0A09C',
  accent: '#111111',
  accentForeground: '#FFFFFF',
  brand: '#111111',
  success: '#22A45D',
  successBg: 'rgba(34,164,93,0.12)',
  error: '#E5484D',
  errorBg: 'rgba(229,72,77,0.12)',
  warning: '#F5A623',
  warningBg: 'rgba(245,166,35,0.12)',
  border: '#E6E6E3',
  separator: 'rgba(0,0,0,0.07)',
  card: '#FFFFFF',
  cardBorder: 'rgba(0,0,0,0.05)',
  cardShadow: 'rgba(0,0,0,0.06)',
  // Header
  headerBg: '#F4F4F2',
  headerBorder: 'rgba(0,0,0,0.06)',
  // Ticker tape (always dark, on both themes)
  tape: '#0B0B0B',
  tapeText: '#EDEDED',
  tapeMuted: '#8A8A8A',
  tapeUp: '#34D17F',
  tapeDown: '#FF5A52',
  // Bottom tab (light in light mode)
  tabBar: '#FFFFFF',
  tabBarBorder: 'rgba(0,0,0,0.07)',
  tabBarActive: '#111111',
  tabBarInactive: '#A0A09C',
  iconButton: '#FFFFFF',
  iconButtonBorder: 'rgba(0,0,0,0.06)',
  unread: '#111111',
  badge: '#E5484D',
};

export const darkTheme = {
  background: '#000000',
  surface: '#1C1C1E',
  surfaceSecondary: '#2C2C2E',
  surfaceTertiary: '#3A3A3C',
  text: '#FFFFFF',
  textSecondary: '#8A8A8E',
  textTertiary: '#636366',
  accent: '#FFFFFF',
  accentForeground: '#111111',
  brand: '#FFFFFF',
  success: '#30D158',
  successBg: 'rgba(48,209,88,0.15)',
  error: '#FF453A',
  errorBg: 'rgba(255,69,58,0.15)',
  warning: '#FF9F0A',
  warningBg: 'rgba(255,159,10,0.15)',
  border: '#38383A',
  separator: 'rgba(255,255,255,0.08)',
  card: '#1C1C1E',
  cardBorder: 'rgba(255,255,255,0.06)',
  cardShadow: 'rgba(0,0,0,0.4)',
  // Header
  headerBg: '#000000',
  headerBorder: 'rgba(255,255,255,0.08)',
  // Ticker tape (always dark, on both themes)
  tape: '#0B0B0B',
  tapeText: '#EDEDED',
  tapeMuted: '#8A8A8A',
  tapeUp: '#34D17F',
  tapeDown: '#FF5A52',
  tabBar: '#1C1C1E',
  tabBarBorder: 'rgba(255,255,255,0.08)',
  tabBarActive: '#FFFFFF',
  tabBarInactive: '#636366',
  iconButton: '#2C2C2E',
  iconButtonBorder: 'rgba(255,255,255,0.06)',
  unread: '#0A84FF',
  badge: '#FF453A',
};

export type Theme = typeof lightTheme;

export const typography = {
  displayTitle: { fontSize: 36, fontWeight: '800' as const, letterSpacing: -0.5 },
  pageTitle: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  sectionTitle: { fontSize: 20, fontWeight: '700' as const },
  title: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: '400' as const },
  small: { fontSize: 11, fontWeight: '500' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 100,
};

// Legacy color exports for backward compat
export const colors = {
  primary: '#007AFF',
  primaryDark: '#0051D5',
  secondary: '#5856D6',
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  background: '#FFFFFF',
  backgroundSecondary: '#F5F5F7',
  surface: '#FFFFFF',
  text: '#000000',
  textSecondary: '#6B6B6B',
  textLight: '#AEAEB2',
  border: '#E5E5EA',
  borderLight: '#F5F5F7',
  gradientStart: '#007AFF',
  gradientEnd: '#5856D6',
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};
