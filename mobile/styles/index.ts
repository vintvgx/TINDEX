// Light theme — Astor-inspired warm eggshell canvas (not stark white): cards
// sit a shade lighter than the background instead of pure #FFFFFF floating on
// an almost-identical off-white, so the layering actually reads. Near-black
// (not pure #000) text keeps contrast without the harshness of true black.
export const lightTheme = {
  isDark: false,
  background: '#F2F1EC',
  surface: '#FAF9F5',
  surfaceSecondary: '#ECEAE3',
  surfaceTertiary: '#E3E1D8',
  text: '#1C1B18',
  textSecondary: '#68665D',
  textTertiary: '#9B998E',
  accent: '#1C1B18',
  accentForeground: '#FAF9F5',
  brand: '#1C1B18',
  success: '#22A45D',
  successBg: 'rgba(34,164,93,0.12)',
  error: '#E5484D',
  errorBg: 'rgba(229,72,77,0.12)',
  warning: '#F5A623',
  warningBg: 'rgba(245,166,35,0.12)',
  border: '#E0DED4',
  separator: 'rgba(28,27,24,0.08)',
  card: '#FAF9F5',
  cardBorder: 'rgba(28,27,24,0.07)',
  cardShadow: 'rgba(28,27,24,0.06)',
  // Header
  headerBg: '#F2F1EC',
  headerBorder: 'rgba(28,27,24,0.06)',
  // Ticker tape (always dark, on both themes)
  tape: '#0B0B0B',
  tapeText: '#EDEDED',
  tapeMuted: '#8A8A8A',
  tapeUp: '#34D17F',
  tapeDown: '#FF5A52',
  // Bottom tab (light in light mode)
  tabBar: '#FAF9F5',
  tabBarBorder: 'rgba(28,27,24,0.07)',
  tabBarActive: '#1C1B18',
  tabBarInactive: '#9B998E',
  iconButton: '#FAF9F5',
  iconButtonBorder: 'rgba(28,27,24,0.06)',
  unread: '#1C1B18',
  badge: '#E5484D',
};

// Dark theme — Astor-inspired near-black navy (not true #000): cards sit a
// shade lighter for the same reason as light mode, and text/accent are a soft
// off-white instead of pure #FFFFFF, which reads noticeably harsher on an
// OLED-black background.
export const darkTheme = {
  isDark: true,
  background: '#0A0B0F',
  surface: '#16171D',
  surfaceSecondary: '#1E2028',
  surfaceTertiary: '#282A34',
  text: '#F2F2F0',
  textSecondary: '#9496A3',
  textTertiary: '#66687A',
  accent: '#F2F2F0',
  accentForeground: '#16171D',
  brand: '#F2F2F0',
  success: '#30D158',
  successBg: 'rgba(48,209,88,0.15)',
  error: '#FF453A',
  errorBg: 'rgba(255,69,58,0.15)',
  warning: '#FF9F0A',
  warningBg: 'rgba(255,159,10,0.15)',
  border: '#2B2D38',
  separator: 'rgba(242,242,240,0.08)',
  card: '#16171D',
  cardBorder: 'rgba(242,242,240,0.07)',
  cardShadow: 'rgba(0,0,0,0.45)',
  // Header
  headerBg: '#0A0B0F',
  headerBorder: 'rgba(242,242,240,0.08)',
  // Ticker tape (always dark, on both themes)
  tape: '#0B0B0B',
  tapeText: '#EDEDED',
  tapeMuted: '#8A8A8A',
  tapeUp: '#34D17F',
  tapeDown: '#FF5A52',
  tabBar: '#16171D',
  tabBarBorder: 'rgba(242,242,240,0.08)',
  tabBarActive: '#F2F2F0',
  tabBarInactive: '#66687A',
  iconButton: '#1E2028',
  iconButtonBorder: 'rgba(242,242,240,0.06)',
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
