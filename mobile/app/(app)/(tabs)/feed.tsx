import React, { useState, useCallback } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SegmentedPager } from '@/common/components/ui/SegmentedPager';
import { MarketDigestCard } from '@/common/components/digest/MarketDigestCard';
import { MarketDigestModal } from '@/common/components/digest/MarketDigestModal';
import DashboardScreen from './dashboard';
import PositionScreen from './position';
import OptionsScreen from './options';

const ROUTES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'positions', label: 'Live Positions' },
  { key: 'contracts', label: 'Contracts' },
];

/**
 * Home tab — a persistent Market Digest banner above a swipeable pager:
 * Dashboard | Live Positions | Contracts. Each page reuses the existing
 * standalone screen component directly (dashboard.tsx / position.tsx /
 * options.tsx are still real routes too, still reachable via router.push
 * for deep links / notifications).
 */
export default function HomeScreen() {
  const { section, digest_date: digestDateParam } =
    useLocalSearchParams<{ section?: string; digest_date?: string }>();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [digestModalDate, setDigestModalDate] = useState<string | null>(null);

  // Consume `section`/`digest_date` exactly once, then strip them from the
  // URL — otherwise they linger in the route's params and every later
  // refocus (tab switch away and back, or a stray refocus mid-swipe)
  // re-applies the old deep-link target, fighting the user's own
  // navigation. A fresh deep link (Menu tap, notification) still resyncs
  // correctly since it sets the param again from scratch.
  useFocusEffect(
    useCallback(() => {
      if (section) {
        setActiveKey(section);
        router.setParams({ section: undefined });
      }
      if (digestDateParam) {
        setDigestModalDate(digestDateParam);
        router.setParams({ digest_date: undefined });
      }
    }, [section, digestDateParam]),
  );

  return (
    <View style={{ flex: 1 }}>
      <MarketDigestCard onOpen={setDigestModalDate} />
      <View style={{ flex: 1 }}>
        <SegmentedPager
          routes={ROUTES}
          activeKey={activeKey}
          renderScene={key => {
            switch (key) {
              case 'dashboard': return <DashboardScreen />;
              case 'positions': return <PositionScreen embedded />;
              case 'contracts': return <OptionsScreen />;
              default: return null;
            }
          }}
        />
      </View>
      <MarketDigestModal
        date={digestModalDate}
        visible={!!digestModalDate}
        onClose={() => setDigestModalDate(null)}
      />
    </View>
  );
}
