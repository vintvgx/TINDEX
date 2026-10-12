import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAlpacaBothAccounts } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { usePnlSummary } from '@/hooks/queries/strategy/usePnlSummary';
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';
import { useSocialSignalContracts } from '@/hooks/queries/social/useSocialSignalContracts';
import { useMarketDigest } from '@/hooks/queries/digest/useMarketDigest';
import { isMuseBriefContent } from '@/common/types/marketDigest';
import { accountAvailableFunds } from './views/DynamicAccountView';
import type { DynamicViewKey, TickerInfo } from './DynamicCard';

/**
 * The collapsed dynamic card's one-line strip — a SHORT version of
 * whichever view is showing (each view's own data, not the chart ticker on
 * every page). Same queries as the full views, so they're cache hits.
 */

type Colors = ReturnType<typeof useThemeColors>;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const money = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v: number) => `${v >= 0 ? '+' : '-'}${money(Math.abs(v))}`;

/** `step` (any integer, from swipes) → an index into a list of length n. */
const pick = (step: number, n: number) => (n > 0 ? ((step % n) + n) % n : 0);

function Strip({ title, main, sub, subColor, colors, pos, total }: {
  title: string; main: string; sub?: string | null; subColor?: string; colors: Colors;
  /** "n/N" counter when the page has more than one item to swipe through. */
  pos?: number; total?: number;
}) {
  return (
    <>
      <Text style={[styles.mono, { fontSize: 14, fontWeight: '800', color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
        {main}
      </Text>
      {sub ? (
        <Text style={[styles.mono, { fontSize: 12, fontWeight: '700', color: subColor ?? colors.textSecondary, flexShrink: 1 }]} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>
        {title}{total != null && total > 1 && pos != null ? ` ${pos + 1}/${total}` : ''}
      </Text>
    </>
  );
}

function ChartsStrip({ info, colors }: { info: TickerInfo; colors: Colors }) {
  const up = (info.changePct ?? 0) >= 0;
  return (
    <>
      <Text style={[styles.mono, { fontSize: 14, fontWeight: '800', color: colors.text }]}>{info.ticker || '—'}</Text>
      {info.price != null && (
        <Text style={[styles.mono, { fontSize: 14, color: colors.textSecondary }]}>${info.price.toFixed(2)}</Text>
      )}
      {info.changePct != null && (
        <Text style={[styles.mono, { fontSize: 12, fontWeight: '700', color: up ? colors.success : colors.error }]}>
          {up ? '+' : ''}{info.changePct.toFixed(2)}%
        </Text>
      )}
      <View style={{ flex: 1 }} />
      <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>CHARTS</Text>
    </>
  );
}

/** Up/down: live ↔ paper. */
function AccountStrip({ colors, step }: { colors: Colors; step: number }) {
  const { data: accounts } = useAlpacaBothAccounts();
  const i = pick(step, 2);
  const mode = i === 0 ? 'live' : 'paper';
  // Same unified figure as the expanded account view's TODAY cell.
  const { data: pnl } = usePnlSummary(mode);
  const avail = accountAvailableFunds(mode === 'live' ? accounts?.live : accounts?.paper);
  const today = pnl?.today.total;
  return (
    <Strip
      title={mode === 'live' ? 'LIVE ACCOUNT' : 'PAPER ACCOUNT'}
      main={avail != null ? money(avail) : '—'}
      sub={today != null ? `${signed(today)} today` : null}
      subColor={today != null ? (today >= 0 ? colors.success : colors.error) : undefined}
      colors={colors}
      pos={i}
      total={2}
    />
  );
}

/** Up/down: the regime summary, then each watchlist play. */
function BriefStrip({ colors, step }: { colors: Colors; step: number }) {
  const { data } = useMarketDigest(todayISO());
  const content = data?.data?.content_json;
  const brief = isMuseBriefContent(content) ? content : null;
  const regime = brief?.market.regime;
  const regimeColor = regime === 'risk-on' ? colors.success : regime === 'risk-off' ? colors.error : colors.warning;
  const plays = brief?.watchlist ?? [];
  const total = brief ? 1 + plays.length : 1;
  const i = pick(step, total);
  if (!brief || i === 0) {
    const top = plays[0];
    return (
      <Strip
        title="BRIEF"
        main={brief ? (regime ?? 'brief').toUpperCase() : 'No brief yet'}
        sub={top ? `Top: ${top.ticker} ${top.direction}` : null}
        subColor={brief ? regimeColor : undefined}
        colors={colors}
        pos={i}
        total={total}
      />
    );
  }
  const p = plays[i - 1];
  return (
    <Strip
      title="BRIEF"
      main={`${p.ticker} ${p.direction}`}
      sub={p.trigger != null ? `trigger $${p.trigger.toFixed(2)}${p.target != null ? ` → $${p.target.toFixed(2)}` : ''}` : `score ${p.score}`}
      subColor={p.direction === 'CALL' ? colors.success : colors.error}
      colors={colors}
      pos={i}
      total={total}
    />
  );
}

/** Up/down: the total, then each open position. */
function OpenStrip({ colors, step }: { colors: Colors; step: number }) {
  const live = useLivePositionsData('live');
  const paper = useLivePositionsData('paper');
  const all = useMemo(
    () => [...live.filteredPositions, ...paper.filteredPositions],
    [live.filteredPositions, paper.filteredPositions],
  );
  const pnl = all.reduce((s, p) => s + (p.unrealized_pnl ?? 0), 0);
  const total = all.length ? 1 + all.length : 1;
  const i = pick(step, total);
  if (i === 0) {
    return (
      <Strip
        title="OPEN"
        main={`${all.length} open`}
        sub={all.length > 0 ? signed(pnl) : null}
        subColor={pnl >= 0 ? colors.success : colors.error}
        colors={colors}
        pos={i}
        total={total}
      />
    );
  }
  const p = all[i - 1];
  const pp = p.unrealized_pnl ?? 0;
  return (
    <Strip
      title={p.paper_mode ? 'OPEN · PAPER' : 'OPEN · LIVE'}
      main={`${p.ticker} ${p.direction ?? ''} ×${p.qty_remaining ?? 0}`}
      sub={`${signed(pp)}${p.unrealized_pnl_pct != null ? ` (${p.unrealized_pnl_pct >= 0 ? '+' : ''}${p.unrealized_pnl_pct.toFixed(1)}%)` : ''}`}
      subColor={pp >= 0 ? colors.success : colors.error}
      colors={colors}
      pos={i}
      total={total}
    />
  );
}

/** Up/down: the count, then each watched contract. */
function WatchedStrip({ colors, step }: { colors: Colors; step: number }) {
  const { data } = useTrackedContracts();
  const watched = (data ?? []).filter((c) => c.status === 'tracking' || c.status === 'entered');
  const total = watched.length ? 1 + watched.length : 1;
  const i = pick(step, total);
  if (i === 0) {
    const tickers = Array.from(new Set(watched.map((c) => c.ticker))).slice(0, 3).join(' · ');
    return <Strip title="WATCHED" main={`${watched.length} watching`} sub={tickers || null} colors={colors} pos={i} total={total} />;
  }
  const c = watched[i - 1];
  return (
    <Strip
      title="WATCHED"
      main={`${c.ticker} ${c.strike}${c.option_type === 'CALL' ? 'C' : 'P'}`}
      sub={`${c.expiration_date?.slice(5) ?? ''}${c.status === 'entered' ? ' · entered' : ''}`}
      subColor={c.option_type === 'CALL' ? colors.success : colors.error}
      colors={colors}
      pos={i}
      total={total}
    />
  );
}

/** Up/down: each headline. */
function NewsStrip({ colors, step }: { colors: Colors; step: number }) {
  const { data } = useMarketDigest(todayISO());
  const content = data?.data?.content_json;
  const brief = isMuseBriefContent(content) ? content : null;
  const news = brief?.news ?? [];
  const i = pick(step, news.length);
  const item = news[i];
  return (
    <>
      <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: colors.text }} numberOfLines={1}>
        {item?.headline ?? 'No headlines yet'}
      </Text>
      <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>
        NEWS{news.length > 1 ? ` ${i + 1}/${news.length}` : ''}
      </Text>
    </>
  );
}

/** Up/down: the count, then each live signal. */
function SignalsStrip({ colors, step }: { colors: Colors; step: number }) {
  const { data } = useSocialSignalContracts();
  const tracking = (data ?? []).filter((c) => c.status === 'tracking');
  const total = tracking.length ? 1 + tracking.length : 1;
  const i = pick(step, total);
  if (i === 0) {
    const latest = tracking[0];
    return (
      <Strip
        title="SIGNALS"
        main={`${tracking.length} live`}
        sub={latest ? `${latest.ticker} ${latest.option_type} ${latest.strike}` : null}
        colors={colors}
        pos={i}
        total={total}
      />
    );
  }
  const c = tracking[i - 1];
  return (
    <Strip
      title="SIGNALS"
      main={`${c.ticker} ${c.option_type} ${c.strike}`}
      sub={null}
      colors={colors}
      pos={i}
      total={total}
    />
  );
}

/**
 * `step` — the minimized card's up/down swipe counter (DynamicCard resets it
 * on every page change). Each page cycles its own items with it; Charts
 * steps the chart deck's ticker directly instead (stepChartsTicker).
 */
export function DynamicCollapsedSummary({ view, tickerInfo, step = 0 }: {
  view: DynamicViewKey; tickerInfo: TickerInfo; step?: number;
}) {
  const colors = useThemeColors();
  switch (view) {
    case 'charts': return <ChartsStrip info={tickerInfo} colors={colors} />;
    case 'account': return <AccountStrip colors={colors} step={step} />;
    case 'brief': return <BriefStrip colors={colors} step={step} />;
    case 'open': return <OpenStrip colors={colors} step={step} />;
    case 'watched': return <WatchedStrip colors={colors} step={step} />;
    case 'news': return <NewsStrip colors={colors} step={step} />;
    case 'signals': return <SignalsStrip colors={colors} step={step} />;
  }
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
});
