import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Line, Rect } from 'react-native-svg';
import type { ORBTrade } from '@/common/types/strategy';

/**
 * P&L-first analytics for the Trade Log — every number here is computed
 * client-side from the already-fetched, account-filtered (paper/live) trade
 * list rather than the /strategy/stats endpoint, which blends both accounts'
 * money into one figure. Filtering first and computing second is what makes
 * the paper/live toggle actually mean something on the Stats tab.
 */

// ET calendar date — matches trade_date's server-side stamping (see tradelog.tsx).
export const todayEt = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const daysAgoEt = (n: number) => {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
};

export type TimeRange = 'TODAY' | '1W' | '1M' | 'ALL';

export const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: 'Today',    value: 'TODAY' },
  { label: '1W',       value: '1W' },
  { label: '1M',       value: '1M' },
  { label: 'All Time', value: 'ALL' },
];

/** Filters by trade_date (entry date, ET calendar) — TODAY is an exact match,
 *  1W/1M are rolling lookback windows, ALL is a no-op. Applied uniformly to
 *  both the day-grouped log and every Stats figure so the period selector
 *  actually changes what's being measured, not just which rows render. */
export function filterTradesByRange(trades: ORBTrade[], range: TimeRange): ORBTrade[] {
  if (range === 'ALL') return trades;
  const cutoff = range === 'TODAY' ? todayEt() : range === '1W' ? daysAgoEt(7) : daysAgoEt(30);
  return trades.filter(t => (t.trade_date?.slice(0, 10) ?? '') >= cutoff);
}

const fmtMoney = (v: number, decimals = 0) =>
  `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(decimals)}`;

// "2026-06-15" → "Jun 15"
export const fmtDay = (d: string): string => {
  const p = d?.split('-');
  if (!p || p.length !== 3) return d ?? '';
  const dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── Computations ──────────────────────────────────────────────────────────────

export interface DayGroup {
  date: string;
  trades: ORBTrade[];
  netPnl: number;
  closedCount: number;
  openCount: number;
}

/** Trades grouped by trade_date, newest day first. Net per day is realized
 *  P&L only — open trades count toward openCount but not the day's number. */
export function groupTradesByDay(trades: ORBTrade[]): DayGroup[] {
  const map = new Map<string, ORBTrade[]>();
  for (const t of trades) {
    const key = t.trade_date?.slice(0, 10) ?? 'unknown';
    const arr = map.get(key);
    if (arr) arr.push(t); else map.set(key, [t]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, dayTrades]) => {
      const closed = dayTrades.filter(t => t.exit_time != null);
      return {
        date,
        trades: dayTrades,
        netPnl: closed.reduce((s, t) => s + (t.pnl ?? 0), 0),
        closedCount: closed.length,
        openCount: dayTrades.length - closed.length,
      };
    });
}

export interface TradeStatsSummary {
  netPnl: number;
  todayPnl: number;
  weekPnl: number;
  closedCount: number;
  wins: number;
  losses: number;
  winRate: number | null;      // null when no closed trades
  profitFactor: number | null; // null when no losses yet
  expectancy: number;          // avg realized P&L per closed trade
  avgWin: number;
  avgLoss: number;             // negative
  best: ORBTrade | null;
  worst: ORBTrade | null;
  streak: { kind: 'W' | 'L'; count: number } | null;
  avgHoldMin: number | null;
}

