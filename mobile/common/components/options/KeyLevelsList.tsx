import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useKeyLevels } from '@/hooks/queries/priceLevels/useKeyLevels';
import { useCancelKeyLevel } from '@/hooks/mutations/priceLevels/useCancelKeyLevel';
import { useTrackContract } from '@/hooks/mutations/track/useTrackContract';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useToast } from '@/common/components/ui/Toast';
import { useBaseNavigation } from '@/hooks/navigation/useBaseNavigation';
import { TickerLogo } from '@/common/components/ui/TickerLogo';
import { AddKeyLevelSheet } from './AddKeyLevelSheet';
import type { WatchedPriceLevel, LevelSuggestedContract } from '@/common/types/priceLevels';

const fmtLevel = (low: number, high: number) =>
  low === high ? `$${low.toFixed(2)}` : `$${low.toFixed(2)} – $${high.toFixed(2)}`;

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
};

const STATUS_COLOR: Record<WatchedPriceLevel['status'], (c: ReturnType<typeof useThemeColors>) => string> = {
  watching: c => c.accent,
  confirmed: c => c.success,
  expired: c => c.textTertiary,
  cancelled: c => c.textTertiary,
};

const SIGNAL_COLORS: Record<string, string> = {
  STRONG_BUY: '#00c853',
  BUY: '#4caf50',
  HOLD: '#ff9800',
  SELL: '#f44336',
  STRONG_SELL: '#b71c1c',
};

// ─── One suggested-contract row within a confirmed level's card ───────────────

