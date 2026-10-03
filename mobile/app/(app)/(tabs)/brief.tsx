import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, SafeAreaView, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMorningBrief } from '@/hooks/queries/brief/useMorningBrief';
import { BriefPlayCard } from '@/common/components/brief/BriefPlayCard';
import type { BriefPlay, MorningBrief } from '@/common/types/morningBrief';

interface Props {
  /** True inside the ORB tab's pager — hides the back arrow and title. */
  embedded?: boolean;
}

const PHASE_LABEL: Record<MorningBrief['phase'], string> = {
  build: 'Built 9:00 · re-scores 9:10 / 9:20 · locks 9:28',
  rescore: 'Re-scored · locks at 9:28',
  lock: 'Locked · entries 9:30–10:00',
};

/**
 * Morning Brief (TODO 8 part 2) — today's top-4 setups from
 * api/services/brief/brief_service.py. Each card shows the if/then setup
 * and, once a play triggers, its confirm card or limit-order tracker.
 * Tapping a play opens the Charts tab on that ticker with its trigger /
 * target / invalid lines drawn over the zones.
 */
export default function MorningBriefScreen({ embedded = false }: Props) {
  const colors = useThemeColors();
  const { data: brief, isLoading, error, refetch, dataUpdatedAt } = useMorningBrief();
  const [refreshing, setRefreshing] = useState(false);

  // Server-clock offset for the countdowns (confirm window, limit timeout).
  const clockOffsetMs = brief?.server_time ? brief.server_time * 1000 - dataUpdatedAt : 0;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  }, [refetch]);

  const openChart = useCallback((play: BriefPlay) => {
    router.push({ pathname: '/(app)/(tabs)/charts', params: { ticker: play.ticker } });
  }, []);

  const plays = brief?.plays ?? [];
  const live = plays.filter(p => ['checking', 'awaiting_confirmation', 'working'].includes(p.status));
  const rest = plays.filter(p => !live.includes(p));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {!embedded && (
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Morning Brief</Text>
          <View style={{ width: 22 }} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : error ? (
          <Empty icon="cloud-offline-outline" text={(error as Error).message} colors={colors} />
        ) : !brief ? (
          <Empty
            icon="sunny-outline"
            text="No brief yet today. It builds at 9:00 ET from your ORB-follow list and pushes the top 4 setups."
            colors={colors}
          />
        ) : (
          <>
            <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.summaryRow}>
                <Ionicons name={brief.locked ? 'lock-closed' : 'sunny'} size={14} color={brief.locked ? colors.accent : '#F59E0B'} />
                <Text style={[styles.summaryTitle, { color: colors.text }]}>{PHASE_LABEL[brief.phase]}</Text>
              </View>
              <Text style={[styles.summaryNote, { color: colors.textSecondary }]}>
                Paper only · score ≥ 80 + Technicals Gate ENTER · 0DTE · 2 losses ends the day · max 2 open
              </Text>
            </View>

            {brief.correlation_label ? (
              <View style={[styles.banner, { backgroundColor: '#F59E0B14', borderColor: '#F59E0B55' }]}>
                <Ionicons name="git-merge-outline" size={14} color="#F59E0B" />
                <Text style={[styles.bannerText, { color: '#F59E0B' }]}>{brief.correlation_label}</Text>
              </View>
            ) : null}

            {plays.length === 0 ? (
              <Empty icon="search-outline" text="No qualifying setups this morning." colors={colors} />
            ) : (
              <View style={{ gap: 12 }}>
                {[...live, ...rest].map(p => (
                  <BriefPlayCard key={p.ticker} play={p} colors={colors} clockOffsetMs={clockOffsetMs} onOpenChart={openChart} />
                ))}
              </View>
            )}

            {brief.blocked.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Blocked</Text>
                {brief.blocked.map(b => (
                  <View key={b.ticker} style={styles.blockedRow}>
                    <Text style={[styles.blockedTicker, { color: colors.text }]}>{b.ticker}</Text>
                    <Text style={[styles.blockedReason, { color: colors.textTertiary }]}>{b.reason}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Empty({ icon, text, colors }: { icon: keyof typeof Ionicons.glyphMap; text: string; colors: any }) {
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name={icon} size={32} color={colors.tabBarInactive} />
      <Text style={[styles.emptyText, { color: colors.tabBarInactive }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 14 },
  summary: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryTitle: { fontSize: 13, fontWeight: '700' },
  summaryNote: { fontSize: 11, lineHeight: 15 },
  banner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderRadius: 10, borderWidth: 1, padding: 10 },
  bannerText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  blockedRow: { flexDirection: 'row', gap: 10, alignItems: 'baseline' },
  blockedTicker: { fontSize: 13, fontWeight: '700', width: 56 },
  blockedReason: { fontSize: 12 },
  emptyWrap: { alignItems: 'center', paddingVertical: 40, gap: 10, paddingHorizontal: 24 },
  emptyText: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