export function computeTradeStats(trades: ORBTrade[]): TradeStatsSummary {
  const closed = trades
    .filter(t => t.exit_time != null)
    .sort((a, b) => (a.exit_time! < b.exit_time! ? -1 : 1));
  const pnls    = closed.map(t => t.pnl ?? 0);
  const winners = closed.filter(t => (t.pnl ?? 0) > 0);
  const losers  = closed.filter(t => (t.pnl ?? 0) < 0);
  const grossWin  = winners.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = losers.reduce((s, t) => s + (t.pnl ?? 0), 0); // negative

  const today = todayEt();
  const weekCutoff = daysAgoEt(7);

  let streak: TradeStatsSummary['streak'] = null;
  for (let i = closed.length - 1; i >= 0; i--) {
    const p = closed[i].pnl ?? 0;
    if (p === 0) break;
    const kind: 'W' | 'L' = p > 0 ? 'W' : 'L';
    if (!streak) streak = { kind, count: 1 };
    else if (streak.kind === kind) streak.count++;
    else break;
  }

  const holds = closed
    .map(t => (new Date(t.exit_time!).getTime() - new Date(t.entry_time).getTime()) / 60_000)
    .filter(m => Number.isFinite(m) && m >= 0);

  const best  = closed.length ? closed.reduce((a, b) => ((a.pnl ?? 0) >= (b.pnl ?? 0) ? a : b)) : null;
  const worst = closed.length ? closed.reduce((a, b) => ((a.pnl ?? 0) <= (b.pnl ?? 0) ? a : b)) : null;

  return {
    netPnl: pnls.reduce((s, p) => s + p, 0),
    todayPnl: closed.filter(t => t.trade_date?.slice(0, 10) === today).reduce((s, t) => s + (t.pnl ?? 0), 0),
    weekPnl:  closed.filter(t => (t.trade_date?.slice(0, 10) ?? '') >= weekCutoff).reduce((s, t) => s + (t.pnl ?? 0), 0),
    closedCount: closed.length,
    wins: winners.length,
    losses: losers.length,
    winRate: closed.length ? (winners.length / closed.length) * 100 : null,
    profitFactor: grossLoss < 0 ? grossWin / -grossLoss : (grossWin > 0 ? null : 0),
    expectancy: closed.length ? pnls.reduce((s, p) => s + p, 0) / closed.length : 0,
    avgWin:  winners.length ? grossWin / winners.length : 0,
    avgLoss: losers.length ? grossLoss / losers.length : 0,
    best, worst, streak,
    avgHoldMin: holds.length ? holds.reduce((s, m) => s + m, 0) / holds.length : null,
  };
}

/** Realized P&L per session day, oldest first. */
export function dailyNetSeries(trades: ORBTrade[]): { date: string; pnl: number }[] {
  const map = new Map<string, number>();
  for (const t of trades) {
    if (t.exit_time == null) continue;
    const key = t.trade_date?.slice(0, 10) ?? 'unknown';
    map.set(key, (map.get(key) ?? 0) + (t.pnl ?? 0));
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, pnl]) => ({ date, pnl }));
}

// ── Shared chart bits ─────────────────────────────────────────────────────────

const SCREEN_W = Dimensions.get('window').width;
// Screen padding (16×2) + card padding (14×2)
const CHART_W = SCREEN_W - 32 - 28;

// ── EquitySparkline ───────────────────────────────────────────────────────────

