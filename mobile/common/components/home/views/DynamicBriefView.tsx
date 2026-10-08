import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketDigest } from '@/hooks/queries/digest/useMarketDigest';
import { useMarketStream } from '@/hooks/useMarketStream';
import { isMuseBriefContent, type MuseBriefContent, type MuseBriefTicker } from '@/common/types/marketDigest';
import { setupLevels, topDrivers, triggerDistancePct } from '@/common/components/digest/SetupChart';
import { PickDetailSheet } from '@/common/components/digest/PickDetailSheet';

type Colors = ReturnType<typeof useThemeColors>;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * One play: ticker / direction / score / setup, live price vs the trigger,
 * the trigger → target and stop levels with reward:risk, and what's driving
 * the score.
 */
function PickRow({ t, price, colors, onPress }: { t: MuseBriefTicker; price?: number; colors: Colors; onPress: () => void }) {
  const dirColor = t.direction === 'CALL' ? colors.success : colors.error;
  const { trigger, invalidation, target } = setupLevels(t);
  const rr =
    trigger != null && target != null && invalidation != null && trigger !== invalidation
      ? Math.abs(target - trigger) / Math.abs(trigger - invalidation)
      : null;
  // Signed distance still to travel to the trigger, in the play's direction:
  // positive = not there yet, ≤ 0 = through it.
  const toTrigger = triggerDistancePct(t, price);
  const through = toTrigger != null && toTrigger <= 0;
  const near = toTrigger != null && !through && toTrigger <= 0.3;
  const distColor = through ? dirColor : near ? colors.warning : colors.textTertiary;
  const drivers = topDrivers(t);

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={[styles.row, { borderColor: colors.border }]}>
      <View style={styles.line}>
        <Text style={[styles.mono, { fontSize: 12, fontWeight: '800', color: colors.text }]}>{t.ticker}</Text>
        <View style={[styles.badge, { backgroundColor: dirColor + '22', borderColor: dirColor + '55' }]}>
          <Text style={[styles.mono, { fontSize: 9, fontWeight: '800', color: dirColor }]}>{t.direction}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: colors.warning + '1F', borderColor: colors.warning + '66' }]}>
          <Text style={[styles.mono, { fontSize: 9, fontWeight: '800', color: colors.warning }]}>
            {Number.isInteger(t.score) ? t.score : t.score.toFixed(1)}
          </Text>
        </View>
        <Text style={[styles.mono, { flexShrink: 1, fontSize: 10.5, color: colors.textSecondary }]} numberOfLines={1}>
          {t.setup}
        </Text>
        <View style={{ flex: 1 }} />
        {price != null && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.mono, { fontSize: 12, fontWeight: '700', color: colors.text }]}>{price.toFixed(2)}</Text>
            {toTrigger != null && (
              <Text style={[styles.mono, { fontSize: 9, color: distColor }]}>
                {through ? 'THROUGH TRIGGER' : `${toTrigger.toFixed(2)}% to trig`}
              </Text>
            )}
          </View>
        )}
      </View>

      <View style={[styles.line, { marginTop: 8, gap: 12 }]}>
        {trigger != null && (
          <Text style={[styles.mono, styles.lvl, { color: colors.textSecondary }]}>
            {trigger.toFixed(2)}
            {target != null && <Text style={{ color: colors.textTertiary }}>{' → '}</Text>}
            {target != null && <Text style={{ color: colors.success }}>{target.toFixed(2)}</Text>}
          </Text>
        )}
        {invalidation != null && (
          <Text style={[styles.mono, styles.lvl, { color: colors.textTertiary }]}>
            stop <Text style={{ color: colors.error }}>{invalidation.toFixed(2)}</Text>
          </Text>
        )}
        {rr != null && (
          <Text style={[styles.mono, styles.lvl, { color: colors.textTertiary }]}>
            <Text style={{ color: colors.text }}>{rr.toFixed(1)}R</Text>
          </Text>
        )}
      </View>

      {drivers && (
        <Text style={[styles.mono, { fontSize: 9.5, color: colors.textTertiary, marginTop: 6 }]} numberOfLines={1}>
          {drivers}
        </Text>
      )}
    </TouchableOpacity>
  );
}

