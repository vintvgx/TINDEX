import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedReaction,
  interpolate,
  Extrapolation,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '@/lib/useColorScheme';
import { DynamicChartsView, stepChartsTicker } from './views/DynamicChartsView';
import { DynamicBriefView } from './views/DynamicBriefView';
import { DynamicNewsView } from './views/DynamicNewsView';
import { DynamicContractsView } from './views/DynamicContractsView';
import { DynamicOpenContractsView } from './views/DynamicOpenContractsView';
import { DynamicAccountView } from './views/DynamicAccountView';
import { DynamicCollapsedSummary } from './DynamicCollapsedSummary';
import { ConfirmStackCard, usePendingConfirmations } from './cards/ConfirmStackCard';
import { SoldCard } from './cards/SoldCard';
import { EnteredCard, type EnteredInfo } from './cards/EnteredCard';
import { useSoldTradeAlert } from './cards/useSoldTradeAlert';

/**
 * 0.7 redesign dynamic card ("dynamic island").
 *
 * - Collapses to a slim strip on scroll (driven by the parent's scrollY),
 *   expands back on scroll up — springy, like the reference video.
 * - Horizontal swipe between views: charts | account (live funds +
 *   performance) | brief | open (held contracts → edit sheet) | watched
 *   (tracked → contract window) | news | signals.
 * - Collapsed, each view shows its own one-line summary
 *   (DynamicCollapsedSummary).
 * - Rendered by the parent as an OVERLAY above its ScrollView (not inside
 *   it): animating a scroll child's height changes the content height
 *   mid-scroll, which fed back into scrollY and made it jitter/bounce.
 * - Transient states (confirm-entry stack, sold card) take over the card;
 *   see ConfirmStackCard / SoldCard.
 */

// 'signals' removed 2026-10-12 (deprecated).
export const DYNAMIC_VIEWS = ['charts', 'account', 'brief', 'open', 'watched', 'news'] as const;
export type DynamicViewKey = (typeof DYNAMIC_VIEWS)[number];

export const EXPANDED_H = 380;
/** Pages further than this from the visible one render as empty placeholders
 *  (unmounted — their queries, polls and sockets stop). 1 = the visible page
 *  plus one neighbor each side, so a swipe never lands on a blank page. */
const MOUNT_RADIUS = 1;
export const COLLAPSED_H = 76;
/** Scroll distance over which the card collapses — exactly the height it
 *  loses, so its bottom edge tracks the content scrolling under it 1:1
 *  (no gap opening up, no overlap). */
export const COLLAPSE_RANGE = EXPANDED_H - COLLAPSED_H;
/** How long the post-confirm "order sent" card shows before the Open page. */
const ENTERED_CARD_MS = 4000;