const SuggestionRow: React.FC<{
  suggestion: LevelSuggestedContract;
  level: WatchedPriceLevel;
  colors: ReturnType<typeof useThemeColors>;
}> = ({ suggestion, level, colors }) => {
  const { authState: { user } } = useAuth();
  const { mutate: track, isPending, isSuccess } = useTrackContract();
  const toast = useToast();
  const { contract, score, signal, reasoning, pinned } = suggestion;
  const isCall = contract.option_type === 'CALL';
  const typeColor = isCall ? colors.success : colors.error;

  const handleTrack = () => {
    if (!user?.id) return;
    track(
      {
        userId: user.id,
        ticker: level.ticker,
        contractSymbol: contract.symbol,
        optionType: contract.option_type,
        strike: contract.strike,
        expirationDate: contract.expiration,
        trackingSnapshot: contract,
        trackedFromSource: 'manual',
        trackingReason: `Key level confirm: ${level.ticker} ${level.direction} ${fmtLevel(level.level_low, level.level_high)}`,
      },
      {
        onSuccess: () => toast.success(`Watchlisted ${contract.symbol}`),
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  return (
    <View style={[sug.row, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {pinned && <Ionicons name="pricetag" size={11} color={colors.accent} />}
          <View style={[sug.badge, { backgroundColor: typeColor + '20', borderColor: typeColor + '40' }]}>
            <Text style={[sug.badgeText, { color: typeColor }]}>{contract.option_type}</Text>
          </View>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
            ${contract.strike % 1 === 0 ? contract.strike.toFixed(0) : contract.strike.toFixed(2)}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{contract.expiration}</Text>
        </View>
        {score != null && signal ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}>
            <View style={[sug.scoreBadge, { backgroundColor: (SIGNAL_COLORS[signal] ?? colors.accent) + '20' }]}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: SIGNAL_COLORS[signal] ?? colors.accent }}>
                {score}/100
              </Text>
            </View>
            {reasoning ? (
              <Text style={{ color: colors.textTertiary, fontSize: 11, flex: 1 }} numberOfLines={1}>
                {reasoning}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <TouchableOpacity
        onPress={handleTrack}
        disabled={isPending || isSuccess}
        activeOpacity={0.8}
        style={[sug.trackBtn, {
          backgroundColor: isSuccess ? colors.success + '18' : colors.accent + '18',
          borderColor: isSuccess ? colors.success + '44' : colors.accent + '44',
        }]}
      >
        {isPending ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Ionicons
            name={isSuccess ? 'checkmark' : 'add-circle-outline'}
            size={16}
            color={isSuccess ? colors.success : colors.accent}
          />
        )}
      </TouchableOpacity>
    </View>
  );
};

const sug = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 6 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  scoreBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  trackBtn: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

// ─── Level card ─────────────────────────────────────────────────────────────

const LevelCard: React.FC<{
  level: WatchedPriceLevel;
  colors: ReturnType<typeof useThemeColors>;
  onCancel: () => void;
  isCancelling: boolean;
}> = ({ level, colors, onCancel, isCancelling }) => {
  const { toTicker } = useBaseNavigation();
  const isBullish = level.direction === 'bullish';
  const dirColor = isBullish ? colors.success : colors.error;
  const statusColor = STATUS_COLOR[level.status](colors);

  return (
    <View style={[lc.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={lc.headerRow}>
        <TouchableOpacity onPress={() => toTicker(level.ticker)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TickerLogo
            uri={`https://financialmodelingprep.com/image-stock/${level.ticker.toUpperCase()}.png`}
            ticker={level.ticker}
            size={18}
          />
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>{level.ticker}</Text>
          <Ionicons name={isBullish ? 'trending-up' : 'trending-down'} size={14} color={dirColor} />
        </TouchableOpacity>
        <View style={[lc.statusPill, { backgroundColor: statusColor + '18', borderColor: statusColor + '40' }]}>
          <Text style={{ color: statusColor, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }}>
            {level.status}
          </Text>
        </View>
      </View>

      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 6 }}>
        {fmtLevel(level.level_low, level.level_high)}
      </Text>
      <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>
        {isBullish ? 'Confirms on close above' : 'Confirms on close below'} · {level.source === 'discord_admin' ? 'Discord admin' : 'Self-found'}
        {level.status === 'confirmed' && level.confirmed_price != null
          ? ` · Confirmed @ $${level.confirmed_price.toFixed(2)}${level.confirmed_at ? ` (${fmtDate(level.confirmed_at)})` : ''}`
          : ''}
      </Text>

      {level.notes ? (
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6 }} numberOfLines={2}>
          {level.notes}
        </Text>
      ) : null}

      {level.status === 'confirmed' && (
        <View style={{ marginTop: 8 }}>
          {(level.suggested_contracts ?? []).length === 0 ? (
            <Text style={{ color: colors.textTertiary, fontSize: 12, fontStyle: 'italic' }}>
              No contract suggestions were found for this confirm.
            </Text>
          ) : (
            level.suggested_contracts!.map(s => (
              <SuggestionRow key={s.contract.symbol} suggestion={s} level={level} colors={colors} />
            ))
          )}
        </View>
      )}

      {(level.status === 'watching' || level.status === 'confirmed') && (
        <TouchableOpacity
          onPress={onCancel}
          disabled={isCancelling}
          hitSlop={8}
          style={[lc.cancelBtn, { borderColor: colors.error + '40' }]}
        >
          {isCancelling
            ? <ActivityIndicator size="small" color={colors.error} />
            : <Ionicons name="trash-outline" size={13} color={colors.error} />}
          <Text style={{ color: colors.error, fontSize: 12, fontWeight: '600' }}>
            {level.status === 'watching' ? 'Stop watching' : 'Dismiss'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const lc = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, marginHorizontal: 16, marginBottom: 10, padding: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  cancelBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    marginTop: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
  },
});

// ─── Main list ──────────────────────────────────────────────────────────────

interface Props {
  activeTicker?: string;
}

export const KeyLevelsList: React.FC<Props> = ({ activeTicker }) => {
  const colors = useThemeColors();
  const { data: levels, isLoading, refetch } = useKeyLevels();
  const { mutate: cancel, isPending: isCancelling, variables: cancellingId } = useCancelKeyLevel();
  const [addOpen, setAddOpen] = useState(false);
  const toast = useToast();

  const handleCancel = useCallback((id: string) => {
    cancel(id, {
      onSuccess: () => toast.info('Key level removed'),
      onError: (err: Error) => toast.error(err.message),
    });
  }, [cancel, toast]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
        <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 10 }}>Loading key levels…</Text>
      </View>
    );
  }

  const activeLevels = (levels ?? []).filter(l => l.status !== 'cancelled');

  return (
    <>
      <FlatList
        data={activeLevels}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 200 }}
        ListHeaderComponent={
          activeLevels.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 }}>
              <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '600' }}>
                {activeLevels.length} KEY LEVEL{activeLevels.length !== 1 ? 'S' : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => refetch()}
                  hitSlop={8}
                  style={[ls.headerBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  <Ionicons name="refresh-outline" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setAddOpen(true)}
                  style={[ls.headerBtn, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '44' }]}
                >
                  <Ionicons name="add" size={14} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={ls.empty}>
            <View style={[ls.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="analytics-outline" size={32} color={colors.textSecondary} />
            </View>
            <Text style={[ls.emptyTitle, { color: colors.text }]}>No key levels yet</Text>
            <Text style={[ls.emptySubtitle, { color: colors.textSecondary }]}>
              Watch a price level from a flow call or your own read — you'll get scored
              contract suggestions the moment a candle confirms it.
            </Text>
            <TouchableOpacity
              onPress={() => setAddOpen(true)}
              activeOpacity={0.8}
              style={[ls.addCta, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '44' }]}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '700' }}>Add Key Level</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <LevelCard
            level={item}
            colors={colors}
            onCancel={() => handleCancel(item.id)}
            isCancelling={isCancelling && cancellingId === item.id}
          />
        )}
      />

      <AddKeyLevelSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        initialTicker={activeTicker}
      />
    </>
  );
};

const ls = StyleSheet.create({
  headerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyIcon: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  emptySubtitle: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  addCta: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1 },
});
