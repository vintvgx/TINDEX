import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketDigest } from '@/hooks/queries/digest/useMarketDigest';
import { isMuseBriefContent, type MuseBriefTicker } from '@/common/types/marketDigest';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function PickRow({ t, colors }: { t: MuseBriefTicker; colors: ReturnType<typeof useThemeColors> }) {
  const dirUp = t.direction === 'CALL';
  const dirColor = dirUp ? colors.success : colors.error;
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: colors.text }]}>{t.ticker}</Text>
      <View style={[styles.badge, { backgroundColor: dirColor + '22', borderColor: dirColor + '55' }]}>
        <Text style={[styles.mono, { fontSize: 9, fontWeight: '800', color: dirColor }]}>{t.direction}</Text>
      </View>
      <Text style={[styles.mono, { fontSize: 11, color: colors.textSecondary }]} numberOfLines={1}>
        {t.setup}
      </Text>
      <View style={{ flex: 1 }} />
      <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: colors.text }]}>
        {t.score.toFixed(0)}
      </Text>
    </View>
  );
}

/**
 * Dynamic card "brief" view: today's Morning Brief at a glance — regime,
 * top 4 TINDEX plays + top 4 Muse picks as compact brief-style rows.
 * Tap opens the full brief modal.
 */
export function DynamicBriefView({ onOpenBrief }: { onOpenBrief: () => void }) {
  const colors = useThemeColors();
  const { data, isLoading } = useMarketDigest(todayISO());
  const content = data?.data?.content_json;
  const brief = isMuseBriefContent(content) ? content : null;

  const regimeColor =
    brief?.market.regime === 'risk-on'
      ? colors.success
      : brief?.market.regime === 'risk-off'
        ? colors.error
        : colors.warning;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 14, paddingBottom: 26 }}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary }]}>
          MORNING BRIEF
        </Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onOpenBrief} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[styles.mono, { fontSize: 10, fontWeight: '700', color: colors.accent }]}>
            OPEN FULL
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 16 }}>Loading brief…</Text>
      ) : !brief ? (
        <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 16, lineHeight: 19 }}>
          No brief published yet today — it lands at 8:00 AM ET.
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <View style={[styles.regimeDot, { backgroundColor: regimeColor }]} />
            <Text style={[styles.mono, { fontSize: 13, fontWeight: '800', color: regimeColor }]}>
              {brief.market.regime.toUpperCase().replace('-', ' ')}
            </Text>
          </View>
          <Text style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 6, lineHeight: 17 }} numberOfLines={3}>
            {brief.market.headline}
          </Text>

          <Text style={[styles.mono, { fontSize: 10, letterSpacing: 1.5, color: colors.textTertiary, marginTop: 14, marginBottom: 6 }]}>
            TOP TINDEX PLAYS
          </Text>
          {brief.watchlist.slice(0, 4).map((t) => (
            <PickRow key={t.ticker} t={t} colors={colors} />
          ))}

          {brief.muse_picks.length > 0 && (
            <>
              <Text style={[styles.mono, { fontSize: 10, letterSpacing: 1.5, color: colors.textTertiary, marginTop: 12, marginBottom: 6 }]}>
                MUSE PICKS
              </Text>
              {brief.muse_picks.slice(0, 4).map((t) => (
                <PickRow key={t.ticker} t={t} colors={colors} />
              ))}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  regimeDot: { width: 8, height: 8, borderRadius: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
});