export interface TickerInfo {
  ticker: string;
  price: number | null;
  changePct: number | null;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DynamicCard({
  scrollY,
  onOpenBrief,
}: {
  scrollY: SharedValue<number>;
  onOpenBrief: () => void;
}) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const pageWidth = width - 28; // parent horizontal padding
  // Morning Brief auto-shows until it's accessed (once per day).
  const [viewIndex, setViewIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [tickerInfo, setTickerInfo] = useState<TickerInfo>({ ticker: '', price: null, changePct: null });
  const pagerRef = useRef<FlatList<DynamicViewKey>>(null);

  useEffect(() => {
    AsyncStorage.getItem(`dynamicCard.briefSeen.${todayISO()}`).then((seen) => {
      if (!seen) {
        const i = DYNAMIC_VIEWS.indexOf('brief');
        setViewIndex(i);
        pagerRef.current?.scrollToIndex({ index: i, animated: false });
      }
    }).catch(() => {});
  }, []);

  const handleOpenBrief = useCallback(async () => {
    try {
      await AsyncStorage.setItem(`dynamicCard.briefSeen.${todayISO()}`, '1');
    } catch {}
    onOpenBrief();
  }, [onOpenBrief]);

  // Transient states take over the card — sold (12s) beats "order sent"
  // (4s, right after a confirm), which beats the confirm stack, which beats
  // the swipe views. All pin the card expanded.
  const { alert: soldAlert, dismiss: dismissSold } = useSoldTradeAlert();
  const pending = usePendingConfirmations();
  const [entered, setEntered] = useState<EnteredInfo | null>(null);
  const enteredTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleEntered = useCallback((info: EnteredInfo) => {
    setEntered(info);
    if (enteredTimer.current) clearTimeout(enteredTimer.current);
    enteredTimer.current = setTimeout(() => {
      setEntered(null);
      // Then land on the Open page, where the new position shows once filled.
      setViewIndex(DYNAMIC_VIEWS.indexOf('open'));
    }, ENTERED_CARD_MS);
  }, []);
  useEffect(() => () => { if (enteredTimer.current) clearTimeout(enteredTimer.current); }, []);
  const transientActive = soldAlert != null || entered != null || pending.length > 0;

  // Flip pointer-events + interactivity when the collapse crosses over.
  useAnimatedReaction(
    () => scrollY.value > COLLAPSE_RANGE * 0.7,
    (isCollapsed, prev) => {
      if (isCollapsed !== prev) runOnJS(setCollapsed)(isCollapsed);
    },
  );

  useEffect(() => {
    pagerRef.current?.scrollToIndex({ index: viewIndex, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    height: transientActive
      ? EXPANDED_H
      : interpolate(scrollY.value, [0, COLLAPSE_RANGE], [EXPANDED_H, COLLAPSED_H], Extrapolation.CLAMP),
  }));
  const expandedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, COLLAPSE_RANGE * 0.6], [1, 0], Extrapolation.CLAMP),
  }));
  const collapsedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COLLAPSE_RANGE * 0.4, COLLAPSE_RANGE], [0, 1], Extrapolation.CLAMP),
  }));

  // ── Minimized card swipes ─────────────────────────────────────────────
  // Left/right = previous/next page (same order as the expanded pager);
  // up/down = step through the page's own items (chart tickers, open
  // positions, headlines, …). The card is an overlay above Home's
  // ScrollView, so these never fight the page scroll.
  const [stripStep, setStripStep] = useState(0);
  useEffect(() => { setStripStep(0); }, [viewIndex]);
  const stepView = useCallback((dir: 1 | -1) => {
    const next = Math.max(0, Math.min(DYNAMIC_VIEWS.length - 1, viewIndex + dir));
    if (next === viewIndex) return;
    Haptics.selectionAsync().catch(() => {});
    setViewIndex(next);
    // Keep the (hidden) expanded pager on the same page for when it expands.
    pagerRef.current?.scrollToIndex({ index: next, animated: false });
  }, [viewIndex]);
  const stepItem = useCallback((dir: 1 | -1) => {
    Haptics.selectionAsync().catch(() => {});
    if (DYNAMIC_VIEWS[viewIndex] === 'charts') stepChartsTicker(dir);
    else setStripStep((n) => n + dir);
  }, [viewIndex]);
  const stripSwipe = useMemo(() => Gesture.Pan()
    .minDistance(10)
    .onEnd((e) => {
      const ax = Math.abs(e.translationX);
      const ay = Math.abs(e.translationY);
      if (Math.max(ax, ay) < 24) return;
      if (ax > ay) runOnJS(stepView)(e.translationX < 0 ? 1 : -1);
      else runOnJS(stepItem)(e.translationY < 0 ? 1 : -1);
    }), [stepView, stepItem]);

  const onViewableChanged = useCallback(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null) setViewIndex(i);
  }, []);

  // Only the visible page and its neighbors are mounted (polling audit A0).
  // All 7 used to mount at once — each running its own queries, polls and
  // live sockets while you looked at one — the main reason the 0.7 Home
  // screen loads the backend far more than 0.5 did. Revisiting a page
  // re-mounts it from the React Query cache, so it shows instantly.
  const renderView = useCallback(
    ({ item, index }: { item: DynamicViewKey; index: number }) => {
      if (Math.abs(index - viewIndex) > MOUNT_RADIUS) {
        return <View style={{ width: pageWidth, height: EXPANDED_H }} />;
      }
      let view: React.ReactNode;
      switch (item) {
        case 'charts':
          view = <DynamicChartsView onActiveTicker={setTickerInfo} height={EXPANDED_H} visible={index === viewIndex} />;
          break;
        case 'brief':
          view = <DynamicBriefView onOpenBrief={handleOpenBrief} />;
          break;
        case 'account':
          view = <DynamicAccountView />;
          break;
        case 'news':
          view = <DynamicNewsView />;
          break;
        case 'open':
          view = <DynamicOpenContractsView />;
          break;
        case 'watched':
          view = <DynamicContractsView />;
          break;
      }
      return <View style={{ width: pageWidth, height: EXPANDED_H }}>{view}</View>;
    },
    [pageWidth, handleOpenBrief, viewIndex],
  );


  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.cardBorder },
        containerStyle,
      ]}
    >
      {soldAlert ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          <SoldCard alert={soldAlert} onDismiss={dismissSold} />
        </ScrollView>
      ) : entered ? (
        <View style={{ padding: 14 }}>
          <EnteredCard info={entered} />
        </View>
      ) : pending.length > 0 ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          <ConfirmStackCard onEntered={handleEntered} />
        </ScrollView>
      ) : (
        <>
          {/* expanded: horizontal view pager */}
          <Animated.View style={[StyleSheet.absoluteFillObject, expandedStyle]} pointerEvents={collapsed ? 'none' : 'auto'}>
            <FlatList
              ref={pagerRef}
              data={DYNAMIC_VIEWS as unknown as DynamicViewKey[]}
              keyExtractor={(k) => k}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              renderItem={renderView}
              extraData={viewIndex}
              onViewableItemsChanged={onViewableChanged}
              viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
              getItemLayout={(_, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
              // The pager unmounts during takeovers (sold / entered / confirm)
              // and remounts after — start on the current page instead of
              // page 1 (and on Open right after a confirm).
              initialScrollIndex={viewIndex}
            />
            {/* view dots */}
            <View style={styles.dots}>
              {DYNAMIC_VIEWS.map((v, i) => (
                <View
                  key={v}
                  style={[
                    styles.dot,
                    { backgroundColor: i === viewIndex ? colors.text : colors.textTertiary + '55' },
                  ]}
                />
              ))}
            </View>
          </Animated.View>

          {/* collapsed strip — swipe left/right for pages, up/down for items */}
          <GestureDetector gesture={stripSwipe}>
            <Animated.View
              style={[StyleSheet.absoluteFillObject, collapsedStyle, styles.collapsedRow]}
              pointerEvents={collapsed ? 'auto' : 'none'}
            >
              {/* A short version of whichever view is showing — not the chart
                  ticker on every page. */}
              <DynamicCollapsedSummary view={DYNAMIC_VIEWS[viewIndex]} tickerInfo={tickerInfo} step={stripStep} />
              {/* page dots, so a sideways swipe has visible feedback */}
              <View style={styles.stripDots} pointerEvents="none">
                {DYNAMIC_VIEWS.map((v, i) => (
                  <View
                    key={v}
                    style={[styles.stripDot, { backgroundColor: i === viewIndex ? colors.text : colors.textTertiary + '55' }]}
                  />
                ))}
              </View>
            </Animated.View>
          </GestureDetector>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    marginHorizontal: 14,
  },
  mono: { fontFamily: 'Menlo' },
  page: {
    padding: 14,
  },
  dots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  stripDots: {
    position: 'absolute',
    bottom: 6,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  stripDot: { width: 4, height: 4, borderRadius: 2 },
});
