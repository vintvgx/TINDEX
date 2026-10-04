import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line } from 'react-native-svg';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import type {
  MuseBriefContent,
  MuseBriefTicker,
  MuseBriefEtf,
} from '@/common/types/marketDigest';

// ---------------------------------------------------------------------------
// Trading-terminal digest view for muse-brief-v1 content.
// Single scrolling view: masthead → regime banner → tape → index regime →
// watchlist → Bandit's picks → footer. Entrance fanfare (staggered fade/slide,
// count-ups, gauge sweeps) plays on the 8:00 AM publish; the 9:00 AM silent
// refresh renders final values immediately (silent_update = true).
// ---------------------------------------------------------------------------

const MONO = 'monospace';

function scoreColor(score: number, colors: ReturnType<typeof useThemeColors>): string {
  if (score >= 80) return colors.success;
  if (score >= 65) return colors.warning;
  return colors.error;
}

/** JS count-up for the gauge number (cheap, digest-grade — not 60fps-critical). */
function useCountUp(target: number, animate: boolean, duration = 1000): number {
  const [val, setVal] = useState(animate ? 0 : target);
  useEffect(() => {
    if (!animate) {
      setVal(target);
      return;
    }
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / duration);
      setVal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate, duration]);
  return val;
}

function fmtScore(s: number): string {
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
}

/** Staggered entrance wrapper — skipped entirely on silent refreshes. */
function Enter({
  index,
  silent,
  children,
}: {
  index: number;
  silent: boolean;
  children: React.ReactNode;
}) {
  if (silent) return <>{children}</>;
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 12) * 70).duration(450)}>
      {children}
    </Animated.View>
  );
}

// --- Score gauge ------------------------------------------------------------

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function Gauge({
  score,
  size = 88,
  animate,
  colors,
}: {
  score: number;
  size?: number;
  animate: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const R = size / 2 - 7;
  const C = 2 * Math.PI * R;
  const ARC = 0.75; // 270° sweep, gap at the bottom
  const color = scoreColor(score, colors);
  const progress = useSharedValue(animate ? 0 : score / 100);

  useEffect(() => {
    progress.value = animate
      ? withTiming(score / 100, { duration: 1100, easing: Easing.out(Easing.cubic) })
      : score / 100;
  }, [score, animate, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: C * ARC * (1 - progress.value),
  }));
  const display = useCountUp(score, animate);
  const c = size / 2;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={c}
          cy={c}
          r={R}
          stroke={colors.textTertiary + '30'}
          strokeWidth={7}
          fill="none"
          strokeDasharray={`${C * ARC} ${C}`}
          strokeLinecap="round"
          transform={`rotate(135 ${c} ${c})`}
        />
        <AnimatedCircle
          cx={c}
          cy={c}
          r={R}
          stroke={color}
          strokeWidth={7}
          fill="none"
          strokeDasharray={`${C * ARC} ${C}`}
          strokeLinecap="round"
          transform={`rotate(135 ${c} ${c})`}
          animatedProps={animatedProps}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontFamily: MONO, fontSize: size * 0.26, fontWeight: '700', color }}>
          {fmtScore(display)}
        </Text>
      </View>
    </View>
  );
}

// --- Ticker tape (ambient marquee) --------------------------------------------

export interface TapeItem {
  label: string;
  value: string;
  tone: 'up' | 'down' | 'flat';
}