/** Cumulative realized P&L across closed trades, chronological. */
export function EquitySparkline({ trades, colors, height = 64 }: {
  trades: ORBTrade[]; colors: any; height?: number;
}) {
  const points = useMemo(() => {
    const closed = trades
      .filter(t => t.exit_time != null)
      .sort((a, b) => (a.exit_time! < b.exit_time! ? -1 : 1));
    let cum = 0;
    const pts = [0, ...closed.map(t => (cum += t.pnl ?? 0))];
    return pts;
  }, [trades]);

  if (points.length < 3) return null;

  const min = Math.min(...points, 0);
  const max = Math.max(...points, 0);
  const range = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * CHART_W;
  const y = (v: number) => height - ((v - min) / range) * height;

  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${CHART_W},${height} L0,${height} Z`;
  const final = points[points.length - 1];
  const tint  = final >= 0 ? colors.success : colors.error;
  const zeroY = y(0);

  return (
    <Svg width={CHART_W} height={height}>
      <Path d={area} fill={tint} opacity={0.12} />
      {zeroY > 1 && zeroY < height - 1 && (
        <Line x1={0} y1={zeroY} x2={CHART_W} y2={zeroY}
              stroke={colors.tabBarInactive} strokeWidth={1} strokeDasharray="3,4" opacity={0.5} />
      )}
      <Path d={line} stroke={tint} strokeWidth={2} fill="none" />
    </Svg>
  );
}

// ── PnlSummaryCard (Trade Log header) ─────────────────────────────────────────

export function PnlSummaryCard({ trades, colors }: { trades: ORBTrade[]; colors: any }) {
  const s = useMemo(() => computeTradeStats(trades), [trades]);
  const heroColor = s.netPnl >= 0 ? colors.success : colors.error;

  return (
    <View style={[a.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={a.heroRow}>
        <View>
          <Text style={[a.heroLabel, { color: colors.tabBarInactive }]}>NET P&L · {s.closedCount} CLOSED</Text>
          <Text style={[a.heroValue, { color: heroColor }]}>{fmtMoney(s.netPnl, 2)}</Text>
        </View>
        {s.winRate != null && (
          <View style={a.heroRight}>
            <Text style={[a.heroWinRate, { color: colors.text }]}>{s.winRate.toFixed(0)}%</Text>
            <Text style={[a.heroLabel, { color: colors.tabBarInactive }]}>WIN RATE</Text>
          </View>
        )}
      </View>

      <EquitySparkline trades={trades} colors={colors} />

      <View style={[a.subRow, { borderTopColor: colors.border }]}>
        <SubStat label="Today"     value={fmtMoney(s.todayPnl)} color={s.todayPnl >= 0 ? colors.success : colors.error} colors={colors} />
        <SubStat label="7 Days"    value={fmtMoney(s.weekPnl)}  color={s.weekPnl >= 0 ? colors.success : colors.error}  colors={colors} />
        <SubStat label="W / L"     value={`${s.wins} / ${s.losses}`} colors={colors} />
        <SubStat
          label="Streak"
          value={s.streak ? `${s.streak.count}${s.streak.kind}` : '—'}
          color={s.streak ? (s.streak.kind === 'W' ? colors.success : colors.error) : undefined}
          colors={colors}
        />
      </View>
    </View>
  );
}

const SubStat = ({ label, value, color, colors }: {
  label: string; value: string; color?: string; colors: any;
}) => (
  <View style={a.subStat}>
    <Text style={[a.subStatValue, { color: color ?? colors.text }]}>{value}</Text>
    <Text style={[a.subStatLabel, { color: colors.tabBarInactive }]}>{label}</Text>
  </View>
);

// ── DayHeader (Trade Log group separator) ─────────────────────────────────────

export function DayHeader({ group, colors }: { group: DayGroup; colors: any }) {
  const tint = group.closedCount === 0 ? colors.tabBarInactive
    : group.netPnl >= 0 ? colors.success : colors.error;
  return (
    <View style={a.dayHeader}>
      <Text style={[a.dayHeaderDate, { color: colors.text }]}>{fmtDay(group.date)}</Text>
      <Text style={[a.dayHeaderMeta, { color: colors.tabBarInactive }]}>
        {group.trades.length} trade{group.trades.length !== 1 ? 's' : ''}
        {group.openCount > 0 ? ` · ${group.openCount} open` : ''}
      </Text>
      <View style={[a.dayHeaderRule, { backgroundColor: colors.border }]} />
      {group.closedCount > 0 && (
        <Text style={[a.dayHeaderPnl, { color: tint }]}>{fmtMoney(group.netPnl)}</Text>
      )}
    </View>
  );
}

// ── StatsHero (Stats tab) ─────────────────────────────────────────────────────

export function StatsHero({ trades, colors }: { trades: ORBTrade[]; colors: any }) {
  const s = useMemo(() => computeTradeStats(trades), [trades]);
  const heroColor = s.netPnl >= 0 ? colors.success : colors.error;
  const pf = s.profitFactor;

  return (
    <View style={[a.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[a.heroLabel, { color: colors.tabBarInactive }]}>NET REALIZED P&L</Text>
      <Text style={[a.heroValueXl, { color: heroColor }]}>{fmtMoney(s.netPnl, 2)}</Text>
      <View style={[a.subRow, { borderTopColor: colors.border }]}>
        <SubStat label="Win Rate" value={s.winRate != null ? `${s.winRate.toFixed(0)}%` : '—'}
                 color={s.winRate != null && s.winRate >= 55 ? colors.success : undefined} colors={colors} />
        <SubStat label="Profit Factor"
                 value={pf == null ? '∞' : pf.toFixed(2)}
                 color={pf == null || pf >= 1.5 ? colors.success : pf < 1 ? colors.error : undefined}
                 colors={colors} />
        <SubStat label="Per Trade" value={fmtMoney(s.expectancy)}
                 color={s.expectancy >= 0 ? colors.success : colors.error} colors={colors} />
      </View>
    </View>
  );
}

// ── DailyPnlChart (Stats tab) ─────────────────────────────────────────────────

export function DailyPnlChart({ trades, colors, days = 15, height = 110 }: {
  trades: ORBTrade[]; colors: any; days?: number; height?: number;
}) {
  const series = useMemo(() => dailyNetSeries(trades).slice(-days), [trades, days]);
  if (series.length < 2) return null;

  const maxAbs = Math.max(...series.map(d => Math.abs(d.pnl)), 1);
  const zeroY  = height / 2;
  const gap    = 3;
  const barW   = Math.max(4, (CHART_W - gap * (series.length - 1)) / series.length);

  return (
    <View style={[a.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[a.sectionTitle, { color: colors.text }]}>Daily P&L</Text>
      <Text style={[a.sectionSub, { color: colors.tabBarInactive }]}>
        Last {series.length} session{series.length !== 1 ? 's' : ''} · realized only
      </Text>
      <Svg width={CHART_W} height={height}>
        <Line x1={0} y1={zeroY} x2={CHART_W} y2={zeroY}
              stroke={colors.tabBarInactive} strokeWidth={1} opacity={0.4} />
        {series.map((d, i) => {
          const h = Math.max(2, (Math.abs(d.pnl) / maxAbs) * (height / 2 - 4));
          const up = d.pnl >= 0;
          return (
            <Rect
              key={d.date}
              x={i * (barW + gap)}
              y={up ? zeroY - h : zeroY}
              width={barW}
              height={h}
              rx={2}
              fill={up ? colors.success : colors.error}
              opacity={0.9}
            />
          );
        })}
      </Svg>
      <View style={a.axisRow}>
        <Text style={[a.axisLabel, { color: colors.tabBarInactive }]}>{fmtDay(series[0].date)}</Text>
        <Text style={[a.axisLabel, { color: colors.tabBarInactive }]}>{fmtDay(series[series.length - 1].date)}</Text>
      </View>
    </View>
  );
}

// ── KeyMetricsGrid (Stats tab) ────────────────────────────────────────────────

export function KeyMetricsGrid({ trades, colors }: { trades: ORBTrade[]; colors: any }) {
  const s = useMemo(() => computeTradeStats(trades), [trades]);
  const hold = s.avgHoldMin == null ? '—'
    : s.avgHoldMin < 60 ? `${Math.round(s.avgHoldMin)}m`
    : `${Math.floor(s.avgHoldMin / 60)}h ${Math.round(s.avgHoldMin % 60)}m`;

  return (
    <View style={[a.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[a.sectionTitle, { color: colors.text }]}>Key Metrics</Text>
      <View style={a.metricGrid}>
        <Metric label="Avg Win"   value={fmtMoney(s.avgWin)}  color={colors.success} colors={colors} />
        <Metric label="Avg Loss"  value={fmtMoney(s.avgLoss)} color={colors.error}   colors={colors} />
        <Metric label="Avg Hold"  value={hold} colors={colors} />
        <Metric label="Best Trade"
                value={s.best ? `${s.best.ticker} ${fmtMoney(s.best.pnl ?? 0)}` : '—'}
                color={colors.success} colors={colors} />
        <Metric label="Worst Trade"
                value={s.worst ? `${s.worst.ticker} ${fmtMoney(s.worst.pnl ?? 0)}` : '—'}
                color={colors.error} colors={colors} />
        <Metric label="Streak"
                value={s.streak ? `${s.streak.count} ${s.streak.kind === 'W' ? 'wins' : 'losses'}` : '—'}
                color={s.streak ? (s.streak.kind === 'W' ? colors.success : colors.error) : undefined}
                colors={colors} />
      </View>
    </View>
  );
}

const Metric = ({ label, value, color, colors }: {
  label: string; value: string; color?: string; colors: any;
}) => (
  <View style={a.metricItem}>
    <Text style={[a.metricLabel, { color: colors.tabBarInactive }]}>{label}</Text>
    <Text style={[a.metricValue, { color: color ?? colors.text }]} numberOfLines={1}>{value}</Text>
  </View>
);

// ── ExitQualityCard (Stats tab) ───────────────────────────────────────────────

const EXIT_BUCKETS: { key: string; label: string; reasons: string[] }[] = [
  { key: 'target',    label: 'Target hit', reasons: ['TP1', 'TP2', 'TP2_FULL_CLOSE', 'RUNNER_TRAIL_STOP'] },
  { key: 'breakeven', label: 'Breakeven',  reasons: ['BREAKEVEN_STOP'] },
  { key: 'stopped',   label: 'Stopped',    reasons: ['HARD_STOP', 'HARD_STOP_FLOOR'] },
  { key: 'eod',       label: 'EOD',        reasons: ['EOD_CLOSE', 'EOD_HARD_CLOSE'] },
  { key: 'other',     label: 'Manual / Other', reasons: [] }, // catch-all
];

export function ExitQualityCard({ trades, colors }: { trades: ORBTrade[]; colors: any }) {
  const buckets = useMemo(() => {
    const closed = trades.filter(t => t.exit_time != null);
    const counts = EXIT_BUCKETS.map(b => ({ ...b, count: 0 }));
    for (const t of closed) {
      const r = t.exit_reason ?? '';
      const hit = counts.find(b => b.reasons.includes(r));
      (hit ?? counts[counts.length - 1]).count++;
    }
    return { counts, total: closed.length };
  }, [trades]);

  if (buckets.total === 0) return null;

  const tint: Record<string, string> = {
    target: colors.success, breakeven: '#F59E0B', stopped: colors.error,
    eod: '#8B5CF6', other: colors.tabBarInactive,
  };

  return (
    <View style={[a.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[a.sectionTitle, { color: colors.text }]}>How Trades Ended</Text>
      <Text style={[a.sectionSub, { color: colors.tabBarInactive }]}>
        More green (targets) than red (stops) is the health signal
      </Text>
      <View style={a.exitBar}>
        {buckets.counts.filter(b => b.count > 0).map(b => (
          <View key={b.key} style={{ flex: b.count, backgroundColor: tint[b.key], height: 10 }} />
        ))}
      </View>
      <View style={a.exitLegend}>
        {buckets.counts.filter(b => b.count > 0).map(b => (
          <View key={b.key} style={a.exitLegendItem}>
            <View style={[a.exitDot, { backgroundColor: tint[b.key] }]} />
            <Text style={[a.exitLegendText, { color: colors.tabBarInactive }]}>
              {b.label} · {b.count}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── ProfileLeaderboard (Stats tab) ────────────────────────────────────────────

const PROFILE_EMOJI: Record<string, string> = {
  BULL_DOG: '🐂', THUNDER_CAT: '🐱', WOLF: '🐺', TREND_RIDER: '🚀',
  RETESTER: '🎯', REVERSAL: '🔄', SCALPER: '⚡', PRECISION: '🎯',
  MOMENTUM: '📈', CONVICTION: '💎', ALL_IN: '🔥', OTM_RUNNER: '🏃',
  OTM_CONVICTION: '🎯', MANUAL: '🖐️', NO_STOP_LOSS: '🧗',
  SL_5: '⏱️', SL_10: '⏳',
};

export function ProfileLeaderboard({ trades, colors }: { trades: ORBTrade[]; colors: any }) {
  const rows = useMemo(() => {
    const closed = trades.filter(t => t.exit_time != null);
    const map = new Map<string, { pnl: number; count: number; wins: number }>();
    for (const t of closed) {
      const key = t.profile ?? 'UNKNOWN';
      const cur = map.get(key) ?? { pnl: 0, count: 0, wins: 0 };
      cur.pnl += t.pnl ?? 0;
      cur.count++;
      if ((t.pnl ?? 0) > 0) cur.wins++;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([profile, v]) => ({ profile, ...v }))
      .sort((x, y) => y.pnl - x.pnl);
  }, [trades]);

  if (rows.length === 0) return null;
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.pnl)), 1);

  return (
    <View style={[a.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[a.sectionTitle, { color: colors.text }]}>Profile Leaderboard</Text>
      <Text style={[a.sectionSub, { color: colors.tabBarInactive }]}>Ranked by realized P&L</Text>
      {rows.map(r => {
        const tintR = r.pnl >= 0 ? colors.success : colors.error;
        return (
          <View key={r.profile} style={a.lbRow}>
            <Text style={[a.lbName, { color: colors.text }]} numberOfLines={1}>
              {PROFILE_EMOJI[r.profile] ?? '📊'} {r.profile.replace(/_/g, ' ')}
            </Text>
            <Text style={[a.lbMeta, { color: colors.tabBarInactive }]}>
              {r.count}t · {r.count ? Math.round((r.wins / r.count) * 100) : 0}%
            </Text>
            <View style={[a.lbTrack, { backgroundColor: colors.border }]}>
              <View style={[a.lbFill, {
                width: `${Math.max(4, Math.round((Math.abs(r.pnl) / maxAbs) * 100))}%`,
                backgroundColor: tintR,
              }]} />
            </View>
            <Text style={[a.lbPnl, { color: tintR }]}>{fmtMoney(r.pnl)}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const a = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },

  heroRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroRight:   { alignItems: 'flex-end' },
  heroLabel:   { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  heroValue:   { fontSize: 28, fontWeight: '800', letterSpacing: 0.2, marginTop: 2 },
  heroValueXl: { fontSize: 32, fontWeight: '800', letterSpacing: 0.2, marginTop: 2 },
  heroWinRate: { fontSize: 20, fontWeight: '800' },

  subRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  subStat:      { alignItems: 'center', flex: 1 },
  subStatValue: { fontSize: 14, fontWeight: '700' },
  subStatLabel: { fontSize: 10, marginTop: 2 },

  sectionTitle: { fontSize: 14, fontWeight: '700' },
  sectionSub:   { fontSize: 11, marginTop: -4 },

  axisRow:   { flexDirection: 'row', justifyContent: 'space-between' },
  axisLabel: { fontSize: 10 },

  metricGrid:  { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  metricItem:  { width: '33.3%' },
  metricLabel: { fontSize: 10, marginBottom: 2 },
  metricValue: { fontSize: 13, fontWeight: '700' },

  exitBar:        { flexDirection: 'row', borderRadius: 5, overflow: 'hidden', gap: 2 },
  exitLegend:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 },
  exitLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  exitDot:        { width: 8, height: 8, borderRadius: 4 },
  exitLegendText: { fontSize: 11 },

  lbRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  lbName:  { fontSize: 12, fontWeight: '600', width: 118 },
  lbMeta:  { fontSize: 10, width: 52 },
  lbTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  lbFill:  { height: '100%', borderRadius: 3 },
  lbPnl:   { fontSize: 12, fontWeight: '700', width: 58, textAlign: 'right' },

  dayHeader:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 2 },
  dayHeaderDate: { fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  dayHeaderMeta: { fontSize: 11 },
  dayHeaderRule: { flex: 1, height: StyleSheet.hairlineWidth },
  dayHeaderPnl:  { fontSize: 13, fontWeight: '800' },
});
