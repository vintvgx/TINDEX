import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import { useThemeColors } from '@/lib/useColorScheme';

const ROW_HEIGHT = 44;
// Odd so exactly one row's slot sits at the panel's vertical center.
const VISIBLE_ROWS = 7;
const PAD_ROWS = Math.floor(VISIBLE_ROWS / 2);
// Auto-dismiss if the user opens the picker and then doesn't touch it —
// resets on every scroll/tap so it only fires after real inactivity, not a
// fixed 2s from open regardless of what the user's doing.
const AUTO_DISMISS_MS = 1000;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Ordering is the caller's responsibility (charts.tsx puts open-position
   *  tickers first) — this component just displays what it's given. */
  tickers: string[];
  activeTicker: string;
  /** Tickers with an open position — shown with a green dot. */
  openPositionTickers?: string[];
  /** Called continuously as the centered row changes while scrolling (live
   *  preview), and again on tap-to-select — matches the TradingView picker
   *  this is modeled on, which updates the chart as you scroll rather than
   *  waiting for an explicit confirm tap. */
  onSelect: (ticker: string) => void;
}

/**
 * TradingView-style ticker picker — a centered, scrollable wheel overlaid
 * on the chart. Long-press the active ticker (see charts.tsx) to open it;
 * drag through the list or tap a row directly, backdrop tap to dismiss.
 * The vertically-centered row is the live selection, shown larger/brighter
 * than the rest, same visual language as the reference screenshots.
 */
export const TickerPickerOverlay: React.FC<Props> = ({
  visible, onClose, tickers, activeTicker, openPositionTickers, onSelect,
}) => {
  const colors = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
  const [centeredIndex, setCenteredIndex] = useState(() => Math.max(0, tickers.indexOf(activeTicker)));

  // Ref (not the prop directly) so the setTimeout callback always calls
  // whatever onClose is current at fire time, without needing to recreate
  // the timer/effect every time the parent passes a fresh inline function.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => onCloseRef.current(), AUTO_DISMISS_MS);
  }, []);

  // Arm the timer when the picker opens; disarm it when it closes (however
  // that happened — backdrop tap, the timer itself, or the parent closing
  // it directly) so it can never fire again after unmount/hide.
  useEffect(() => {
    if (visible) {
      resetDismissTimer();
    } else if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [visible, resetDismissTimer]);

  const commitIndex = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(tickers.length - 1, idx));
    setCenteredIndex(clamped);
    onSelect(tickers[clamped]);
  }, [tickers, onSelect]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    resetDismissTimer();
    const idx = Math.round(e.nativeEvent.contentOffset.y / ROW_HEIGHT);
    const clamped = Math.max(0, Math.min(tickers.length - 1, idx));
    if (clamped !== centeredIndex) commitIndex(clamped);
  }, [tickers.length, centeredIndex, commitIndex, resetDismissTimer]);

  const scrollToIndex = useCallback((idx: number) => {
    resetDismissTimer();
    scrollRef.current?.scrollTo({ y: idx * ROW_HEIGHT, animated: true });
    commitIndex(idx);
  }, [commitIndex, resetDismissTimer]);

  // Re-center on whatever the caller says is active each time the picker
  // opens (e.g. reopening after a swipe-cycled ticker change elsewhere).
  const prevVisible = useRef(visible);
  if (visible && !prevVisible.current) {
    const idx = Math.max(0, tickers.indexOf(activeTicker));
    setCenteredIndex(idx);
  }
  prevVisible.current = visible;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => {}}
          style={{
            width: 230,
            height: ROW_HEIGHT * VISIBLE_ROWS,
            borderRadius: 18,
            backgroundColor: 'rgba(20,20,24,0.92)',
            overflow: 'hidden',
          }}
        >
          {/* Center-row highlight track, drawn behind the list */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 12, right: 12,
              top: ROW_HEIGHT * PAD_ROWS,
              height: ROW_HEIGHT,
              borderRadius: 10,
              backgroundColor: 'rgba(255,255,255,0.06)',
            }}
          />
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            snapToInterval={ROW_HEIGHT}
            decelerationRate="fast"
            contentContainerStyle={{ paddingVertical: ROW_HEIGHT * PAD_ROWS }}
            contentOffset={{ x: 0, y: Math.max(0, tickers.indexOf(activeTicker)) * ROW_HEIGHT }}
            onScroll={handleScroll}
            scrollEventThrottle={32}
          >
            {tickers.map((t, i) => {
              const isCentered = i === centeredIndex;
              const hasPosition = openPositionTickers?.includes(t);
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => scrollToIndex(i)}
                  activeOpacity={0.7}
                  style={{ height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <TickerLogo ticker={t} size={isCentered ? 22 : 16} />
                  <Text
                    style={{
                      color: isCentered ? '#FFFFFF' : 'rgba(255,255,255,0.38)',
                      fontSize: isCentered ? 20 : 15,
                      fontWeight: isCentered ? '800' : '600',
                    }}
                  >
                    {t}
                  </Text>
                  {hasPosition && (
                    <View
                      style={{
                        width: isCentered ? 7 : 5,
                        height: isCentered ? 7 : 5,
                        borderRadius: 4,
                        backgroundColor: colors.success,
                      }}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};
