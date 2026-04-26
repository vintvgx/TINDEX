import { signInWithApple, signInWithGoogle } from '@/common/utils/auth/function';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lightTheme, darkTheme } from '@/styles/index';

export default function AuthScreen() {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? darkTheme : lightTheme;

  const handleAppleSignIn = async () => {
    try { await signInWithApple(); } catch (error) { console.error('Apple sign in error:', error); }
  };

  const handleGoogleSignIn = async () => {
    try { await signInWithGoogle(); } catch (error) { console.error('Google sign in error:', error); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={{ flex: 1, justifyContent: 'space-between', paddingHorizontal: 32 }}>
        {/* Top: branding */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          {/* Logo mark */}
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              backgroundColor: colors.accent + '18',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 28,
              borderWidth: 1.5,
              borderColor: colors.accent + '30',
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: colors.accent,
              }}
            />
          </View>

          <Text
            style={{
              color: colors.text,
              fontSize: 42,
              fontWeight: '800',
              letterSpacing: -1,
              textAlign: 'center',
              marginBottom: 10,
            }}
          >
            TINDEX
          </Text>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 16,
              fontWeight: '400',
              textAlign: 'center',
              lineHeight: 24,
            }}
          >
            Market Intelligence,{'\n'}Simplified.
          </Text>
        </View>

        {/* Bottom: sign-in buttons */}
        <View style={{ paddingBottom: 16, gap: 12 }}>
          {/* Apple */}
          <TouchableOpacity
            onPress={handleAppleSignIn}
            activeOpacity={0.85}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: scheme === 'dark' ? '#FFFFFF' : '#000000',
              borderRadius: 16,
              paddingVertical: 16,
              gap: 10,
            }}
          >
            <Ionicons name="logo-apple" size={20} color={scheme === 'dark' ? '#000000' : '#FFFFFF'} />
            <Text
              style={{
                color: scheme === 'dark' ? '#000000' : '#FFFFFF',
                fontSize: 16,
                fontWeight: '600',
              }}
            >
              Continue with Apple
            </Text>
          </TouchableOpacity>

          {/* Google */}
          <TouchableOpacity
            onPress={handleGoogleSignIn}
            activeOpacity={0.85}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
              borderRadius: 16,
              paddingVertical: 16,
              gap: 10,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="logo-google" size={20} color="#4285F4" />
            <Text
              style={{
                color: colors.text,
                fontSize: 16,
                fontWeight: '600',
              }}
            >
              Continue with Google
            </Text>
          </TouchableOpacity>

          {/* Terms */}
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 12,
              textAlign: 'center',
              lineHeight: 18,
              marginTop: 4,
              marginBottom: 8,
            }}
          >
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
