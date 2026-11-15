import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '@/lib/useColorScheme';

// TradingView-style: the selected ticker in full, with its neighbours
// dimmed and half cut off by the top/bottom edges.
const ROW_H = 30;
/** Row pitch shared with IntervalWheel so both wheels in the pill match. */
export const WHEEL_ROW_H = ROW_H;
const WHEEL_H = ROW_H * 2 + 4;
/** Minimum rows in the recycled loop — enough to cover the visible window
 *  plus fade-in/out rows even for a 1-2 ticker list. */
const MIN_SLOTS = 7;
/** Resting on a ticker this long mid-drag loads it without lifting. */
const DWELL_MS = 1500;
const PAPER_ORANGE = '#FF9F0A';
/** Press-and-hold (without moving) this long fires onLongPress. */
export const WHEEL_LONG_PRESS_MS = 450;
/** Height of the wheel inside the chart's floating ticker pill. */
export const PILL_WHEEL_H = 50;

const mod = (i: number, n: number) => ((i % n) + n) % n;

/** Per-ticker state shown on the wheel's letter badge. */
export interface TickerStatus {
  live?: boolean;
  paper?: boolean;
  /** A watch level is active on this ticker. */
  watching?: boolean;
  /** One of the pinned index ETFs (SPY/IWM/QQQ). */
  pinned?: boolean;
  /** In the Morning Brief — amber dot on the badge's top-right corner (the
   *  brief trigger color). */
  brief?: boolean;
}

/**
 * TickerWheel — vertical ticker navigator for the chart toolbar.
 *
 * Drag up/down and the list scrolls with your finger, endlessly: it's a
 * loop, so after the last ticker comes the first again (in either
 * direction, for as long as you keep dragging). A haptic ticks per ticker
 * passed. Nothing loads while scrolling — the centered ticker is selected
 * when you lift your finger, or after resting on it for 1.5s. Tap opens
 * search. Press and hold without moving (450ms) fires `onLongPress`; any
 * drag cancels the hold.
 *
 * `variant="pill"` is the compact, centered layout used inside the chart's
 * floating ticker pill: it fills its parent's width (flex: 1), is
 * PILL_WHEEL_H tall, and centers each row instead of left-aligning it.
 *
 * `offset` is a continuous, unbounded row position (+ = toward next); the
 * selected ticker is tickers[offset mod n]. Rows are a fixed pool of slots
 * (a multiple of n) recycled around the loop on the UI thread, so
 * scrolling never re-renders React.
 */
export function TickerWheel({
  tickers,
  activeTicker,
  onSelect,
  onSearchPress,
  onLongPress,
  status,
  variant = 'bar',
}: {
  tickers: string[];
  activeTicker: string;
  onSelect: (t: string) => void;
  onSearchPress: () => void;
  /** Still press-and-hold (450ms, no movement). Disabled when omitted. */
  onLongPress?: () => void;
  status?: Record<string, TickerStatus>;
  variant?: 'bar' | 'pill';
}) {
  const colors = useThemeColors();
  const n = tickers.length;
  const activeIdx = Math.max(0, tickers.indexOf(activeTicker));
  const slots = n ? n * Math.ceil(MIN_SLOTS / n) : 0;

  const offset = useSharedValue(activeIdx);
  const dragStart = useSharedValue(0);
  const lastPreview = useSharedValue(activeIdx);
  const dragging = useRef(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef(activeTicker);
  const latest = useRef({ activeIdx, n });
  latest.current = { activeIdx, n };

  useEffect(() => { committed.current = activeTicker; }, [activeTicker]);

  // Bring the active ticker under the center (shortest way round) after an
  // outside change — search, deep link, or the list reordering.
  const syncToActive = useCallback(() => {
    const { activeIdx: idx, n: len } = latest.current;
    if (!len) return;
    const cur = Math.round(offset.value);
    let delta = mod(idx - cur, len);
    if (delta > len / 2) delta -= len;
    if (delta !== 0) {
      offset.value = cur + delta;
      lastPreview.value = cur + delta;
    }
  }, [offset, lastPreview]);

  useEffect(() => {
    if (!dragging.current) syncToActive();
  }, [activeIdx, n, syncToActive]);

  const clearDwell = () => {
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
    dwellTimer.current = null;
  };
  useEffect(() => clearDwell, []);

  const commit = useCallback((pos: number) => {
    if (!n) return;
    const t = tickers[mod(pos, n)];
    if (t && t !== committed.current) {
      committed.current = t;
      onSelect(t);
    }
  }, [n, tickers, onSelect]);

  const onDragStart = useCallback(() => { dragging.current = true; }, []);

  const onPreview = useCallback((pos: number) => {
    Haptics.selectionAsync().catch(() => {});
    clearDwell();
    dwellTimer.current = setTimeout(() => commit(pos), DWELL_MS);
  }, [commit]);

  const onRelease = useCallback((pos: number) => {
    clearDwell();
    commit(pos);
  }, [commit]);

  const onSettled = useCallback(() => {
    dragging.current = false;
    syncToActive();
  }, [syncToActive]);

  const pan = Gesture.Pan()
    .enabled(n > 1)
    .activeOffsetY([-6, 6])
    .failOffsetX([-18, 18])
    .onStart(() => {
      'worklet';
      cancelAnimation(offset);
      dragStart.value = offset.value;
      runOnJS(onDragStart)();
    })
    .onUpdate((e) => {
      'worklet';
      const o = dragStart.value - e.translationY / ROW_H;
      offset.value = o;
      const p = Math.round(o);
      if (p !== lastPreview.value) {
        lastPreview.value = p;
        runOnJS(onPreview)(p);
      }
    })
    .onEnd(() => {
      'worklet';
      const target = Math.round(offset.value);
      runOnJS(onRelease)(target);
      offset.value = withTiming(target, { duration: 160, easing: Easing.out(Easing.quad) }, (done) => {
        if (done) runOnJS(onSettled)();
      });
    });

  const tap = Gesture.Tap().onEnd(() => {
    'worklet';
    runOnJS(onSearchPress)();
  });

  const fireLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onLongPress?.();
  }, [onLongPress]);

  // Raced with pan + tap: a hold that never moves activates at 450ms (and
  // cancels the tap); a drag activates the pan first (6px vs the hold's
  // 10px slop), which fails the hold.
  const longPress = Gesture.LongPress()
    .enabled(!!onLongPress)
    .minDuration(WHEEL_LONG_PRESS_MS)
    .onStart(() => {
      'worklet';
      runOnJS(fireLongPress)();
    });

  const pill = variant === 'pill';

  const slotIds: number[] = [];
  for (let s = 0; s < slots; s++) slotIds.push(s);

  return (
    <GestureDetector gesture={Gesture.Race(pan, longPress, tap)}>
      {/* Plain, chromeless like TradingView's symbol scroller. */}
      <View style={pill ? s.wheelPill : s.wheel}>
        {slotIds.map(slot => {
          const t = tickers[mod(slot, n)];
          return (
            <WheelRow
              key={slot}
              slot={slot}
              slots={slots}
              offset={offset}
              ticker={t}
              status={status?.[t]}
              colors={colors}
              pill={pill}
            />
          );
        })}
      </View>
    </GestureDetector>
  );
}

