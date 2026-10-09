import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, SafeAreaView,
  TouchableOpacity, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useThemeColors } from '@/lib/useColorScheme';
import { useLiveEquity } from '@/hooks/queries/strategy/useLiveEquity';
import { useLivePositionsData, type UseLivePositionsDataResult } from '@/common/components/strategy/LivePositionsSection';
import { BriefPositionsBody } from '@/common/components/home/BriefPositionsBody';
import { useWheelTabBarHeight } from '@/common/components/ui/WheelTabBar';

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
  // The 0.7 tab bar floats over this screen — clear its full height.
  const tabBarHeight = useWheelTabBarHeight() + 12;

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

  // Live Equity (cash + open positions' market value) comes from the shared
  // hook so the Home account card shows exactly this figure. The hook picks
  // the account by `mode`, so this always matches what's actually being
  // viewed (never "whichever engine happened to be first").
  const { account, liveDerivedEquity, displayEquity } = useLiveEquity(mode);

  const positionsData = useLivePositionsData(mode);
  const { filteredPositions } = positionsData;
  const activeCount = filteredPositions.length;

  const displayPnlToday =
    liveDerivedEquity != null && account?.last_equity != null
      ? liveDerivedEquity - account.last_equity
      : account?.pnl_today ?? 0;

  // Cost basis only (entry_premium, never a live price) — deliberately
  // static, so it only moves when a position actually opens/closes/partial-
  // closes (i.e. when filteredPositions itself changes), not on every price
  // tick like the equity/PnL figures above it.
  const capitalUsed = useMemo(
    () => filteredPositions.reduce(
      (sum, p) => sum + (p.entry_premium ?? 0) * (p.qty_remaining ?? 0) * 100, 0,
    ),
    [filteredPositions],
  );

  const toggleMode = () => setMode(m => (m === 'live' ? 'paper' : 'live'));

  // Home (embedded): live AND paper together — live first — with each card
  // badged LIVE/PAPER, instead of a toggle between the two lists.
  const liveSide = useLivePositionsData('live');
  const paperSide = useLivePositionsData('paper');
  // The hook returns a fresh object every render, so fan-out callbacks must
  // depend on its (stable) inner callbacks — otherwise each card's
  // onLiveUpdate effect refires every render and setStates in a loop.
  const { handleLiveUpdate: liveHandleLiveUpdate, setShowHidden: liveSetShowHidden } = liveSide;
  const { handleLiveUpdate: paperHandleLiveUpdate, setShowHidden: paperSetShowHidden } = paperSide;
  const combinedHandleLiveUpdate = useCallback<UseLivePositionsDataResult['handleLiveUpdate']>((id, d) => {
    liveHandleLiveUpdate(id, d);
    paperHandleLiveUpdate(id, d);
  }, [liveHandleLiveUpdate, paperHandleLiveUpdate]);
  const combinedSetShowHidden = useCallback<UseLivePositionsDataResult['setShowHidden']>((v) => {
    liveSetShowHidden(v);
    paperSetShowHidden(v);
  }, [liveSetShowHidden, paperSetShowHidden]);
  const combinedData: UseLivePositionsDataResult = useMemo(() => ({
    isLoading: liveSide.isLoading || paperSide.isLoading,
    filteredPositions: [...liveSide.filteredPositions, ...paperSide.filteredPositions],
    displayedPositions: [...liveSide.displayedPositions, ...paperSide.displayedPositions],
    hiddenCount: liveSide.hiddenCount + paperSide.hiddenCount,
    showHidden: liveSide.showHidden,
    setShowHidden: combinedSetShowHidden,
    liveByStrategy: { ...liveSide.liveByStrategy, ...paperSide.liveByStrategy },
    handleLiveUpdate: combinedHandleLiveUpdate,
  }), [liveSide, paperSide, combinedSetShowHidden, combinedHandleLiveUpdate]);

  const positionsBody = (
    <BriefPositionsBody
      data={positionsData}
      mode={mode}
      colors={colors}
      emptySubtitle={mode === 'live'
        ? 'Active live positions will appear here in real time'
        : 'Active paper positions will appear here'}
    />
  );

  // Embedded on Home (inside the feed's own ScrollView, under the dynamic
  // card) — no inner ScrollView, the parent scrolls. Standalone keeps its
  // own scroll container.
  if (embedded) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <BriefPositionsBody
            data={combinedData}
            colors={colors}
            emptySubtitle="Live and paper positions will appear here in real time"
          />
        </View>
      </View>
    );
  }

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
          <AccountStat label="Capital Used" value={`$${capitalUsed.toLocaleString('en-US', { minimumFractionDigits: 0 })}`} color="#CC5500" colors={colors} />
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

      {/* ── Scrollable content — BriefPositionsBody renders its own
          hidden-trades banner + brief-style position cards below. ── */}
      <ScrollView style={styles.contentScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {positionsBody}
        <View style={{ height: tabBarHeight }} />
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
