import { Pressable, StyleSheet } from 'react-native';
import { setAndroidNavigationBar } from '@/lib/android-navigation-bar';
import { MoonStar } from '@/lib/icons/MoonStar';
import { Sun } from '@/lib/icons/Sun';
import { useAppColorScheme, useThemeColors } from '@/lib/useColorScheme';

export function ThemeToggle() {
  const { isDarkColorScheme, setColorScheme } = useAppColorScheme();
  const colors = useThemeColors();

  async function toggleColorScheme() {
    const newTheme = isDarkColorScheme ? 'light' : 'dark';
    setColorScheme(newTheme);
    await setAndroidNavigationBar(newTheme);
  }

  return (
    <Pressable
      onPress={toggleColorScheme}
      style={[
        styles.button,
        { backgroundColor: colors.iconButton, borderColor: colors.iconButtonBorder },
      ]}
    >
      {isDarkColorScheme ? (
        <MoonStar size={17} strokeWidth={1.5} color={colors.text} />
      ) : (
        <Sun size={17} strokeWidth={1.5} color={colors.text} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
