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
const ROW_H = 26;
const WHEEL_H = ROW_H * 2 + 4;
/** Minimum rows in the recycled loop — enough to cover the visible window
 *  plus fade-in/out rows even for a 1-2 ticker list. */
const MIN_SLOTS = 7;
/** Resting on a ticker this long mid-drag loads it without lifting. */
const DWELL_MS = 1500;
const PAPER_ORANGE = '#FF9F0A';

const mod = (i: number, n: number) => ((i % n) + n) % n;

/** Per-ticker state shown on the wheel's letter badge. */
export interface TickerStatus {
  live?: boolean;
  paper?: boolean;
  /** A watch level is active on this ticker. */
  watching?: boolean;
  /** One of the pinned index ETFs (SPY/IWM/QQQ). */
  pinned?: boolean;
}

/**
 * TickerWheel — vertical ticker navigator for the chart toolbar.
 *
 * Drag up/down and the list scrolls with your finger, endlessly: it's a
 * loop, so after the last ticker comes the first again (in either
 * direction, for as long as you keep dragging). A haptic ticks per ticker
 * passed. Nothing loads while scrolling — the centered ticker is selected
 * when you lift your finger, or after resting on it for 1.5s. Tap opens
 * search.
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
  status,
}: {
  tickers: string[];
  activeTicker: string;
  onSelect: (t: string) => void;
  onSearchPress: () => void;
  status?: Record<string, TickerStatus>;
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

  const slotIds: number[] = [];
  for (let s = 0; s < slots; s++) slotIds.push(s);

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      {/* Plain, chromeless like TradingView's symbol scroller. */}
      <View style={s.wheel}>
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
            />
          );
        })}
      </View>
    </GestureDetector>
  );
}

function WheelRow({ slot, slots, offset, ticker, status, colors }: {
  slot: number; slots: number; offset: SharedValue<number>; ticker: string;
  status?: TickerStatus; colors: any;
}) {
  const style = useAnimatedStyle(() => {
    // Distance from center, wrapped into [-slots/2, slots/2) so each slot
    // reappears on the far side as the loop turns.
    const raw = slot - offset.value + slots / 2;
    const d = (((raw % slots) + slots) % slots) - slots / 2;
    const dist = Math.min(1, Math.abs(d));
    return {
      transform: [{ translateY: d * ROW_H }],
      // Same size throughout (as TradingView); neighbours just dim.
      opacity: Math.abs(d) > 1.6 ? 0 : 1 - dist * 0.72,
    };
  });
  return (
    <Animated.View style={[s.row, style]} pointerEvents="none">
      <LetterBadge ticker={ticker} status={status} colors={colors} />
      <Text numberOfLines={1} style={[s.rowText, { color: colors.text }]}>{ticker}</Text>
    </Animated.View>
  );
}

/** First-letter badge. Fill: live = green, paper = orange, both = split
 *  green/orange, pinned index ETF = accent. Red rim = active watch level. */
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
    width: 104,
    height: WHEEL_H,
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
  rowText: {
    fontSize: 20,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  badge: {
    width: 18,
    height: 18,
    borderRadius: 5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
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
