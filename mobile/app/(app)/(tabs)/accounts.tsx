import React from 'react';
import {
  View, Text, ScrollView, SafeAreaView, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAlpacaBothAccounts } from '@/hooks/queries/strategy/useAlpacaAccounts';

export default function AccountsScreen() {
  const colors = useThemeColors();

  const { data, isLoading, refetch, isRefetching } = useAlpacaBothAccounts();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Trading Accounts</Text>
          <View style={{ width: 22 }} />
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* Paper Account */}
            <AccountCard
              label="Paper Trading"
              subtitle="Simulated — no real money"
              accentColor="#FF9F0A"
              account={data?.paper}
              colors={colors}
            />

            {/* Live Account */}
            <AccountCard
              label="Live Trading"
              subtitle="Real money — trade with caution"
              accentColor={colors.success}
              account={data?.live}
              colors={colors}
            />

            {/* Side-by-side P&L comparison */}
            {data?.paper?.available && data?.live?.available && (
              <ComparisonCard paper={data.paper} live={data.live} colors={colors} />
            )}

            <Text style={[styles.disclaimer, { color: colors.tabBarInactive }]}>
              Paper and Live account data shown above. Trading mode (paper vs live) is
              configured per-strategy in the ORB Strategy screen.
            </Text>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

interface AccountCardProps {
  label: string;
  subtitle: string;
  accentColor: string;
  account?: { available: boolean; equity?: number; cash?: number; buying_power?: number; pnl_today?: number; pnl_today_pct?: number; day_trade_count?: number; error?: string };
  colors: any;
}

const AccountCard: React.FC<AccountCardProps> = ({
  label, subtitle, accentColor, account, colors,
}) => {
  const unavailable = !account?.available;
  const pnl    = account?.pnl_today ?? 0;
  const pnlPct = account?.pnl_today_pct ?? 0;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Card header */}
      <View style={styles.cardHeader}>
        <View>
          <View style={styles.labelRow}>
            <View style={[styles.dot, { backgroundColor: accentColor }]} />
            <Text style={[styles.cardLabel, { color: colors.text }]}>{label}</Text>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.tabBarInactive }]}>{subtitle}</Text>
        </View>
      </View>

      {unavailable ? (
        <View style={styles.unavailableRow}>
          <Ionicons name="warning-outline" size={16} color={colors.warning} />
          <Text style={[styles.unavailableText, { color: colors.warning }]}>
            {account?.error?.includes('403') || account?.error?.includes('401')
              ? 'API credentials not authorised for this account type'
              : 'Account unavailable — check API key permissions'}
          </Text>
        </View>
      ) : (
        <>
          {/* Main equity */}
          <Text style={[styles.equity, { color: colors.text }]}>
            ${(account?.equity ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </Text>
          <View style={styles.pnlRow}>
            <Text style={[styles.pnlValue, { color: pnlColor }]}>
              {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
            </Text>
            <Text style={[styles.pnlPct, { color: pnlColor }]}>
              ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
            </Text>
            <Text style={[styles.pnlLabel, { color: colors.tabBarInactive }]}> today</Text>
          </View>

          {/* Stats row */}
          <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
            <Stat label="Cash" value={`$${(account?.cash ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
            <Stat label="Buying Power" value={`$${(account?.buying_power ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} colors={colors} />
            <Stat label="Day Trades" value={String(account?.day_trade_count ?? 0)} colors={colors} />
          </View>
        </>
      )}
    </View>
  );
};

const ComparisonCard = ({ paper, live, colors }: any) => {
  const paperPnl = paper.pnl_today ?? 0;
  const livePnl  = live.pnl_today  ?? 0;
  const diff     = livePnl - paperPnl;

  return (
    <View style={[styles.compCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.compTitle, { color: colors.tabBarInactive }]}>{"TODAY'S P&L COMPARISON"}</Text>
      <View style={styles.compRow}>
        <CompStat label="Paper" value={paperPnl} colors={colors} />
        <View style={[styles.compDivider, { backgroundColor: colors.border }]} />
        <CompStat label="Live" value={livePnl} colors={colors} />
        <View style={[styles.compDivider, { backgroundColor: colors.border }]} />
        <CompStat label="Difference" value={diff} colors={colors} />
      </View>
    </View>
  );
};

const CompStat = ({ label, value, colors }: { label: string; value: number; colors: any }) => (
  <View style={styles.compStat}>
    <Text style={[styles.compLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[styles.compValue, { color: value >= 0 ? colors.success : colors.error }]}>
      {value >= 0 ? '+' : ''}${value.toFixed(2)}
    </Text>
  </View>
);

const Stat = ({ label, value, colors }: { label: string; value: string; colors: any }) => (
  <View style={styles.stat}>
    <Text style={[styles.statLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title:     { fontSize: 20, fontWeight: '700' },

  card:         { borderRadius: 16, padding: 16, gap: 10 },
  cardHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  labelRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  dot:          { width: 9, height: 9, borderRadius: 5 },
  cardLabel:    { fontSize: 17, fontWeight: '700' },
  cardSubtitle: { fontSize: 12 },

  unavailableRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
  unavailableText: { fontSize: 12, flex: 1 },

  equity:   { fontSize: 30, fontWeight: '700' },
  pnlRow:   { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  pnlValue: { fontSize: 16, fontWeight: '700' },
  pnlPct:   { fontSize: 14, fontWeight: '600' },
  pnlLabel: { fontSize: 12 },

  statsRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 0 },
  stat:     { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 10, marginBottom: 3 },
  statValue: { fontSize: 13, fontWeight: '600' },

  compCard:  { borderRadius: 14, borderWidth: 1, padding: 14 },
  compTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  compRow:   { flexDirection: 'row', alignItems: 'center' },
  compDivider: { width: StyleSheet.hairlineWidth, height: 36, marginHorizontal: 8 },
  compStat:  { flex: 1, alignItems: 'center' },
  compLabel: { fontSize: 11, marginBottom: 4 },
  compValue: { fontSize: 16, fontWeight: '700' },

  disclaimer: { fontSize: 11, lineHeight: 17, marginTop: 4 },
});
