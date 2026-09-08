import React, { useState, useEffect, useCallback } from 'react';
import { Modal, View, TouchableOpacity, ActivityIndicator, Text, ScrollView, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabView, type NavigationState } from 'react-native-tab-view';
import { format, parseISO } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketDigest } from '@/hooks/queries/digest/useMarketDigest';
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
      {/* react-native-safe-area-context can't see the outer SafeAreaProvider
          from inside a core RN <Modal> (separate native view hierarchy — see
          the library's own docs), so insets silently come back as 0 and the
          progress bar / close button render under the notch. Nesting a
          provider here re-measures insets for this Modal's own window. */}
      <SafeAreaProvider>
        <DigestModalContent date={date} visible={visible} onClose={onClose} />
      </SafeAreaProvider>
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

  // Reset to slide 0 every time the modal (re)opens for a date.
  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible, date]);

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
          style={{ backgroundColor: colors.background }}
        />
      )}
    </View>
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
