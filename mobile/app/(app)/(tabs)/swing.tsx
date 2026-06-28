import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
  ScrollView, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useSwingScores } from '@/hooks/queries/swing/useSwingScores';
import { useSwingWatchlist } from '@/hooks/queries/swing/useSwingWatchlist';
import { useSwingPositions } from '@/hooks/queries/swing/useSwingPositions';
import { useSwingRunLogs } from '@/hooks/queries/swing/useSwingRunLogs';
import {
  useRunSwingPipeline,
  useAddSwingWatchlist,
  useRemoveSwingWatchlist,
  useEnterSwingPosition,
  useExitSwingPosition,
} from '@/hooks/mutations/swing/useSwingMutations';
import { useUpdateSwingExits } from '@/hooks/mutations/swing/useUpdateSwingExits';
import { EditExitsModal, type CurrentExits } from '@/common/components/shared/EditExitsModal';
import { SwingOpportunityCard } from '@/common/components/swing/SwingOpportunityCard';
import { SwingDetailModal } from '@/common/components/swing/SwingDetailModal';
import { SwingEnterModal } from '@/common/components/swing/SwingEnterModal';
import { SwingPositionCard } from '@/common/components/swing/SwingPositionCard';
import type { SwingScore, SwingPosition } from '@/common/types/swing';

type Screen = 'Dashboard' | 'Watchlist' | 'Positions' | 'Logs' | 'About';
const NAV_ITEMS: { id: Screen; icon: string; label: string }[] = [
  { id: 'Dashboard', icon: 'pulse-outline', label: 'Scan' },
  { id: 'Watchlist', icon: 'bookmark-outline', label: 'Watchlist' },
  { id: 'Positions', icon: 'bar-chart-outline', label: 'Positions' },
  { id: 'Logs', icon: 'document-text-outline', label: 'Logs' },
  { id: 'About', icon: 'information-circle-outline', label: 'About' },
];

