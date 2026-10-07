import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useChartLiveStream } from '@/hooks/queries/ticker/useChartLiveStream';
import { useSetupSessionBars, type SessionBar } from '@/hooks/queries/ticker/useSetupSessionBars';
import type { MuseBriefTicker } from '@/common/types/marketDigest';

// ---------------------------------------------------------------------------
// Morning Brief setup chart: yesterday's regular session on the left, today
// (premarket + live) on the right, one shared price axis. R/S lines span
// both halves, the target is a tinted zone, and two unlabeled dashed arrows
// project the break (green) and reject (red) paths off the trigger. Drawn in
// the approved mock's 360×262 viewBox and scaled to the card width.
// ---------------------------------------------------------------------------

type Colors = ReturnType<typeof useThemeColors>;

const MONO = 'monospace';
const LIVE_BLUE = '#4DA3FF';
const VB_W = 360;
const VB_H = 262;
const X_L = 4;
/** Right edge of the plot; everything past it is the price axis. */
const X_R = 298;
const MID = 151;
const PLOT_TOP = 32;
const PLOT_BOT = 248;
/** Price-axis tag geometry (viewBox units). */
const TAG_X = X_R + 4;
const TAG_W = VB_W - TAG_X - 2;
const TAG_H = 13;
const MAX_CANDLES = 26;

