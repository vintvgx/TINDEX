import React, { useState, useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SegmentedPager } from '@/common/components/ui/SegmentedPager';
import AlpacaScreen from './alpaca_overview';
import RobinhoodScreen from './robinhood_overview';

const ROUTES = [
  { key: 'alpaca', label: 'Alpaca' },
  { key: 'robinhood', label: 'Robin Hood' },
];

/**
 * Accounts tab — swipeable pager by broker: Alpaca | Robin Hood. Alpaca
 * itself folds the account Summary and Live Positions views together (see
 * alpaca_overview.tsx) since both were Alpaca-only content previously
 * surfaced as separate top-level segments here.
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
          case 'alpaca': return <AlpacaScreen embedded />;
          case 'robinhood': return <RobinhoodScreen embedded />;
          default: return null;
        }
      }}
    />
  );
}