/** Futures + VIX chips, then the next catalyst or two and any earnings blackout. */
function MarketStrip({ brief, vix, colors }: { brief: MuseBriefContent; vix: number | null; colors: Colors }) {
  const futures = Object.entries(brief.market.futures ?? {});
  const vixVal = vix ?? brief.market.vix;
  const events = (brief.events ?? []).slice(0, 2);
  const impactColor = (i: string) => (i === 'high' ? colors.error : i === 'medium' ? colors.warning : colors.textTertiary);
  const tone = (v: string) =>
    v.trim().startsWith('-') ? colors.error : v.trim().startsWith('+') ? colors.success : colors.textSecondary;

  return (
    <View style={{ marginTop: 14, gap: 10 }}>
      {(futures.length > 0 || vixVal != null) && (
        <View style={styles.chips}>
          {futures.map(([k, v]) => (
            <View key={k} style={[styles.chip, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.mono, { fontSize: 9.5, color: colors.textTertiary }]}>{k.toUpperCase()}</Text>
              <Text style={[styles.mono, { fontSize: 10, fontWeight: '700', color: tone(v) }]}>{v}</Text>
            </View>
          ))}
          {vixVal != null && (
            <View style={[styles.chip, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.mono, { fontSize: 9.5, color: colors.textTertiary }]}>VIX</Text>
              <Text style={[styles.mono, { fontSize: 10, fontWeight: '700', color: colors.text }]}>
                {Number(vixVal).toFixed(1)}
              </Text>
            </View>
          )}
        </View>
      )}
      {events.map((e, i) => (
        <View key={i} style={styles.line}>
          <View style={[styles.dot, { backgroundColor: impactColor(e.impact) }]} />
          <Text style={[styles.mono, { fontSize: 10, color: colors.textSecondary, width: 62 }]}>{e.time_et}</Text>
          <Text style={{ flex: 1, fontSize: 11.5, color: colors.text }} numberOfLines={1}>{e.label}</Text>
          {e.consensus ? (
            <Text style={[styles.mono, { fontSize: 9.5, color: colors.textTertiary }]}>cons {e.consensus}</Text>
          ) : null}
        </View>
      ))}
      {brief.earnings_blackout.length > 0 && (
        <Text style={[styles.mono, { fontSize: 9.5, color: colors.textTertiary }]} numberOfLines={1}>
          EARNINGS BLACKOUT: <Text style={{ color: colors.error }}>{brief.earnings_blackout.join(' · ')}</Text>
        </Text>
      )}
    </View>
  );
}

/**
 * Dynamic card "brief" view: today's Morning Brief at a glance — regime,
 * top 4 TINDEX plays + top 4 Muse picks as compact brief-style rows.
 * Tapping a play opens its Pick Detail Sheet; "Open full" or a tap on the
 * background around the cards opens the full brief modal.
 */
export function DynamicBriefView({ onOpenBrief }: { onOpenBrief: () => void }) {
  const colors = useThemeColors();
  const { data, isLoading } = useMarketDigest(todayISO());
  const content = data?.data?.content_json;
  const brief = isMuseBriefContent(content) ? content : null;
  // Live prices off the app-wide /ws/prices socket — no extra connections.
  const tickers = brief ? [...brief.watchlist.slice(0, 4), ...brief.muse_picks.slice(0, 4)].map((t) => t.ticker) : [];
  const { livePrices, vix } = useMarketStream(tickers, { enabled: tickers.length > 0 });
  // Tapping a pick opens its detail sheet; "Open full" and taps on the
  // background around the cards still open the full brief.
  const [selected, setSelected] = useState<MuseBriefTicker | null>(null);

  const regimeColor =
    brief?.market.regime === 'risk-on'
      ? colors.success
      : brief?.market.regime === 'risk-off'
        ? colors.error
        : colors.warning;

  return (
    <>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1 }}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      <Pressable onPress={onOpenBrief} style={{ flexGrow: 1, padding: 14, paddingBottom: 26 }}>
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
          <MarketStrip brief={brief} vix={vix} colors={colors} />

          <Text style={[styles.mono, { fontSize: 10, letterSpacing: 1.5, color: colors.textTertiary, marginTop: 20, marginBottom: 4 }]}>
            TOP TINDEX PLAYS
          </Text>
          {brief.watchlist.slice(0, 4).map((t) => (
            <PickRow key={t.ticker} t={t} price={livePrices[t.ticker]} colors={colors} onPress={() => setSelected(t)} />
          ))}

          {brief.muse_picks.length > 0 && (
            <>
              <Text style={[styles.mono, { fontSize: 10, letterSpacing: 1.5, color: colors.textTertiary, marginTop: 20, marginBottom: 4 }]}>
                MUSE PICKS
              </Text>
              {brief.muse_picks.slice(0, 4).map((t) => (
                <PickRow key={t.ticker} t={t} price={livePrices[t.ticker]} colors={colors} onPress={() => setSelected(t)} />
              ))}
            </>
          )}
        </>
      )}
      </Pressable>
    </ScrollView>
    <PickDetailSheet pick={selected} onClose={() => setSelected(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  regimeDot: { width: 8, height: 8, borderRadius: 4 },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lvl: { fontSize: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
});
