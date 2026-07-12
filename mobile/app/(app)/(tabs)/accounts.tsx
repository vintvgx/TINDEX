import React, { useState, useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SegmentedPager } from '@/common/components/ui/SegmentedPager';
import AccountsOverviewScreen from './accounts_overview';
import PositionScreen from './position';

const ROUTES = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'positions', label: 'Live Positions' },
];

/**
 * Accounts tab — swipeable pager: Accounts | Live Positions. Live Positions
 * reuses the exact same PositionScreen component as Home's pager (it's a
 * self-contained "all open positions" view, not tied to how you got there).
 */
export default function AccountsTabScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Consume `section` exactly once, then strip it from the URL — see orb.tsx
  // for why (stale deep-link params re-snapping the pager on later refocus).
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
          case 'accounts': return <AccountsOverviewScreen embedded />;
          case 'positions': return <PositionScreen embedded />;
          default: return null;
        }
      }}
    />
  );
}
