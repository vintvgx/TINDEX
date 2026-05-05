import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import { Animated, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAppColorScheme } from '@/lib/useColorScheme';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  translateY: Animated.Value;
  opacity: Animated.Value;
}

export interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DISPLAY_MS = 3500;
const ENTER_MS = 300;
const EXIT_MS = 220;

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface VariantConfig {
  tint: string;
  border: string;
  icon: string;
  iconName: IconName;
}

function useVariantConfig(colors: ReturnType<typeof useThemeColors>) {
  return useCallback((variant: ToastVariant): VariantConfig => {
    switch (variant) {
      case 'success':
        return { tint: colors.success + '28', border: colors.success, icon: colors.success, iconName: 'checkmark-circle' };
      case 'error':
        return { tint: colors.error + '28', border: colors.error, icon: colors.error, iconName: 'alert-circle' };
      case 'warning':
        return { tint: colors.warning + '28', border: colors.warning, icon: colors.warning, iconName: 'warning' };
      case 'info':
        return { tint: colors.accent + '28', border: colors.accent, icon: colors.accent, iconName: 'information-circle' };
    }
  }, [colors]);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const colors = useThemeColors();
  const { isDarkColorScheme } = useAppColorScheme();
  const counter = useRef(0);
  const getVariantConfig = useVariantConfig(colors);

  const dismiss = useCallback((id: string, opacity: Animated.Value, translateY: Animated.Value) => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: EXIT_MS, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -12, duration: EXIT_MS, useNativeDriver: true }),
    ]).start(() => setToasts(prev => prev.filter(t => t.id !== id)));
  }, []);

  const show = useCallback((message: string, variant: ToastVariant) => {
    const id = `t${++counter.current}`;
    const translateY = new Animated.Value(-14);
    const opacity = new Animated.Value(0);

    setToasts(prev => [...prev, { id, message, variant, translateY, opacity }]);

    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 130, friction: 9 }),
      Animated.timing(opacity, { toValue: 1, duration: ENTER_MS, useNativeDriver: true }),
    ]).start();

    setTimeout(() => dismiss(id, opacity, translateY), DISPLAY_MS);
  }, [dismiss]);

  const api = useMemo<ToastContextValue>(() => ({
    success: (msg) => show(msg, 'success'),
    error:   (msg) => show(msg, 'error'),
    warning: (msg) => show(msg, 'warning'),
    info:    (msg) => show(msg, 'info'),
  }), [show]);

  const blurTint = isDarkColorScheme ? 'dark' : 'light';

  return (
    <ToastContext.Provider value={api}>
      {children}
      <View style={styles.container} pointerEvents="box-none">
        {toasts.map(toast => {
          const vc = getVariantConfig(toast.variant);
          return (
            <Animated.View
              key={toast.id}
              style={[
                styles.toastOuter,
                {
                  borderColor: vc.border + '55',
                  shadowColor: vc.border,
                  transform: [{ translateY: toast.translateY }],
                  opacity: toast.opacity,
                },
              ]}
            >
              {/* Frosted-glass base */}
              <BlurView tint={blurTint} intensity={90} style={StyleSheet.absoluteFill} />
              {/* Variant colour tint over the blur */}
              <View style={[StyleSheet.absoluteFill, { backgroundColor: vc.tint }]} />
              {/* Content */}
              <View style={styles.toastContent}>
                <Ionicons name={vc.iconName} size={20} color={vc.icon} />
                <Text style={[styles.message, { color: colors.text }]} numberOfLines={3}>
                  {toast.message}
                </Text>
                <TouchableOpacity
                  onPress={() => dismiss(toast.id, toast.opacity, toast.translateY)}
                  hitSlop={10}
                >
                  <Ionicons name="close" size={15} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </Animated.View>
          );
        })}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 62 : 44,
    left: 14,
    right: 14,
    zIndex: 9999,
    gap: 8,
    pointerEvents: 'box-none',
  } as any,
  toastOuter: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 10,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 10,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});