export default function SwingScreen() {
  const colors = useThemeColors();
  const { authState: { user } } = useAuth();
  const [screen, setScreen] = useState<Screen>('Dashboard');
  const [detailItem, setDetailItem] = useState<SwingScore | null>(null);
  const [enterItem, setEnterItem] = useState<SwingScore | null>(null);

  const userId = user?.id;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Screen header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', flex: 1 }}>
            Swing Trade
          </Text>
          <View style={{ backgroundColor: '#8B5CF622', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: '#8B5CF6', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>BETA</Text>
          </View>
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
          Multi-day options flow intelligence
        </Text>
      </View>

      {/* Top nav */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border, paddingHorizontal: 4 }}>
        {NAV_ITEMS.map((n) => (
          <TouchableOpacity
            key={n.id}
            onPress={() => setScreen(n.id)}
            style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: screen === n.id ? colors.accent : 'transparent' }}
          >
            <Ionicons name={n.icon as any} size={18} color={screen === n.id ? colors.accent : colors.textSecondary} />
            <Text style={{ color: screen === n.id ? colors.accent : colors.textSecondary, fontSize: 10, marginTop: 2, fontWeight: '600' }}>
              {n.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {screen === 'Dashboard' && (
          <DashboardScreen
            colors={colors}
            userId={userId ?? ''}
            onPressItem={setDetailItem}
            onEnter={setEnterItem}
          />
        )}
        {screen === 'Watchlist' && (
          <WatchlistScreen colors={colors} userId={userId} onEnter={setEnterItem} />
        )}
        {screen === 'Positions' && (
          <PositionsScreen colors={colors} userId={userId ?? ''} />
        )}
        {screen === 'Logs' && <LogsScreen colors={colors} />}
        {screen === 'About' && <AboutScreen colors={colors} />}
      </View>

      {/* Modals */}
      <SwingDetailModal
        item={detailItem}
        visible={!!detailItem}
        onClose={() => setDetailItem(null)}
        onEnter={(item) => { setDetailItem(null); setEnterItem(item); }}
        onWatch={(item) => {
          setDetailItem(null);
          Alert.alert('Added to watchlist', item.ticker);
        }}
      />
      <EnterFlow item={enterItem} userId={userId ?? ''} onClose={() => setEnterItem(null)} />
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────
// Dashboard
// ──────────────────────────────────────────────
function DashboardScreen({
  colors, userId, onPressItem, onEnter,
}: {
  colors: ReturnType<typeof useThemeColors>;
  userId: string;
  onPressItem: (item: SwingScore) => void;
  onEnter: (item: SwingScore) => void;
}) {
  const { data, isLoading, isFetching, refetch } = useSwingScores();
  const addWatch = useAddSwingWatchlist(userId);
  const runPipeline = useRunSwingPipeline();

  const scores = data?.data ?? [];
  const tierCounts = scores.reduce<Record<string, number>>((acc, s) => {
    acc[s.tier] = (acc[s.tier] ?? 0) + 1;
    return acc;
  }, {});

  const handleRunPipeline = () => {
    runPipeline.mutate(undefined, {
      onSuccess: () => Alert.alert('Pipeline complete', 'Swing scan finished. Pull to refresh.'),
      onError: (e) => Alert.alert('Error', (e as Error).message),
    });
  };

  return (
    <FlatList
      data={scores}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => (
        <SwingOpportunityCard
          item={item}
          onPress={onPressItem}
          onWatch={(s) => addWatch.mutate({ contract_symbol: s.contract_symbol, ticker: s.ticker })}
        />
      )}
      refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={() => refetch()} tintColor={colors.accent} />}
      contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      ListHeaderComponent={() => (
        <View style={{ marginBottom: 14 }}>
          {/* Stats row */}
          {data && (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {(['Prime', 'Strong', 'Watch'] as const).map((tier) => (
                <View key={tier} style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>
                    {tierCounts[tier] ?? 0}
                  </Text>
                  <Text style={{ color: colors.textTertiary, fontSize: 10, marginTop: 2 }}>{tier}</Text>
                </View>
              ))}
            </View>
          )}
          {/* Run pipeline button */}
          <TouchableOpacity
            onPress={handleRunPipeline}
            disabled={runPipeline.isPending}
            style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, marginBottom: 4 }}
          >
            {runPipeline.isPending ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons name="refresh-outline" size={16} color={colors.accent} />
            )}
            <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600' }}>
              {runPipeline.isPending ? 'Scanning…' : 'Run New Scan'}
            </Text>
          </TouchableOpacity>
          {data?.scan_date && (
            <Text style={{ color: colors.textTertiary, fontSize: 11, textAlign: 'center', marginBottom: 8 }}>
              Scan date: {data.scan_date} · {scores.length} opportunities
            </Text>
          )}
        </View>
      )}
      ListEmptyComponent={() => (
        isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={{ color: colors.textSecondary, marginTop: 12 }}>Loading opportunities…</Text>
          </View>
        ) : (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Ionicons name="analytics-outline" size={40} color={colors.textTertiary} />
            <Text style={{ color: colors.textSecondary, marginTop: 12, textAlign: 'center' }}>
              No opportunities found.{'\n'}Tap "Run New Scan" to analyze today's flow.
            </Text>
          </View>
        )
      )}
    />
  );
}

// ──────────────────────────────────────────────
// Watchlist
// ──────────────────────────────────────────────
function WatchlistScreen({
  colors, userId, onEnter,
}: {
  colors: ReturnType<typeof useThemeColors>;
  userId: string;
  onEnter: (item: SwingScore) => void;
}) {
  const { data, isLoading, isFetching, refetch } = useSwingWatchlist(userId);
  const remove = useRemoveSwingWatchlist(userId);
  const items = data?.data ?? [];

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={() => refetch()} tintColor={colors.accent} />}
      contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      renderItem={({ item }) => (
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{item.ticker}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{item.contract_symbol}</Text>
              {item.latest_score && (
                <Text style={{ color: colors.accent, fontSize: 12, marginTop: 2 }}>
                  Score: {item.latest_score.composite_score?.toFixed(0)} · {item.latest_score.tier}
                </Text>
              )}
            </View>
            {item.latest_score && (
              <TouchableOpacity
                onPress={() => onEnter(item.latest_score!)}
                style={{ backgroundColor: '#10B98122', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 }}
              >
                <Text style={{ color: '#10B981', fontSize: 12, fontWeight: '600' }}>Enter</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => remove.mutate(item.id)}>
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>
      )}
      ListEmptyComponent={() => (
        isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Ionicons name="bookmark-outline" size={40} color={colors.textTertiary} />
            <Text style={{ color: colors.textSecondary, marginTop: 12, textAlign: 'center' }}>
              No contracts in watchlist.{'\n'}Add from the Scan tab.
            </Text>
          </View>
        )
      )}
    />
  );
}

