import React, { useState, useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SegmentedPager } from '@/common/components/ui/SegmentedPager';
import DashboardScreen from './dashboard';
import PositionScreen from './position';
import OptionsScreen from './options';

const ROUTES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'positions', label: 'Live Positions' },
  { key: 'contracts', label: 'Contracts' },
];

/**
 * Home tab — swipeable pager: Dashboard | Live Positions | Contracts.
 * Each page reuses the existing standalone screen component directly
 * (dashboard.tsx / position.tsx / options.tsx are still real routes too,
 * still reachable via router.push for deep links / notifications).
 */
export default function HomeScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Consume `section` exactly once, then strip it from the URL — otherwise it
  // lingers in the route's params and every later refocus (tab switch away
  // and back, or a stray refocus mid-swipe) re-applies the old deep-link
  // target and snaps the pager back to it, fighting the user's own swipes.
  // A fresh deep link (Menu tap, notification) still resyncs correctly since
  // it sets `section` again from scratch.
  useFocusEffect(
    useCallback(() => {
      if (section) {
        setActiveKey(section);
        router.setParams({ section: undefined });
      }
    }, [section]),
  );

  return (
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
  );
}