function WheelRow({ slot, slots, offset, ticker, status, colors, pill }: {
  slot: number; slots: number; offset: SharedValue<number>; ticker: string;
  status?: TickerStatus; colors: any; pill: boolean;
}) {
  const style = useAnimatedStyle(() => {
    // Distance from center, wrapped into [-slots/2, slots/2) so each slot
    // reappears on the far side as the loop turns.
    const raw = slot - offset.value + slots / 2;
    const d = (((raw % slots) + slots) % slots) - slots / 2;
    const dist = Math.min(1, Math.abs(d));
    return {
      // The selected (centered) ticker is noticeably bigger so it reads as
      // selected; neighbours shrink a touch and dim. Scaled from the left
      // edge so the left-aligned text doesn't drift sideways.
      // (Pill rows are centered, so they scale from the center instead, and
      // a little less — the pill is narrower than the old bar.)
      transform: [{ translateY: d * ROW_H }, { scale: pill ? 1.1 - dist * 0.25 : 1.2 - dist * 0.35 }],
      transformOrigin: pill ? 'center' : 'left center',
      opacity: Math.abs(d) > 1.6 ? 0 : 1 - dist * 0.72,
    };
  });
  return (
    <Animated.View style={[s.row, pill && s.rowPill, style]} pointerEvents="none">
      <View>
        <LetterBadge ticker={ticker} status={status} colors={colors} />
        {status?.brief && (
          <View
            accessibilityLabel="Morning Brief ticker"
            style={[s.briefDot, { backgroundColor: colors.warning, borderColor: colors.background }]}
          />
        )}
      </View>
      <Text numberOfLines={1} style={[s.rowText, pill && s.rowTextPill, { color: colors.text }]}>{ticker}</Text>
    </Animated.View>
  );
}

/** First-letter badge. Fill: live = green, paper = orange, both = split
 *  green/orange, pinned index ETF = accent. Red rim = active watch level.
 *  (Amber corner dot = Morning Brief ticker — drawn by WheelRow, outside the
 *  badge's clip.) */
function LetterBadge({ ticker, status, colors }: { ticker: string; status?: TickerStatus; colors: any }) {
  const live = !!status?.live;
  const paper = !!status?.paper;
  const fill = live && !paper ? colors.success
    : paper && !live ? PAPER_ORANGE
    : !live && !paper && status?.pinned ? colors.accent
    : null;
  const filled = fill != null || (live && paper);
  return (
    <View
      style={[
        s.badge,
        {
          backgroundColor: fill ?? 'transparent',
          borderColor: status?.watching ? colors.error : colors.text + '40',
          borderWidth: status?.watching ? 1.5 : 1,
        },
      ]}
    >
      {live && paper ? (
        <>
          <View style={[s.half, { left: 0, backgroundColor: colors.success }]} />
          <View style={[s.half, { right: 0, backgroundColor: PAPER_ORANGE }]} />
        </>
      ) : null}
      <Text style={[s.badgeText, { color: filled ? '#fff' : colors.text }]}>{ticker[0]?.toUpperCase()}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wheel: {
    width: 118,
    height: WHEEL_H,
    overflow: 'hidden',
  },
  wheelPill: {
    flex: 1,
    minWidth: 0,
    height: PILL_WHEEL_H,
    overflow: 'hidden',
  },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: (WHEEL_H - ROW_H) / 2,
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  },
  rowPill: {
    top: (PILL_WHEEL_H - ROW_H) / 2,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  rowText: {
    fontSize: 20,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  rowTextPill: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  badge: {
    width: 18,
    height: 18,
    borderRadius: 5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Morning Brief marker — sits on the badge's top-right corner. */
  briefDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  half: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '50%',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
});
