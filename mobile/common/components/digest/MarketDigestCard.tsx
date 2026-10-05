import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketDigest } from '@/hooks/queries/digest/useMarketDigest';
import { useSeenMarketDigests } from '@/hooks/useSeenMarketDigests';
import { isPastMarketDigestTime } from '@/lib/marketHours';

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Persistent Home banner for the pre-market Morning Brief — published by the
 * 8:00 AM ET job (POST /muse/market-digest/publish), refreshed silently at
 * 9:00 AM. The deprecated on-demand Claude generation is gone: if no brief
 * exists yet, the card says when it lands instead of offering to build one.
 */
export function MarketDigestCard({ onOpen }: { onOpen: (date: string) => void }) {
  const colors = useThemeColors();
  const today = todayISO();
  const { data, isLoading } = useMarketDigest(today);
  const { isSeen } = useSeenMarketDigests();
  const ready = !!data?.data;

  if (ready && isSeen(today)) return null;
  // The brief publishes at 8:00 AM ET — before that there's nothing to show.
  if (!ready && !isPastMarketDigestTime()) return null;

  const accent = ready ? colors.success : colors.textTertiary;

  return (
    <TouchableOpacity
      onPress={() => ready && onOpen(today)}
      activeOpacity={ready ? 0.8 : 1}
      disabled={isLoading || !ready}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        marginHorizontal: 16, marginTop: 10, marginBottom: 4,
        paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12,
        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
        borderLeftWidth: 3, borderLeftColor: accent,
      }}
    >
      <View style={{
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: accent, opacity: ready ? 1 : 0.5,
      }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'monospace', color: colors.text, fontSize: 13, fontWeight: '800', letterSpacing: 1.5 }}>
          MORNING BRIEF
        </Text>
        <Text style={{ fontFamily: 'monospace', color: colors.textTertiary, fontSize: 10.5, marginTop: 2 }}>
          {ready ? '$ tap to open terminal' : '$ publishes 8:00 AM ET'}
        </Text>
      </View>
      {ready
        ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        : <Ionicons name="time-outline" size={16} color={colors.textTertiary} />}
    </TouchableOpacity>
  );
}