function Tape({ items, colors }: { items: TapeItem[]; colors: ReturnType<typeof useThemeColors> }) {
  const translateX = useSharedValue(0);
  const [halfWidth, setHalfWidth] = useState(0);

  useEffect(() => {
    if (halfWidth <= 0) return;
    translateX.value = withRepeat(
      withTiming(-halfWidth, { duration: Math.max(8000, halfWidth * 28), easing: Easing.linear }),
      -1,
      false,
    );
  }, [halfWidth, translateX]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const toneColor = (t: TapeItem['tone']) =>
    t === 'up' ? colors.success : t === 'down' ? colors.error : colors.textTertiary;

  return (
    <View style={[styles.tape, { backgroundColor: colors.tape, borderColor: colors.border }]}>
      <Animated.View
        style={[{ flexDirection: 'row', alignItems: 'center' }, style]}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width / 2;
          if (w > 0 && Math.abs(w - halfWidth) > 1) setHalfWidth(w);
        }}
      >
        {[...items, ...items].map((it, i) => (
          <Text key={i} style={[styles.tapeText, { color: colors.tapeText }]}>
            <Text style={{ color: colors.tapeMuted }}>{it.label} </Text>
            <Text style={{ color: toneColor(it.tone), fontWeight: '700' }}>{it.value}</Text>
            <Text style={{ color: colors.tapeMuted }}>   ///   </Text>
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

// --- Support/resistance mini chart -------------------------------------------

function SrChart({
  levels,
  width,
  colors,
}: {
  levels: MuseBriefTicker['levels'];
  width: number;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const H = 112;
  const PAD = 34; // right gutter for price labels
  const entries: Array<{ v: number; label: string; color: string; dashed: boolean }> = [];
  if (levels.resistance != null)
    entries.push({ v: levels.resistance, label: `R ${levels.resistance.toFixed(2)}`, color: colors.error, dashed: true });
  if (levels.orh != null)
    entries.push({ v: levels.orh, label: `ORH ${levels.orh.toFixed(2)}`, color: colors.warning, dashed: false });
  if (levels.orl != null)
    entries.push({ v: levels.orl, label: `ORL ${levels.orl.toFixed(2)}`, color: colors.warning, dashed: false });
  if (levels.support != null)
    entries.push({ v: levels.support, label: `S ${levels.support.toFixed(2)}`, color: colors.success, dashed: true });
  if (entries.length === 0) return null;

  const vals = entries.map((e) => e.v);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const padV = span * 0.22;
  const y = (v: number) => 8 + (1 - (v - (lo - padV)) / (span + padV * 2)) * (H - 16);
  const chartW = width - PAD;

  return (
    <View style={{ marginTop: 10 }}>
      <Svg width={width} height={H}>
        {entries.map((e, i) => (
          <React.Fragment key={i}>
            <Line
              x1={0}
              x2={chartW}
              y1={y(e.v)}
              y2={y(e.v)}
              stroke={e.color}
              strokeWidth={e.dashed ? 1.5 : 1}
              strokeDasharray={e.dashed ? '6 4' : undefined}
              opacity={0.9}
            />
          </React.Fragment>
        ))}
      </Svg>
      {/* Labels overlaid at the right gutter, positioned by the same y() math */}
      <View style={[StyleSheet.absoluteFillObject, { height: H }]}>
        {entries.map((e, i) => (
          <Text
            key={i}
            style={{
              position: 'absolute',
              left: chartW + 4,
              top: Math.max(0, Math.min(H - 14, y(e.v) - 7)),
              fontFamily: MONO,
              fontSize: 9,
              color: e.color,
            }}
          >
            {e.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// --- Score component bars ------------------------------------------------------

const COMPONENT_LABELS: Record<string, string> = {
  zone: 'Zone',
  proximity: 'Proximity',
  reward_risk: 'R:R',
  trend: 'Trend',
  rsi: 'RSI',
  premarket: 'Premkt',
  prior_day: 'Prior day',
};

function ComponentBarRow({
  label,
  value,
  share,
  width,
  colors,
}: {
  label: string;
  value: number;
  share: number;
  width: Animated.SharedValue<number>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const barStyle = useAnimatedStyle(() => ({
    width: `${Math.max(2, Math.min(100, share * 100 * width.value))}%` as const,
  }));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={[styles.mono, { width: 64, fontSize: 10, color: colors.textTertiary }]}>{label}</Text>
      <View
        style={{
          flex: 1,
          height: 5,
          borderRadius: 3,
          backgroundColor: colors.textTertiary + '22',
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={[
            { height: '100%', borderRadius: 3, backgroundColor: colors.success + 'CC' },
            barStyle,
          ]}
        />
      </View>
      <Text style={[styles.mono, { width: 36, fontSize: 10, textAlign: 'right', color: colors.textSecondary }]}>
        {fmtScore(value)}
      </Text>
    </View>
  );
}

function ComponentBars({
  components,
  score,
  animate,
  colors,
}: {
  components: Record<string, number>;
  score: number;
  animate: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const entries = Object.entries(components);
  const width = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    width.value = animate ? withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }) : 1;
  }, [animate, width]);

  if (entries.length === 0) return null;
  return (
    <View style={{ marginTop: 10, gap: 5 }}>
      {entries.map(([key, value]) => (
        <ComponentBarRow
          key={key}
          label={COMPONENT_LABELS[key] ?? key.replace(/_/g, ' ')}
          value={value}
          share={score > 0 ? value / score : 0}
          width={width}
          colors={colors}
        />
      ))}
    </View>
  );
}

// --- Ticker card ---------------------------------------------------------------

function TickerCard({
  t,
  bandit,
  animate,
  colors,
  chartWidth,
}: {
  t: MuseBriefTicker;
  bandit: boolean;
  animate: boolean;
  colors: ReturnType<typeof useThemeColors>;
  chartWidth: number;
}) {
  const dirUp = t.direction === 'CALL';
  const dirColor = dirUp ? colors.success : colors.error;
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.mono, { fontSize: 17, fontWeight: '800', color: colors.text, letterSpacing: 0.5 }]}>
          {t.ticker}
        </Text>
        <View style={[styles.badge, { backgroundColor: dirColor + '22', borderColor: dirColor + '55' }]}>
          <Text style={[styles.mono, { fontSize: 10, fontWeight: '800', color: dirColor }]}>{t.direction}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>{t.premium_tier}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
        <Gauge score={t.score} animate={animate} colors={colors} />
        <View style={{ flex: 1, justifyContent: 'center', gap: 6 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.text }}>{t.setup}</Text>
          {bandit && t.thesis ? (
            <Text style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 17 }}>{t.thesis}</Text>
          ) : null}
        </View>
      </View>

      <ComponentBars components={t.components} score={t.score} animate={animate} colors={colors} />
      <SrChart levels={t.levels} width={chartWidth} colors={colors} />

      {/* if / then plan */}
      <View style={[styles.planBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <Text style={[styles.mono, { fontSize: 10, fontWeight: '700', color: colors.success, marginBottom: 4 }]}>
          {'// IF → THEN'}
        </Text>
        <Text style={{ fontSize: 12.5, color: colors.text, lineHeight: 18 }}>{t.if_then}</Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'flex-start' }}>
          <Ionicons name="shield-outline" size={13} color={colors.error} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: 11.5, color: colors.textSecondary, lineHeight: 16 }}>
            <Text style={{ fontWeight: '700', color: colors.error }}>Invalidation: </Text>
            {t.invalidation}
          </Text>
        </View>
      </View>
    </View>
  );
}

// --- ETF regime cards ----------------------------------------------------------

function EtfCard({
  etf,
  animate,
  colors,
}: {
  etf: MuseBriefEtf;
  animate: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const c = scoreColor(etf.score, colors);
  const arrow = etf.trend === 'up' ? '▲' : etf.trend === 'down' ? '▼' : '■';
  const arrowColor =
    etf.trend === 'up' ? colors.success : etf.trend === 'down' ? colors.error : colors.textTertiary;
  const display = useCountUp(etf.score, animate, 800);
  return (
    <View
      style={[
        styles.etfCard,
        { backgroundColor: colors.card, borderColor: colors.cardBorder, borderTopColor: c, borderTopWidth: 2 },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[styles.mono, { fontSize: 13, fontWeight: '800', color: colors.text }]}>{etf.ticker}</Text>
        <Text style={{ fontSize: 10, color: arrowColor }}>{arrow}</Text>
      </View>
      <Text style={[styles.mono, { fontSize: 20, fontWeight: '800', color: c, marginTop: 2 }]}>
        {fmtScore(display)}
      </Text>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.textTertiary + '22', marginTop: 6, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${Math.min(100, etf.score)}%`, backgroundColor: c, borderRadius: 2 }} />
      </View>
      <Text style={[styles.mono, { fontSize: 9, color: colors.textTertiary, marginTop: 6 }]}>
        {etf.levels.support != null ? `S ${etf.levels.support.toFixed(0)}` : 'S —'}
        {'  ·  '}
        {etf.levels.resistance != null ? `R ${etf.levels.resistance.toFixed(0)}` : 'R —'}
      </Text>
      {etf.note ? (
        <Text style={{ fontSize: 10.5, color: colors.textSecondary, marginTop: 4, lineHeight: 14 }} numberOfLines={3}>
          {etf.note}
        </Text>
      ) : null}
    </View>
  );
}

function EtfRow({
  etfs,
  animate,
  colors,
}: {
  etfs: MuseBriefEtf[];
  animate: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  if (etfs.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {etfs.map((e) => (
        <EtfCard key={e.ticker} etf={e} animate={animate} colors={colors} />
      ))}
    </View>
  );
}

function SectionHeader({ label, colors }: { label: string; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 10 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      <Text style={[styles.mono, { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: colors.textSecondary }]}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

// --- Main view -------------------------------------------------------------------

export function MuseDigestView({
  content,
  dateLabel,
}: {
  content: MuseBriefContent;
  dateLabel: string;
}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const layout = useWindowDimensions();
  const chartWidth = Math.max(200, layout.width - 56); // screen padding + card padding
  const silent = content.silent_update === true;
  const animate = !silent;

  const regimeColor =
    content.market.regime === 'risk-on'
      ? colors.success
      : content.market.regime === 'risk-off'
        ? colors.error
        : colors.warning;

  const tapeItems: TapeItem[] = [
    ...Object.entries(content.market.futures).map(([k, v]) => ({
      label: k.toUpperCase(),
      value: v,
      tone: (v.trim().startsWith('-') ? 'down' : v.trim().startsWith('+') ? 'up' : 'flat') as TapeItem['tone'],
    })),
    ...(content.market.vix != null ? [{ label: 'VIX', value: String(content.market.vix), tone: 'flat' as const }] : []),
    ...content.etfs.map((e) => ({
      label: e.ticker,
      value: fmtScore(e.score),
      tone: (e.trend === 'up' ? 'up' : e.trend === 'down' ? 'down' : 'flat') as TapeItem['tone'],
    })),
  ];

  let genTime = '';
  try {
    genTime = format(parseISO(content.generated_at), 'h:mm a');
  } catch {
    genTime = '';
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: insets.bottom + 28 }}
      showsVerticalScrollIndicator={false}
    >
      {/* masthead */}
      <Enter index={0} silent={silent}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 2 }}>
          <Text style={[styles.mono, { fontSize: 11, color: colors.textTertiary }]}>{'~/morning-brief'}</Text>
          <View style={{ flex: 1 }} />
          <View
            style={[
              styles.badge,
              {
                backgroundColor: silent ? colors.warning + '1E' : colors.success + '1E',
                borderColor: silent ? colors.warning + '55' : colors.success + '55',
              },
            ]}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: silent ? colors.warning : colors.success,
              }}
            />
            <Text
              style={[
                styles.mono,
                { fontSize: 10, fontWeight: '800', color: silent ? colors.warning : colors.success },
              ]}
            >
              {silent ? 'REFRESH' : 'LIVE'}
            </Text>
          </View>
        </View>
        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: 0.5 }}>
          Morning Brief
        </Text>
        <Text style={[styles.mono, { fontSize: 11, color: colors.textTertiary, marginTop: 2 }]}>
          {dateLabel}{genTime ? `  ·  generated ${genTime} ET` : ''}
        </Text>
      </Enter>

      {/* regime banner */}
      <Enter index={1} silent={silent}>
        <View
          style={[
            styles.regime,
            { backgroundColor: colors.card, borderColor: colors.cardBorder, borderLeftColor: regimeColor },
          ]}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0.06)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary }]}>
            MARKET REGIME
          </Text>
          <Text style={[styles.mono, { fontSize: 20, fontWeight: '800', color: regimeColor, marginTop: 2 }]}>
            {content.market.regime.toUpperCase().replace('-', ' ')}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 6, lineHeight: 18 }}>
            {content.market.headline}
          </Text>
        </View>
      </Enter>

      {/* tape */}
      <Enter index={2} silent={silent}>
        <View style={{ marginTop: 12 }}>
          <Tape items={tapeItems} colors={colors} />
        </View>
      </Enter>

      {/* index regime */}
      <Enter index={3} silent={silent}>
        <SectionHeader label="INDEX REGIME" colors={colors} />
        <EtfRow etfs={content.etfs} animate={animate} colors={colors} />
      </Enter>

      {/* watchlist */}
      <Enter index={4} silent={silent}>
        <SectionHeader label="WATCHLIST · TINDEX" colors={colors} />
      </Enter>
      {content.watchlist.map((t, i) => (
        <Enter key={t.ticker} index={5 + i} silent={silent}>
          <TickerCard t={t} bandit={false} animate={animate} colors={colors} chartWidth={chartWidth} />
        </Enter>
      ))}

      {/* bandit's picks */}
      <Enter index={9} silent={silent}>
        <SectionHeader label="BANDIT'S PICKS" colors={colors} />
      </Enter>
      {content.muse_picks.map((t, i) => (
        <Enter key={t.ticker} index={10 + i} silent={silent}>
          <TickerCard t={t} bandit animate={animate} colors={colors} chartWidth={chartWidth} />
        </Enter>
      ))}

      {/* footer */}
      <Enter index={14} silent={silent}>
        <View style={{ marginTop: 22 }}>
          {content.correlation_note ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Ionicons name="link-outline" size={14} color={colors.warning} style={{ marginTop: 2 }} />
              <Text style={{ flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 17 }}>
                {content.correlation_note}
              </Text>
            </View>
          ) : null}
          {content.earnings_blackout.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary, alignSelf: 'center' }]}>
                EARNINGS BLACKOUT:
              </Text>
              {content.earnings_blackout.map((t) => (
                <View
                  key={t}
                  style={[styles.badge, { backgroundColor: colors.error + '18', borderColor: colors.error + '44' }]}
                >
                  <Text style={[styles.mono, { fontSize: 10, fontWeight: '700', color: colors.error }]}>{t}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={[styles.mono, { fontSize: 9, color: colors.textTertiary, marginTop: 14, textAlign: 'center' }]}>
            {'— end of brief · plan, not prediction —'}
          </Text>
        </View>
      </Enter>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: MONO },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  regime: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 14,
    overflow: 'hidden',
  },
  tape: {
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  tapeText: { fontFamily: MONO, fontSize: 11 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  etfCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
  },
  planBox: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
});
