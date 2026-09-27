import React, { useState, useEffect, useCallback } from 'react';
import { Modal, View, TouchableOpacity, ActivityIndicator, Text, ScrollView, useWindowDimensions, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabView, type NavigationState } from 'react-native-tab-view';
import { format, parseISO } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketDigest } from '@/hooks/queries/digest/useMarketDigest';
import { useSeenMarketDigests } from '@/hooks/useSeenMarketDigests';
import {
  MarketSetupSlide, HeadlinesSlide, WatchlistSlide, MoversSlide, EventsSlide, WatchSlide, TradingSlide, ClosingSlide,
} from './DigestSlides';

interface DigestRoute { key: string }

const ROUTES: DigestRoute[] = [
  { key: 'setup' }, { key: 'headlines' }, { key: 'watchlist' }, { key: 'movers' },
  { key: 'events' }, { key: 'watch' }, { key: 'trading' }, { key: 'closing' },
];

interface Props {
  /** ISO date (YYYY-MM-DD) of the digest to view. */
  date: string | null;
  visible: boolean;
  onClose: () => void;
}

/**
 * Full-screen story-style viewer for one day's Market Digest — swipeable
 * slides with a top progress-dot bar (tap a segment to jump), built on
 * react-native-tab-view like every other swipeable pager in this app (see
 * SegmentedPager.tsx) so nested vertical scrolling inside a slide (long
 * headline/event lists) doesn't fight the horizontal swipe gesture.
 *
 * Pure viewer, same split as ReviewDetailModal — generation happens
 * elsewhere (Home card / Daily Review button) behind DigestGeneratingOverlay,
 * and this only ever opens once a digest for `date` already exists.
 */
