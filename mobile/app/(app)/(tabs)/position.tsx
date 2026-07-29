import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, SafeAreaView,
  TouchableOpacity, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAlpacaBothAccounts } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useLivePositionsData, LivePositionsBody } from '@/common/components/strategy/LivePositionsSection';

interface Props {
  /**
   * True when rendered as a SegmentedPager scene (Home/Accounts tabs) instead
   * of a standalone pushed route — hides the back arrow (there's nothing to
   * pop back to within a pager page) and the redundant title (the segment
   * pill above already names this page).
   */
  embedded?: boolean;
}

export default function PositionScreen({ embedded = false }: Props) {
  const colors = useThemeColors();
  const [mode, setMode] = useState<'live' | 'paper'>('live');

  // Deep-link from a notification tap (see NotificationNavigationService) —
  // consume `paper_mode` exactly once, same pattern as orb.tsx's `section`
  // param, so it doesn't keep re-applying on every later refocus.
  const { paper_mode: paperModeParam } = useLocalSearchParams<{ paper_mode?: string }>();
  useFocusEffect(
    useCallback(() => {
      if (paperModeParam != null) {
        setMode(paperModeParam === 'true' ? 'paper' : 'live');
        router.setParams({ paper_mode: undefined });
      }
    }, [paperModeParam]),
  );

  // Both accounts, each built from its own dedicated paper/live TradingClient
  // (unlike /strategy/account, which resolved to "whichever saved strategy
  // engine happens to be first" — unrelated to which account an active trade
  // was actually in, and the reason the balance shown here could silently be
  // the wrong account's the whole session). Picking by `mode` below means
  // this always matches what's actually being viewed.
  const { data: accounts } = useAlpacaBothAccounts();
  const account = accounts ? (mode === 'live' ? accounts.live : accounts.paper) : undefined;

  const positionsData = useLivePositionsData(mode);
  const { filteredPositions, liveByStrategy } = positionsData;
  const activeCount = filteredPositions.length;

  // Live-derived equity = cash (stable mid-trade, from the slow account poll)
  // + the sum of every open position's live market value. Falls back to a
  // position's static cost basis (entry_premium * qty * 100) for the brief
  // window before its socket delivers a first tick, and to the account's own
  // (slower) equity field entirely when nothing is open to aggregate.
  const liveDerivedEquity = useMemo(() => {
    if (!account?.available || filteredPositions.length === 0) return null;
    let sumMarketValue = 0;
    for (const pos of filteredPositions) {
      const live = liveByStrategy[pos.strategy_id];
      if (live?.market_value != null) {
        sumMarketValue += live.market_value;
      } else if (pos.entry_premium != null && pos.qty_remaining != null) {
        sumMarketValue += pos.entry_premium * pos.qty_remaining * 100;
      }
    }
    return account.cash + sumMarketValue;
  }, [account, filteredPositions, liveByStrategy]);

  const displayEquity = liveDerivedEquity ?? account?.equity ?? 0;
  const displayPnlToday =
    liveDerivedEquity != null && account?.last_equity != null
      ? liveDerivedEquity - account.last_equity
      : account?.pnl_today ?? 0;

  const toggleMode = () => setMode(m => (m === 'live' ? 'paper' : 'live'));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>

      {/* ── Sticky header ── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {embedded ? (
          <View style={styles.headerSide} />
        ) : (
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.headerSide}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
        )}

        <View style={styles.headerCenter}>
          {!embedded && <Text style={[styles.title, { color: colors.text }]}>Live Positions</Text>}
          {activeCount > 0 && (
            <View style={[styles.activeBadge, { backgroundColor: colors.success + '22' }]}>
              <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.activeBadgeText, { color: colors.success }]}>
                {activeCount} active
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          onPress={toggleMode}
          hitSlop={8}
          activeOpacity={0.75}
          style={[styles.activeBadge, { backgroundColor: (mode === 'live' ? '#30D158' : '#FF9F0A') + '22' }]}
        >
          <View style={[styles.liveDot, { backgroundColor: mode === 'live' ? '#30D158' : '#FF9F0A' }]} />
          <Text style={[styles.activeBadgeText, { color: mode === 'live' ? '#30D158' : '#FF9F0A' }]}>
            {mode === 'live' ? 'LIVE' : 'PAPER'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Account bar (sticky), horizontally scrollable — every data point
          lives in one row now. Not touchable: the header's LIVE/PAPER badge
          above is the only way to flip mode, so nothing here fights the
          scroll gesture. Day Trades stays last. ── */}
      {account?.available && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.accountBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
          contentContainerStyle={styles.accountBarContent}
        >
          <AccountStat
            label={mode === 'live' ? 'Live Equity' : 'Paper Equity'}
            value={`$${displayEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            color={mode === 'live' ? '#30D158' : '#FF9F0A'}
            colors={colors}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat
            label="Today P&L"
            value={`${displayPnlToday >= 0 ? '+' : ''}$${displayPnlToday.toFixed(2)}`}
            color={displayPnlToday >= 0 ? colors.success : colors.error}
            colors={colors}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Available Balance" value={`$${(account.available_balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Buying Power" value={`$${account.buying_power.toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Options BP" value={`$${(account.options_buying_power ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Long Value" value={`$${(account.long_market_value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Short Value" value={`$${(account.short_market_value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Cash" value={`$${account.cash.toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AccountStat label="Day Trades" value={String(account.day_trade_count ?? 0)} colors={colors} />
        </ScrollView>
      )}

      {/* ── Scrollable content — LivePositionsBody renders its own
          hidden-trades banner + position list/empty-state below. ── */}
      <ScrollView style={styles.contentScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <LivePositionsBody
          data={positionsData}
          mode={mode}
          colors={colors}
          emptySubtitle={mode === 'live'
            ? 'Active live positions will appear here in real time'
            : 'Active paper positions will appear here'}
        />
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const AccountStat = ({ label, value, color, colors }: any) => (
  <View style={styles.accountStat}>
    <Text style={[styles.acctLabel, { color: colors.tabBarInactive }]} numberOfLines={1}>
      {label}
    </Text>
    <Text
      style={[styles.acctValue, { color: color ?? colors.text }]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
    >
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1 },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
    flexShrink: 0,
  },
  headerSide:      { width: 36, alignItems: 'flex-start', justifyContent: 'center' },
  headerCenter:    { flex: 1, alignItems: 'center', gap: 4 },
  title:           { fontSize: 18, fontWeight: '700' },
  activeBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  activeBadgeText: { fontSize: 11, fontWeight: '600' },
  liveDot:         { width: 6, height: 6, borderRadius: 3 },

  // ── Account bar (scrollable) ──
  accountBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    height: 68,
    maxHeight: 68,
    minHeight: 68,
    // Pinned to exactly 68 regardless of sibling content — this bar was
    // stretching to fill leftover screen space (visibly centered inside a
    // much taller box) whenever the position list below it was short (0 or
    // 1 rows), since neither it nor the content ScrollView below had an
    // explicit flexGrow/flexShrink telling Yoga who actually owns the
    // remaining space.
    flexGrow: 0,
    flexShrink: 0,
  },
  accountBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  accountStat: { alignItems: 'center', minWidth: 88, paddingHorizontal: 6, flexShrink: 0 },
  acctLabel:   { fontSize: 9, lineHeight: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 3 },
  acctValue:   { fontSize: 14, lineHeight: 17, fontWeight: '700' },
  divider:     { width: StyleSheet.hairlineWidth, height: 28, flexShrink: 0 },

  // ── Scroll content ──
  // Explicit flex:1 so this ScrollView — not the fixed-height header/account
  // bar above it — is the thing that actually owns all leftover screen
  // space; flexGrow:1 on its contentContainerStyle is what lets the empty
  // state below correctly center within that space instead of collapsing
  // to its own intrinsic (tiny) size.
  contentScroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, flexGrow: 1 },
});