/** Default target-zone half-height when the payload has no zone bounds. */
const TARGET_PAD_PCT = 0.0022;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Gridline step: span/4 rounded to a 1/2/5 × 10^k value. */
function niceStep(span: number): number {
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

/** Stack axis tags so none overlap: push down from the top, then back up
 *  if the last one ran off the plot. Each tag keeps its line's y in `lineY`. */
function layoutTags<T extends { lineY: number }>(tags: T[]): (T & { tagY: number })[] {
  const out = tags.map((t) => ({ ...t, tagY: t.lineY })).sort((a, b) => a.lineY - b.lineY);
  for (let i = 0; i < out.length; i++) {
    const min = i === 0 ? PLOT_TOP - 8 + TAG_H / 2 : out[i - 1].tagY + TAG_H + 1;
    out[i].tagY = Math.max(out[i].tagY, min);
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const max = i === out.length - 1 ? PLOT_BOT + 6 - TAG_H / 2 : out[i + 1].tagY - TAG_H - 1;
    out[i].tagY = Math.min(out[i].tagY, max);
  }
  return out;
}

/** Merge consecutive bars so a half never draws more than `max` candles. */
function downsample(bars: SessionBar[], max: number): SessionBar[] {
  if (bars.length <= max) return bars;
  const size = Math.ceil(bars.length / max);
  const out: SessionBar[] = [];
  for (let i = 0; i < bars.length; i += size) {
    const g = bars.slice(i, i + size);
    out.push({
      o: g[0].o,
      h: Math.max(...g.map((b) => b.h)),
      l: Math.min(...g.map((b) => b.l)),
      c: g[g.length - 1].c,
    });
  }
  return out;
}

/** Levels the chart and copy read from a card, with fallbacks for older
 *  briefs that predate trigger/target on the payload. */
export function setupLevels(t: MuseBriefTicker) {
  const long = t.direction === 'CALL';
  const trigger = t.trigger ?? (long ? t.levels.resistance : t.levels.support) ?? null;
  const invalidation = (long ? t.levels.support : t.levels.resistance) ?? null;
  // Older briefs only carry the target inside the if/then copy ("… toward 249.25").
  const parsed = /toward\s+\$?(\d+(?:\.\d+)?)/.exec(t.if_then ?? '');
  const target = t.target ?? (parsed ? Number(parsed[1]) : null);
  const zone =
    t.target_zone ?? (target != null ? { low: target * (1 - TARGET_PAD_PCT), high: target * (1 + TARGET_PAD_PCT) } : null);
  return { long, trigger, invalidation, target, zone };
}

function PulsingDot({ cx, cy }: { cx: number; cy: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [p]);
  const animatedProps = useAnimatedProps(() => ({
    r: 4.5 + 2.5 * p.value,
    opacity: 1 - 0.65 * p.value,
  }));
  return <AnimatedCircle cx={cx} cy={cy} fill={LIVE_BLUE} animatedProps={animatedProps} />;
}

export function SetupChart({
  t,
  width,
  colors,
  bars,
}: {
  t: MuseBriefTicker;
  width: number;
  colors: Colors;
  bars: ReturnType<typeof useSetupSessionBars>['data'];
}) {
  const { price: streamPrice, connected } = useChartLiveStream(t.ticker);
  const { trigger, invalidation, target, zone } = setupLevels(t);
  const res = t.levels.resistance;
  const sup = t.levels.support;

  const yBars = downsample(bars?.yesterday ?? [], MAX_CANDLES);
  const tBars = downsample(bars?.today ?? [], MAX_CANDLES).slice();
  const lastClose = tBars.length ? tBars[tBars.length - 1].c : yBars.length ? yBars[yBars.length - 1].c : null;
  const live = streamPrice ?? lastClose;
  // The live price extends today's forming candle.
  if (streamPrice != null && tBars.length) {
    const b = tBars[tBars.length - 1];
    tBars[tBars.length - 1] = { ...b, c: streamPrice, h: Math.max(b.h, streamPrice), l: Math.min(b.l, streamPrice) };
  }

  // Shared price axis over everything drawn.
  const vals: number[] = [];
  for (const b of [...yBars, ...tBars]) vals.push(b.h, b.l);
  for (const v of [res, sup, live, zone?.low, zone?.high]) if (v != null) vals.push(v);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const span = hi - lo || Math.max(hi * 0.01, 1);
  const pad = span * 0.06;
  const y = (v: number) => PLOT_TOP + ((hi + pad - v) / (span + pad * 2)) * (PLOT_BOT - PLOT_TOP);

  // Candle geometry: yesterday fills its half; today gets slots for at least
  // 12 candles so a thin premarket doesn't stretch across the whole half.
  const yStep = yBars.length ? (MID - 8 - 12) / yBars.length : 0;
  const tSlots = Math.max(tBars.length + 1, 12);
  const tStep = (X_R - 22 - (MID + 10)) / tSlots;
  const candle = (b: SessionBar, x: number, w: number, key: string) => {
    const col = b.c >= b.o ? colors.success : colors.error;
    const top = y(Math.max(b.o, b.c));
    const bot = y(Math.min(b.o, b.c));
    return (
      <React.Fragment key={key}>
        <Line x1={x} x2={x} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth={1.2} />
        <Rect x={x - w / 2} y={top} width={w} height={Math.max(1.5, bot - top)} rx={1} fill={col} />
      </React.Fragment>
    );
  };
  const liveX = Math.min(X_R - 12, MID + 10 + tStep * (tBars.length + 0.5));

  // Projection arrows: break into the target zone, reject back toward the
  // invalidation level. PUT setups mirror naturally on the price axis.
  const arrows: { d: string; color: string; head: string }[] = [];
  if (trigger != null) {
    const sx = MID + 22;
    const sy = y(trigger);
    const mk = (ex: number, ey: number, f1: number, f2: number, color: string) => {
      const c1x = sx + 38, c1y = sy + (ey - sy) * f1;
      const c2x = ex - 42, c2y = sy + (ey - sy) * f2;
      // Arrowhead along the end tangent.
      const ang = Math.atan2(ey - c2y, ex - c2x);
      const hx = (a: number) => ex - 7 * Math.cos(ang + a);
      const hy = (a: number) => ey - 7 * Math.sin(ang + a);
      arrows.push({
        d: `M ${sx},${sy} C ${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`,
        head: `M ${hx(0.5)},${hy(0.5)} L ${ex},${ey} L ${hx(-0.5)},${hy(-0.5)}`,
        color,
      });
    };
    if (target != null) mk(X_R - 40, y(target), 0.27, 0.72, colors.success);
    if (invalidation != null) {
      const iy = y(invalidation);
      mk(X_R - 38, iy + (sy < iy ? -3 : 3), 0.4, 0.85, colors.error);
    }
  }

  const fmt = (v: number) => v.toFixed(2);

  // Price axis: one tag per level at its line's height, plus faint gridline
  // ticks wherever they don't collide with a tag.
  const tags = layoutTags(
    [
      res != null && { key: 'r', lineY: y(res), text: fmt(res), bg: colors.error, fg: '#fff' },
      sup != null && { key: 's', lineY: y(sup), text: fmt(sup), bg: colors.success, fg: '#000' },
      target != null && { key: 'tg', lineY: y(target), text: fmt(target), bg: colors.error + '33', fg: colors.error, border: colors.error },
      live != null && { key: 'lv', lineY: y(live), text: fmt(live), bg: LIVE_BLUE, fg: '#000' },
    ].filter(Boolean) as { key: string; lineY: number; text: string; bg: string; fg: string; border?: string }[],
  );
  const step = vals.length ? niceStep(span + pad * 2) : 0;
  const ticks: number[] = [];
  if (step > 0) {
    for (let v = Math.ceil((lo - pad) / step) * step; v <= hi + pad; v += step) {
      if (y(v) > PLOT_TOP - 4 && y(v) < PLOT_BOT + 4) ticks.push(v);
    }
  }
  const tickDecimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;

  const height = (width * VB_H) / VB_W;

  return (
    <View style={[styles.block, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.head}>
        <Text style={[styles.headText, { color: colors.textTertiary }]}>SETUP CHART</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, opacity: connected ? 1 : 0.45 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: LIVE_BLUE }} />
          <Text style={[styles.headText, { color: LIVE_BLUE, fontWeight: '700' }]}>LIVE</Text>
        </View>
      </View>

      <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`}>
        {ticks.map((v) => (
          <Line key={`g${v}`} x1={X_L} x2={X_R} y1={y(v)} y2={y(v)} stroke={colors.border} strokeWidth={0.6} opacity={0.5} />
        ))}
        {zone && (
          <>
            <Rect x={X_R - 60} y={y(zone.high)} width={60} height={Math.max(6, y(zone.low) - y(zone.high))}
              fill={colors.error} fillOpacity={0.1} />
            <Line x1={X_R - 60} x2={X_R} y1={y(zone.high)} y2={y(zone.high)} stroke={colors.error} strokeWidth={1}
              strokeDasharray="4 3" opacity={0.7} />
            <Line x1={X_R - 60} x2={X_R} y1={y(zone.low)} y2={y(zone.low)} stroke={colors.error} strokeWidth={1}
              strokeDasharray="4 3" opacity={0.7} />
          </>
        )}
        {res != null && (
          <>
            <Line x1={X_L} x2={X_R} y1={y(res)} y2={y(res)} stroke={colors.error} strokeWidth={1.4} strokeDasharray="6 4" />
          </>
        )}
        {sup != null && (
          <>
            <Line x1={X_L} x2={X_R} y1={y(sup)} y2={y(sup)} stroke={colors.success} strokeWidth={1.4} strokeDasharray="6 4" />
          </>
        )}

        <Line x1={MID} x2={MID} y1={8} y2={254} stroke={colors.border} strokeWidth={1} strokeDasharray="3 3" />
        <SvgText x={10} y={22} fill={colors.textTertiary} fontSize={9} letterSpacing={1.5}>YESTERDAY</SvgText>
        <SvgText x={MID + 9} y={22} fill={colors.textTertiary} fontSize={9} letterSpacing={1.5}>TODAY</SvgText>

        {live != null && (
          <Line x1={X_L} x2={X_R} y1={y(live)} y2={y(live)} stroke={LIVE_BLUE} strokeWidth={1} strokeDasharray="3 3" opacity={0.3} />
        )}

        {arrows.map((a, i) => (
          <React.Fragment key={i}>
            <Path d={a.d} fill="none" stroke={a.color} strokeWidth={1.6} strokeDasharray="5 4" />
            <Path d={a.head} fill="none" stroke={a.color} strokeWidth={1.6} />
          </React.Fragment>
        ))}

        {yBars.map((b, i) => candle(b, 12 + yStep * (i + 0.5), Math.max(1.5, Math.min(7.5, yStep * 0.65)), `y${i}`))}
        {tBars.map((b, i) => candle(b, MID + 10 + tStep * (i + 0.5), Math.max(2, Math.min(11, tStep * 0.6)), `t${i}`))}

        {live != null && (
          <>
            <PulsingDot cx={liveX} cy={y(live)} />
          </>
        )}

        {/* price axis */}
        <Line x1={X_R} x2={X_R} y1={8} y2={254} stroke={colors.border} strokeWidth={1} />
        {ticks.map((v) => (
          <React.Fragment key={`k${v}`}>
            {!tags.some((tg) => Math.abs(tg.tagY - y(v)) < TAG_H - 2) && (
              <SvgText x={TAG_X + 4} y={y(v) + 3.5} fill={colors.textTertiary} fontSize={9}>
                {v.toFixed(tickDecimals)}
              </SvgText>
            )}
          </React.Fragment>
        ))}
        {tags.map((tg) => (
          <React.Fragment key={tg.key}>
            {Math.abs(tg.tagY - tg.lineY) > 1 && (
              <Line x1={X_R} x2={TAG_X} y1={tg.lineY} y2={tg.tagY} stroke={tg.border ?? tg.bg} strokeWidth={1} />
            )}
            <Rect x={TAG_X} y={tg.tagY - TAG_H / 2} width={TAG_W} height={TAG_H} rx={3} fill={tg.bg}
              stroke={tg.border} strokeWidth={tg.border ? 1 : 0} />
            <SvgText x={TAG_X + TAG_W / 2} y={tg.tagY + 3.5} fill={tg.fg} fontSize={9.5} fontWeight="700" textAnchor="middle">
              {tg.text}
            </SvgText>
          </React.Fragment>
        ))}
        {!bars && (
          <SvgText x={MID} y={(PLOT_TOP + PLOT_BOT) / 2} fill={colors.textTertiary} fontSize={10} textAnchor="middle">
            loading session…
          </SvgText>
        )}
      </Svg>

      <View style={styles.legend}>
        <LegendDot color={colors.textTertiary + '66'} label="Yesterday" colors={colors} />
        {res != null && <LegendDot color={colors.error} label={`R ${fmt(res)}`} colors={colors} />}
        {sup != null && <LegendDot color={colors.success} label={`S ${fmt(sup)}`} colors={colors} />}
        {zone && (
          <View style={styles.legendItem}>
            <View style={{ width: 14, height: 8, borderRadius: 2, backgroundColor: colors.error + '40', borderWidth: 1, borderColor: colors.error }} />
            <Text style={[styles.legendText, { color: colors.textTertiary }]}>Target zone</Text>
          </View>
        )}
        <LegendDot color={LIVE_BLUE} label="Live" colors={colors} />
      </View>
    </View>
  );
}

function LegendDot({ color, label, colors }: { color: string; label: string; colors: Colors }) {
  return (
    <View style={styles.legendItem}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={[styles.legendText, { color: colors.textTertiary }]}>{label}</Text>
    </View>
  );
}

// --- "Why this setup" ---------------------------------------------------------

/** Each score component: display label, max points (services/brief/
 *  scoring.py weights), plain-English meaning, and the noun the "why" line
 *  uses for it. */
const COMPONENTS: { keys: string[]; label: string; max: number; desc: string; noun: string }[] = [
  { keys: ['premarket'], label: 'Premkt', max: 10, noun: 'premarket momentum',
    desc: 'premarket volume/momentum vs baseline (0 = nothing happening yet).' },
  { keys: ['prior_day'], label: 'Prior day', max: 10, noun: "yesterday's close",
    desc: "price vs yesterday's range/close." },
  { keys: ['proximity'], label: 'Proximity', max: 15, noun: 'proximity to the trigger',
    desc: 'distance to the trigger zone now (closer = higher).' },
  { keys: ['reward', 'reward_risk'], label: 'Reward', max: 15, noun: 'reward-to-risk',
    desc: 'reward:risk to target vs invalidation.' },
  { keys: ['rsi'], label: 'RSI', max: 10, noun: 'RSI',
    desc: 'RSI(14) state; scores when momentum supports direction without exhaustion.' },
  { keys: ['trend'], label: 'Trend', max: 15, noun: 'trend',
    desc: 'EMA stack / higher-highs alignment with direction.' },
  { keys: ['zone'], label: 'Zone', max: 25, noun: 'zone strength',
    desc: 'S/R zone strength: touches, confluence, volume at level.' },
];

function componentValue(components: Record<string, number>, keys: string[]): number | null {
  for (const k of keys) if (typeof components[k] === 'number') return components[k];
  return null;
}

function isPremarketNow(): boolean {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  return hhmm >= '04:00' && hhmm < '09:30';
}

/** The two strongest score components as short labels ("Trend · Zone maxed"),
 *  for compact rows that can't fit the full why-line. */
export function topDrivers(t: MuseBriefTicker): string | null {
  const ranked = COMPONENTS
    .map((c) => {
      const v = componentValue(t.components ?? {}, c.keys);
      return v == null ? null : { label: c.label, ratio: v / c.max };
    })
    .filter((c): c is NonNullable<typeof c> => c != null)
    .sort((a, b) => b.ratio - a.ratio);
  if (ranked.length < 2) return null;
  const [a, b] = ranked;
  return `${a.label} · ${b.label}${a.ratio >= 0.99 && b.ratio >= 0.99 ? ' maxed' : ''}`;
}

/** One plain-English sentence: the two strongest score components in words,
 *  anchored on the trigger and yesterday's extreme. Prices only, never raw
 *  component values. */
export function whyThisSetup(
  t: MuseBriefTicker,
  priorHigh: number | null | undefined,
  priorLow: number | null | undefined,
): string | null {
  const { long, trigger } = setupLevels(t);
  if (trigger == null) return null;
  const ranked = COMPONENTS
    .map((c) => {
      const v = componentValue(t.components ?? {}, c.keys);
      return v == null ? null : { ...c, ratio: v / c.max };
    })
    .filter((c): c is NonNullable<typeof c> => c != null)
    .sort((a, b) => b.ratio - a.ratio);
  if (ranked.length < 2) return null;
  const [a, b] = ranked;

  const extreme = long ? priorHigh : priorLow;
  const lead =
    extreme != null && Math.abs(extreme - trigger) / trigger < 0.01
      ? `Yesterday's ${long ? 'high' : 'low'} ${extreme.toFixed(2)} is today's magnet — `
      : '';
  const prox = componentValue(t.components ?? {}, ['proximity']);
  const verb = prox != null && prox / 15 >= 0.6 ? 'pressing' : 'watching';
  const when = isPremarketNow() ? ' premarket' : '';
  const drivers =
    a.ratio >= 0.99 && b.ratio >= 0.99 ? `with ${a.noun} and ${b.noun} maxed` : `led by ${a.noun} and ${b.noun}`;
  const rsi = ranked.find((c) => c.label === 'RSI');
  const rsiNote = rsi && rsi !== a && rsi !== b && rsi.ratio >= 0.99 ? '; RSI not exhausted' : '';
  const body = `${verb} ${long ? 'R' : 'S'} ${trigger.toFixed(2)}${when} ${drivers}${rsiNote}.`;
  const sentence = lead + body;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} Needs 1.2× volume on the ${long ? 'break' : 'breakdown'}.`;
}

export function WhyThisSetup({ text, colors }: { text: string | null; colors: Colors }) {
  if (!text) return null;
  return (
    <View style={{ marginTop: 12, marginHorizontal: 2 }}>
      <Text style={[styles.whyLabel, { color: colors.textTertiary }]}>WHY THIS SETUP</Text>
      <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.textSecondary }}>{text}</Text>
    </View>
  );
}