export function MarketDigestModal({ date, visible, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      {/* Two providers, both needed for the same underlying reason: a core
          RN <Modal> renders in its own separate native view hierarchy, so
          neither the outer SafeAreaProvider nor the outer
          GestureHandlerRootView (both mounted once, in app/_layout.tsx) can
          see into it.
          - SafeAreaProvider: without a nested one, insets silently come back
            as 0 and the progress bar/close button render under the notch.
          - GestureHandlerRootView: this modal's own TabView (the slide
            swipe) is gesture-handler-based, same as every other TabView in
            the app (see SegmentedPager.tsx). Without a nested root, its
            gesture handlers register against no real native root at all —
            and when the modal unmounts, gesture-handler's bookkeeping for
            that never-anchored handler set is left in a bad state, which
            was observed breaking the ORB tab's own SegmentedPager swipe
            (also TabView-based) after closing this modal from Daily
            Review — the two share the same gesture-handler singleton, so a
            root that never anchored correctly can wedge a sibling screen's
            gestures too, not just this modal's own. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <DigestModalContent date={date} visible={visible} onClose={onClose} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}

function DigestModalContent({ date, visible, onClose }: Props) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const layout = useWindowDimensions();
  const [index, setIndex] = useState(0);

  const { data, isLoading, error } = useMarketDigest(visible ? date : null);
  const content = data?.data?.content_json;
  const { markSeen } = useSeenMarketDigests();

  // Reset to slide 0 every time the modal (re)opens for a date, and record
  // this date as viewed so MarketDigestCard stops showing it on Home.
  useEffect(() => {
    if (!visible) return;
    setIndex(0);
    if (date) markSeen(date);
  }, [visible, date, markSeen]);

  const dateLabel = content ? format(parseISO(content.digest_date), 'EEE, MMM d') : '';

  const renderScene = useCallback(({ route }: { route: DigestRoute }) => {
    if (!content) return null;
    switch (route.key) {
      case 'setup':      return <SlideScroll insets={insets}><MarketSetupSlide data={content} dateLabel={dateLabel} colors={colors} /></SlideScroll>;
      case 'headlines':   return <SlideScroll insets={insets}><HeadlinesSlide data={content} dateLabel={dateLabel} colors={colors} /></SlideScroll>;
      case 'watchlist':   return <SlideScroll insets={insets}><WatchlistSlide data={content} dateLabel={dateLabel} colors={colors} /></SlideScroll>;
      case 'movers':      return <SlideScroll insets={insets}><MoversSlide data={content} dateLabel={dateLabel} colors={colors} /></SlideScroll>;
      case 'events':      return <SlideScroll insets={insets}><EventsSlide data={content} dateLabel={dateLabel} colors={colors} /></SlideScroll>;
      case 'watch':       return <SlideScroll insets={insets}><WatchSlide data={content} dateLabel={dateLabel} colors={colors} /></SlideScroll>;
      case 'trading':     return <SlideScroll insets={insets}><TradingSlide data={content} dateLabel={dateLabel} colors={colors} /></SlideScroll>;
      case 'closing':     return <ClosingSlide onClose={onClose} colors={colors} />;
      default:            return null;
    }
  }, [content, dateLabel, colors, insets, onClose]);

  const navigationState: NavigationState<DigestRoute> = { index, routes: ROUTES };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <DigestBackdrop colors={colors} width={layout.width} height={layout.height} />
      <ProgressHeader
        count={ROUTES.length}
        index={index}
        onSelect={setIndex}
        onClose={onClose}
        insets={insets}
        colors={colors}
      />

      {isLoading || !content ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {error
            ? <Text style={{ color: colors.textTertiary, fontSize: 13 }}>Digest unavailable for this date.</Text>
            : <ActivityIndicator size="large" color={colors.accent} />}
        </View>
      ) : (
        <TabView
          navigationState={navigationState}
          onIndexChange={setIndex}
          initialLayout={{ width: layout.width, height: 0 }}
          renderScene={renderScene}
          renderTabBar={() => null}
          swipeEnabled
          style={{ backgroundColor: 'transparent' }}
        />
      )}
    </View>
  );
}

/**
 * Blurred-mesh backdrop, styled after Origin's own "weekly recap" story
 * background — several soft overlapping radial blobs strung along a
 * diagonal, not a flat top-to-bottom fade, so it reads as an organic blur
 * behind the content instead of a gradient banner sitting on top of it. A
 * plain LinearGradient read completely flat next to that reference; a
 * handful of react-native-svg RadialGradients layered together is what
 * actually produces the cloudy, edge-blurred look. Dark mode gets the full
 * deep-green treatment; light mode gets a much quieter version of the same
 * technique since a bold green-black wash doesn't belong over light content.
 */
function DigestBackdrop({ colors, width, height }: {
  colors: ReturnType<typeof useThemeColors>; width: number; height: number;
}) {
  if (width === 0 || height === 0) return null;

  const blobs = colors.isDark
    ? [
        { cx: 0.15, cy: 0.02, r: 0.62, color: '#3F8C5C', opacity: 0.55 },
        { cx: 0.55, cy: 0.28, r: 0.55, color: '#2E6B47', opacity: 0.5 },
        { cx: 0.88, cy: 0.55, r: 0.5,  color: '#173A28', opacity: 0.6 },
        { cx: 0.28, cy: 0.42, r: 0.32, color: '#6FAE84', opacity: 0.22 },
      ]
    : [
        { cx: 0.18, cy: 0.0,  r: 0.5, color: '#3F8C5C', opacity: 0.14 },
        { cx: 0.75, cy: 0.15, r: 0.4, color: '#2E6B47', opacity: 0.1 },
      ];
  const baseFill = colors.isDark ? '#0A160E' : colors.background;

  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFillObject}>
      <Defs>
        {blobs.map((b, i) => (
          <RadialGradient key={i} id={`digest-blob-${i}`} cx={`${b.cx * 100}%`} cy={`${b.cy * 100}%`} r={`${b.r * 100}%`}>
            <Stop offset="0%" stopColor={b.color} stopOpacity={b.opacity} />
            <Stop offset="100%" stopColor={b.color} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={baseFill} />
      {blobs.map((_, i) => (
        <Rect key={i} x={0} y={0} width={width} height={height} fill={`url(#digest-blob-${i})`} />
      ))}
    </Svg>
  );
}

function SlideScroll({ children, insets }: { children: React.ReactNode; insets: { bottom: number } }) {
  return (
    <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: insets.bottom + 48 }} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

function ProgressHeader({ count, index, onSelect, onClose, insets, colors }: {
  count: number; index: number; onSelect: (i: number) => void; onClose: () => void;
  insets: { top: number }; colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
          {Array.from({ length: count }).map((_, i) => (
            <TouchableOpacity key={i} style={{ flex: 1 }} onPress={() => onSelect(i)} hitSlop={{ top: 10, bottom: 10 }}>
              <View style={{ height: 3, borderRadius: 2, backgroundColor: i <= index ? colors.accent : colors.border }} />
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={10}
          style={{
            width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
            backgroundColor: colors.surfaceSecondary,
          }}
        >
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
