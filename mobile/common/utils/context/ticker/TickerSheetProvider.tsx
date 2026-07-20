import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { View, Modal, Animated, Dimensions, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '@/lib/useColorScheme';
import TickerSheetService from '@/common/services/TickerSheetService';
import { TickerDetailSheet } from '@/common/components/ticker/TickerDetailSheet';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * Global host for the ticker detail bottom sheet.
 *
 * Mounted once at the app root (see app/_layout.tsx). Subscribes to
 * TickerSheetService so that any code — including plain-JS singletons like
 * NavigationService that can't call React state setters directly — can open
 * the ticker sheet from anywhere by calling TickerSheetService.open(ticker).
 *
 * Mirrors the existing hand-rolled Modal + Animated slide-up pattern used by
 * SearchBottomSheet.tsx rather than introducing @gorhom/bottom-sheet (present
 * in package.json but unused elsewhere in the app).
 */
export const TickerSheetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const colors = useThemeColors();
  const [ticker, setTicker] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    return TickerSheetService.getInstance().subscribe((activeTicker) => {
      if (activeTicker) {
        setTicker(activeTicker);
        setVisible(true);
      } else {
        handleClose();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        damping: 30,
        stiffness: 240,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  const handleClose = () => {
    Animated.timing(slideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
      setTicker(null);
    });
  };

  return (
    <>
      {children}
      <Modal transparent animationType="none" visible={visible} onRequestClose={handleClose} statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <SafeAreaView style={{ flex: 1 }} edges={['left', 'right', 'bottom']}>
            <View style={[styles.handle, { backgroundColor: colors.textTertiary }]} />
            {ticker && <TickerDetailSheet ticker={ticker} onClose={handleClose} />}
          </SafeAreaView>
        </Animated.View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SCREEN_HEIGHT * 0.94,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
});