// --- Collapsed metric explainer ---------------------------------------------

export function ScoreExplainer({ t, colors }: { t: MuseBriefTicker; colors: Colors }) {
  const [open, setOpen] = useState(false);
  const score = Number.isInteger(t.score) ? String(t.score) : t.score.toFixed(1);
  return (
    <View style={[styles.explainer, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <TouchableOpacity
        onPress={() => setOpen((o) => !o)}
        style={styles.explainerHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.textSecondary }}>
          What goes into the {score} score?
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textTertiary} />
      </TouchableOpacity>
      {open && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
          {COMPONENTS.map((c) => {
            const v = componentValue(t.components ?? {}, c.keys);
            return (
              <Text
                key={c.label}
                style={[styles.explainerRow, { borderTopColor: colors.separator, color: colors.textTertiary }]}
              >
                <Text style={{ fontWeight: '700', color: colors.text }}>
                  {c.label}
                  {v != null ? ` · ${Number.isInteger(v) ? v : v.toFixed(1)}` : ''}
                </Text>
                {` — ${c.desc}`}
                {v != null && v >= c.max * 0.99 ? ' Maxed.' : ''}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 12, borderRadius: 12, borderWidth: 1, paddingTop: 10, paddingBottom: 8, paddingHorizontal: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 6 },
  headText: { fontFamily: MONO, fontSize: 10, letterSpacing: 1.5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 8, paddingHorizontal: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { fontSize: 10.5 },
  whyLabel: { fontFamily: MONO, fontSize: 10, letterSpacing: 1.5, marginBottom: 3 },
  explainer: { marginTop: 10, borderRadius: 10, borderWidth: 1 },
  explainerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11 },
  explainerRow: { fontSize: 12, lineHeight: 18, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth },
});
