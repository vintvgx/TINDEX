import React, { useState, useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SegmentedPager } from '@/common/components/ui/SegmentedPager';
import MonitorScreen from './monitor';
import StrategyScreen from './strategy';
import TradeLogScreen from './tradelog';
import DailyReviewScreen from './daily_review';

const ROUTES = [
  { key: 'monitor', label: 'Monitor' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'tradelog', label: 'Trade Log' },
  { key: 'daily_review', label: 'Daily Review' },
];

/**
 * ORB tab — swipeable pager: Monitor | Strategy | Trade Log | Daily Review.
 * Each page reuses the existing standalone screen component directly
 * (monitor.tsx / strategy.tsx / tradelog.tsx / daily_review.tsx are still
 * real routes too, still reachable via router.push for deep links).
 */
export default function ORBTabScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Consume `section` exactly once, then strip it from the URL. Otherwise
  // it lingers in the route's params forever and every later refocus of this
  // tab (switching tabs away/back, or a stray refocus mid-swipe) re-applies
  // the old deep-link target and snaps the pager back to it — which is what
  // was happening when swiping fast kept getting yanked back to Strategy.
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
          case 'monitor': return <MonitorScreen />;
          case 'strategy': return <StrategyScreen embedded />;
          case 'tradelog': return <TradeLogScreen embedded />;
          case 'daily_review': return <DailyReviewScreen />;
          default: return null;
        }
      }}
    />
  );
}
