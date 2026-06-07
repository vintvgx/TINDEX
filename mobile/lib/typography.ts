/**
 * Typography — Space Grotesk type system.
 *
 * The app ships five static weights of Space Grotesk (Light→Bold). Because React
 * Native does not reliably synthesize weight from `fontWeight` when a custom font
 * family is set, each weight is its own family. `familyForWeight()` maps any
 * `fontWeight` value an existing component already uses onto the correct file, so
 * the global font default (see `applyGlobalFont`) keeps every `<Text>` looking
 * right without touching call sites.
 */

export const FONT_FAMILY = {
  light: 'SpaceGrotesk-Light',
  regular: 'SpaceGrotesk-Regular',
  medium: 'SpaceGrotesk-Medium',
  semibold: 'SpaceGrotesk-SemiBold',
  bold: 'SpaceGrotesk-Bold',
} as const;

/** expo-font asset map — consumed by `useFonts` in the root layout. */
export const FONT_ASSETS = {
  'SpaceGrotesk-Light': require('../assets/fonts/SpaceGrotesk-Light.ttf'),
  'SpaceGrotesk-Regular': require('../assets/fonts/SpaceGrotesk-Regular.ttf'),
  'SpaceGrotesk-Medium': require('../assets/fonts/SpaceGrotesk-Medium.ttf'),
  'SpaceGrotesk-SemiBold': require('../assets/fonts/SpaceGrotesk-SemiBold.ttf'),
  'SpaceGrotesk-Bold': require('../assets/fonts/SpaceGrotesk-Bold.ttf'),
};

/** Resolve a React Native `fontWeight` to the matching Space Grotesk family. */
export function familyForWeight(weight?: string | number | null): string {
  let w: number;
  if (weight == null) {
    w = 400;
  } else if (typeof weight === 'number') {
    w = weight;
  } else if (weight === 'bold') {
    w = 700;
  } else if (weight === 'normal') {
    w = 400;
  } else {
    w = parseInt(weight, 10) || 400;
  }

  if (w >= 700) return FONT_FAMILY.bold;
  if (w >= 600) return FONT_FAMILY.semibold;
  if (w >= 500) return FONT_FAMILY.medium;
  if (w <= 300) return FONT_FAMILY.light;
  return FONT_FAMILY.regular;
}