// ──────────────────────────────────────────────
// Positions
// ──────────────────────────────────────────────
function PositionsScreen({
  colors, userId,
}: {
  colors: ReturnType<typeof useThemeColors>;
  userId: string;
}) {
  const { data, isLoading, isFetching, refetch } = useSwingPositions(userId);
  const exitMutation = useExitSwingPosition(userId);
  const updateExits = useUpdateSwingExits();
  const positions = data?.data ?? [];
  const [editPosition, setEditPosition] = useState<SwingPosition | null>(null);

  const handleExit = (p: SwingPosition) => {
    Alert.alert('Close position?', `Close ${p.qty} contract(s) of ${p.ticker}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close',
        style: 'destructive',
        onPress: () => exitMutation.mutate({ position_id: p.id }),
      },
    ]);
  };

  const currentExits = (p: SwingPosition): CurrentExits => {
    const sc = (p.stop_config as Record<string, number> | null) ?? {};
    const tp = (p.tp_ladder as Array<{ level: string; price?: number; pct?: number; hit?: boolean }> | null) ?? [];
    const entry = p.entry_price ?? 0;
    const tp1Rung = tp.find(r => r.level === 'TP1');
    const tp2Rung = tp.find(r => r.level === 'TP2');
    return {
      entry_premium: entry,
      hard_stop: sc.override_hard_stop ?? sc.effective_stop ?? entry * 0.7,
      tp1: tp1Rung?.price ?? entry * (1 + (tp1Rung?.pct ?? 0.15)),
      tp2: tp2Rung ? (tp2Rung.price ?? entry * (1 + (tp2Rung.pct ?? 0.30))) : undefined,
      tp1_hit: tp1Rung?.hit,
      tp2_hit: tp2Rung?.hit,
    };
  };

  const handleSubmitExits = async (payload: { hard_stop?: number; tp1_pct?: number; tp2_pct?: number }) => {
    if (!editPosition) return;
    await updateExits.mutateAsync({ position_id: editPosition.id, user_id: userId, ...payload });
    Alert.alert('Updated', 'Stop loss and targets saved.');
    setEditPosition(null);
  };

  return (
    <>
      <FlatList
        data={positions}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={() => refetch()} tintColor={colors.accent} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        renderItem={({ item }) => (
          <SwingPositionCard position={item} onExit={handleExit} onEditExits={setEditPosition} />
        )}
        ListEmptyComponent={() => (
          isLoading ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Ionicons name="bar-chart-outline" size={40} color={colors.textTertiary} />
              <Text style={{ color: colors.textSecondary, marginTop: 12, textAlign: 'center' }}>
                No open positions.{'\n'}Enter a trade from the Scan tab.
              </Text>
            </View>
          )
        )}
      />
      {editPosition && (
        <EditExitsModal
          visible={!!editPosition}
          onClose={() => setEditPosition(null)}
          mode="swing"
          positionId={editPosition.id}
          userId={userId}
          ticker={editPosition.ticker}
          current={currentExits(editPosition)}
          onSubmit={handleSubmitExits}
          isLoading={updateExits.isPending}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────
// Logs
// ──────────────────────────────────────────────
function LogsScreen({ colors }: { colors: ReturnType<typeof useThemeColors> }) {
  const { data, isLoading, isFetching, refetch } = useSwingRunLogs(20);
  const logs = data?.data ?? [];

  const fmtDuration = (sec: number) => sec >= 60 ? `${(sec / 60).toFixed(1)}m` : `${sec.toFixed(0)}s`;

  return (
    <FlatList
      data={logs}
      keyExtractor={(l) => l.id}
      refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={() => refetch()} tintColor={colors.accent} />}
      contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      ListHeaderComponent={() => (
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 }}>
          PIPELINE RUN HISTORY
        </Text>
      )}
      renderItem={({ item }) => (
        <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700', flex: 1 }}>{item.scan_date}</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{fmtDuration(item.duration_sec)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <LogStat label="UW Raw" value={item.uw_flows_raw} colors={colors} />
            <LogStat label="Eligible" value={item.swing_eligible} colors={colors} />
            <LogStat label="Candidates" value={item.candidates} colors={colors} />
            <LogStat label="Scored" value={item.scored} colors={colors} />
            <LogStat label="Surfaced" value={item.surfaced} colors={colors} accent />
          </View>
        </View>
      )}
      ListEmptyComponent={() => (
        isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary }}>No pipeline runs yet.</Text>
          </View>
        )
      )}
    />
  );
}

function LogStat({ label, value, colors, accent = false }: {
  label: string; value: number; colors: ReturnType<typeof useThemeColors>; accent?: boolean;
}) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: accent ? colors.accent : colors.text, fontSize: 14, fontWeight: '700' }}>{value ?? 0}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 10, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

// ──────────────────────────────────────────────
// About
// ──────────────────────────────────────────────
function AboutScreen({ colors }: { colors: ReturnType<typeof useThemeColors> }) {
  const sections = [
    {
      title: 'How It Works',
      content: 'The swing scanner fetches the latest unusual options flow from Unusual Whales and filters for contracts with 30–90 days to expiry — the sweet spot for multi-day momentum trades.\n\nEach contract is scored on two dimensions:\n\n• Setup Score (45%) — EMA alignment, trend direction, RSI position, MACD signal\n• Flow Score (55%) — dollar flow size, vol/OI ratio, aggressor side, sweep/floor classification, UW unusual score\n\nContracts are ranked and the top 20 are surfaced daily.',
    },
    {
      title: 'Tier Definitions',
      content: '🥇 Prime (90+) — Exceptional setup AND flow convergence. Highest conviction.\n\n💎 Strong (75–89) — Solid on both dimensions, worth active monitoring.\n\n👁 Watch (60–74) — Emerging signal, lower conviction. Monitor before entering.',
    },
    {
      title: 'Risk Profiles',
      content: 'Conservative — Tight ATR stop, scale out 40% at +15%, ratchet breakeven, trail the rest.\n\nRunner — Wide stop, small early trim, ride the momentum with a 20% trailing stop.\n\nDefined Risk — Debit spread structure, max loss known upfront, target 50% of spread value.\n\nScalp Swing — Fixed % stop, full close at +25%, no overnight runners.',
    },
    {
      title: 'Data Sources',
      content: '• Unusual Whales API — Flow alerts, sweep detection, aggressor tagging\n• yfinance — Daily price bars for technical scoring (EMA, RSI, MACD)\n• Alpaca — Live/paper order execution\n\nPipeline runs nightly after market close. You can also trigger a manual scan.',
    },
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
      {sections.map((s) => (
        <View key={s.title} style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 8 }}>{s.title}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>{s.content}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ──────────────────────────────────────────────
// Enter position flow (wired to mutation)
// ──────────────────────────────────────────────
function EnterFlow({ item, userId, onClose }: { item: SwingScore | null; userId: string; onClose: () => void }) {
  const enterMutation = useEnterSwingPosition(userId);

  const handleSubmit = (payload: Parameters<typeof enterMutation.mutate>[0]) => {
    enterMutation.mutate(payload, {
      onSuccess: () => {
        onClose();
        Alert.alert('Position entered', `${payload.mode === 'live' ? 'Live' : 'Paper'} ${payload.side.toUpperCase()} position opened for ${payload.ticker}.`);
      },
      onError: (e) => Alert.alert('Error', (e as Error).message),
    });
  };

  return (
    <SwingEnterModal
      item={item}
      visible={!!item}
      onClose={onClose}
      onSubmit={handleSubmit}
      isLoading={enterMutation.isPending}
    />
  );
}
