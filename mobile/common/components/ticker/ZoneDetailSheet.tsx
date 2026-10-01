import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, Animated, ScrollView, StyleSheet, Dimensions, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { AUTO_ZONE_RESISTANCE_COLOR, AUTO_ZONE_SUPPORT_COLOR } from '@/common/components/ticker/autoZoneColors';
import type { ChartAutoZone, ChartZoneContext } from '@/common/components/ticker/AdvancedPriceChart';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
// The sheet sizes to its content; this only caps it (a zone with many
// touches scrolls instead of growing past it).
const SHEET_MAX_HEIGHT = SCREEN_HEIGHT * 0.72;

/** Plain-English names for ZoneEngine's raw source codes. Unknown codes fall
 *  back to the raw code (never blank) — see sourceLabel. Meant to be reused
 *  for zone push text too. */
export const SOURCE_LABELS: Record<string, string> = {
  swing_high_1d: 'Daily swing high',
  swing_low_1d: 'Daily swing low',
  swing_high_30m: '30m swing high',
  swing_low_30m: '30m swing low',
  swing_high_15m: '15m swing high',
  swing_low_15m: '15m swing low',
  swing_high_5m: '5m swing high',
  swing_low_5m: '5m swing low',
  pdh: 'Prior-day high',
  pdl: 'Prior-day low',
  pdc: 'Prior-day close',
  premarket_high: 'Premarket high',
  premarket_low: 'Premarket low',
  orh: 'Opening-range high',
  orl: 'Opening-range low',
  round_1: 'Round $1 level',
  round_5: 'Round $5 level',
  session_vwap: 'Session VWAP',
  prior_day_vwap: 'Prior-day VWAP',
};

export const sourceLabel = (source: string) => SOURCE_LABELS[source] ?? source;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → 'Sep 30'. Parsed from the string parts, not new Date(),
 *  so a timezone offset can't shift it to the previous day. */
function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-').map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : iso;
}

const money = (n: number) => `$${n.toFixed(2)}`;

// Max of each scoring term — must match zone_engine.py's v2 weights.
const SCORE_ROWS: { key: 'touch' | 'recency' | 'volume' | 'confluence'; label: string; max: number; hint: string }[] = [
  { key: 'touch', label: 'Touches', max: 30, hint: 'More tests = more conviction, with diminishing returns' },
  { key: 'recency', label: 'Freshness', max: 20, hint: 'Tested today scores full; 5-day half-life' },
  { key: 'volume', label: 'Volume', max: 15, hint: 'Heavy trading through the band' },
  { key: 'confluence', label: 'Confluence', max: 35, hint: 'Independent methods agreeing' },
];

interface Props {
  /** The tapped zone; null closes the sheet. */
  zone: ChartAutoZone | null;
  /** Price/ATR/prior-day context. The Context section hides when absent. */
  context?: ChartZoneContext | null;
  onClose: () => void;
}

/**
 * Explains one auto-detected zone: what it is, why the engine scores it the
 * way it does, when it was tested, and where price sits relative to it.
 * Read-only. Same Modal + Animated.spring slide-up pattern as MenuModal,
 * plus a slide-down on close: the Modal stays mounted until the sheet has
 * slid off-screen, so closing animates instead of vanishing.
 */
export const ZoneDetailSheet: React.FC<Props> = ({ zone, context, onClose }) => {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  // Off-screen start/end position — the full screen height clears a sheet
  // of any content-fitted height.
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const visible = zone != null;
  const [mounted, setMounted] = useState(visible);

  // Keep the last zone so the content doesn't blank out while closing.
  const lastZone = useRef<ChartAutoZone | null>(zone);
  if (zone) lastZone.current = zone;
  const z = lastZone.current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideAnim.setValue(SCREEN_HEIGHT);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 260, useNativeDriver: true }),
        Animated.timing(backdropAnim, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, slideAnim, backdropAnim]);

  if (!z || !mounted) return null;

  const isResistance = z.type === 'resistance';
  const zoneColor = isResistance ? AUTO_ZONE_RESISTANCE_COLOR : AUTO_ZONE_SUPPORT_COLOR;
  const band = z.high === z.low ? money(z.high) : `${money(z.low)}–${money(z.high)}`;
  const terms = z.scoreTerms;
  const touches = z.touchDetail ?? [];

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropAnim }]}>
        <Pressable style={styles.backdrop} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />

        <ScrollView
          style={{ flexGrow: 0 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
        >
          {/* Header */}
          <View style={[styles.header, { borderColor: zoneColor + '55', backgroundColor: zoneColor + '14' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerType, { color: zoneColor }]}>{isResistance ? 'Resistance' : 'Support'}</Text>
              <Text style={[styles.headerBand, { color: colors.text }]}>{band}</Text>
            </View>
            <Text style={[styles.score, { color: zoneColor }]}>
              {Math.round(z.score)}
              <Text style={[styles.scoreMax, { color: colors.textTertiary }]}>/100</Text>
            </Text>
          </View>

          {/* Why this score */}
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Why this score</Text>
          {terms ? (
            SCORE_ROWS.map(row => {
              const value = terms[row.key] ?? 0;
              return (
                <View key={row.key} style={styles.termRow}>
                  <View style={styles.termHead}>
                    <Text style={[styles.termLabel, { color: colors.text }]}>{row.label}</Text>
                    <Text style={[styles.termValue, { color: colors.textSecondary }]}>
                      {value.toFixed(1)} / {row.max}
                    </Text>
                  </View>
                  <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                    <View style={[styles.barFill, { backgroundColor: zoneColor, width: `${Math.min(100, (value / row.max) * 100)}%` }]} />
                  </View>
                  <Text style={[styles.termHint, { color: colors.textTertiary }]}>{row.hint}</Text>
                </View>
              );
            })
          ) : (
            <Text style={[styles.muted, { color: colors.textTertiary }]}>Score breakdown not available yet — refresh in a moment.</Text>
          )}

          {/* Touches timeline */}
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>
            Touches · {z.touches}
          </Text>
          {touches.length > 0 ? (
            touches.map((t, i) => (
              <View key={`${t.source}-${t.date}-${t.price}-${i}`} style={[styles.touchRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.touchDate, { color: colors.textSecondary }]}>{formatDay(t.date)}</Text>
                <Text style={[styles.touchPrice, { color: colors.text }]}>{money(t.price)}</Text>
                <Text style={[styles.touchSource, { color: colors.textSecondary }]} numberOfLines={1}>{sourceLabel(t.source)}</Text>
              </View>
            ))
          ) : (
            <Text style={[styles.muted, { color: colors.textSecondary }]}>
              {z.sources.map(sourceLabel).join(' · ')}
            </Text>
          )}

          {/* Context */}
          {context && <ZoneContext zone={z} context={context} colors={colors} />}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
};

function ZoneContext({ zone, context, colors }: { zone: ChartAutoZone; context: ChartZoneContext; colors: any }) {
  const { currentPrice, atr, priorDay, timeframe } = context;
  const tf = timeframe ?? '30m';

  let distance: string | null = null;
  let read: string | null = null;
  if (currentPrice != null && currentPrice > 0) {
    if (currentPrice > zone.high) {
      const diff = currentPrice - zone.high;
      distance = `Price is ${money(diff)} (${((diff / currentPrice) * 100).toFixed(2)}%) above this zone`;
      read = `A volume-confirmed ${tf} close below ${money(zone.low)} flips this to resistance.`;
    } else if (currentPrice < zone.low) {
      const diff = zone.low - currentPrice;
      distance = `Price is ${money(diff)} (${((diff / currentPrice) * 100).toFixed(2)}%) below this zone`;
      read = `A volume-confirmed ${tf} close above ${money(zone.high)} flips this to support.`;
    } else {
      distance = 'Price is inside this zone';
      read = `A volume-confirmed ${tf} close above ${money(zone.high)} or below ${money(zone.low)} decides it.`;
    }
  }

  const facts = [
    atr != null ? `ATR ${money(atr)}` : null,
    priorDay ? `Prior day: H ${money(priorDay.high)} L ${money(priorDay.low)} C ${money(priorDay.close)}` : null,
  ].filter(Boolean).join(' · ');

  if (!distance && !facts) return null;

  return (
    <>
      <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Context</Text>
      {distance && (
        <View style={styles.contextRow}>
          <Ionicons name="locate-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.contextText, { color: colors.text }]}>{distance}</Text>
        </View>
      )}
      {facts ? (
        <View style={styles.contextRow}>
          <Ionicons name="stats-chart-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.contextText, { color: colors.textSecondary }]}>{facts}</Text>
        </View>
      ) : null}
      {read && (
        <View style={styles.contextRow}>
          <Ionicons name="flash-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.contextText, { color: colors.textSecondary }]}>{read}</Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: SHEET_MAX_HEIGHT,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden',
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 16 },

  header: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, padding: 14 },
  headerType: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  headerBand: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  score: { fontSize: 34, fontWeight: '900' },
  scoreMax: { fontSize: 14, fontWeight: '700' },

  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  muted: { fontSize: 12.5 },

  termRow: { marginBottom: 10 },
  termHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  termLabel: { fontSize: 13.5, fontWeight: '600' },
  termValue: { fontSize: 12.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },
  termHint: { fontSize: 11, marginTop: 4 },

  touchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  touchDate: { width: 52, fontSize: 12.5, fontWeight: '600' },
  touchPrice: { width: 76, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  touchSource: { flex: 1, fontSize: 12.5 },

  contextRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  contextText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
