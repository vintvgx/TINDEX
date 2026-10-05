import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '@/lib/useColorScheme';
import { useAlpacaBothAccounts, useAlpacaAccountsHistory } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { useLivePositionsData } from '@/common/components/strategy/LivePositionsSection';
import { useTrackedContracts } from '@/hooks/queries/track/useTrackedContracts';
import { useSocialSignalContracts } from '@/hooks/queries/social/useSocialSignalContracts';
import { useMarketDigest } from '@/hooks/queries/digest/useMarketDigest';
import { isMuseBriefContent } from '@/common/types/marketDigest';
import { liveAvailableFunds } from './views/DynamicAccountView';
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

function Strip({ title, main, sub, subColor, colors }: {
  title: string; main: string; sub?: string | null; subColor?: string; colors: Colors;
}) {
  return (
    <>
      <Text style={[styles.mono, { fontSize: 14, fontWeight: '800', color: colors.text }]} numberOfLines={1}>
        {main}
      </Text>
      {sub ? (
        <Text style={[styles.mono, { fontSize: 12, fontWeight: '700', color: subColor ?? colors.textSecondary }]} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>{title}</Text>
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

function AccountStrip({ colors }: { colors: Colors }) {
  const { data: accounts } = useAlpacaBothAccounts();
  const { data: history } = useAlpacaAccountsHistory();
  const avail = liveAvailableFunds(accounts);
  const today = history?.live?.pnl_today ?? accounts?.live?.pnl_today;
  return (
    <Strip
      title="LIVE ACCOUNT"
      main={avail != null ? money(avail) : '—'}
      sub={today != null ? `${signed(today)} today` : null}
      subColor={today != null ? (today >= 0 ? colors.success : colors.error) : undefined}
      colors={colors}
    />
  );
}

function BriefStrip({ colors }: { colors: Colors }) {
  const { data } = useMarketDigest(todayISO());
  const content = data?.data?.content_json;
  const brief = isMuseBriefContent(content) ? content : null;
  const regime = brief?.market.regime;
  const regimeColor = regime === 'risk-on' ? colors.success : regime === 'risk-off' ? colors.error : colors.warning;
  const top = brief?.watchlist?.[0];
  return (
    <Strip
      title="BRIEF"
      main={brief ? (regime ?? 'brief').toUpperCase() : 'No brief yet'}
      sub={top ? `Top: ${top.ticker} ${top.direction}` : null}
      subColor={brief ? regimeColor : undefined}
      colors={colors}
    />
  );
}

function OpenStrip({ colors }: { colors: Colors }) {
  const live = useLivePositionsData('live');
  const paper = useLivePositionsData('paper');
  const { count, pnl } = useMemo(() => {
    const all = [...live.filteredPositions, ...paper.filteredPositions];
    return { count: all.length, pnl: all.reduce((s, p) => s + (p.unrealized_pnl ?? 0), 0) };
  }, [live.filteredPositions, paper.filteredPositions]);
  return (
    <Strip
      title="OPEN"
      main={`${count} open`}
      sub={count > 0 ? signed(pnl) : null}
      subColor={pnl >= 0 ? colors.success : colors.error}
      colors={colors}
    />
  );
}

function WatchedStrip({ colors }: { colors: Colors }) {
  const { data } = useTrackedContracts();
  const watched = (data ?? []).filter((c) => c.status === 'tracking' || c.status === 'entered');
  const tickers = Array.from(new Set(watched.map((c) => c.ticker))).slice(0, 3).join(' · ');
  return <Strip title="WATCHED" main={`${watched.length} watching`} sub={tickers || null} colors={colors} />;
}

function NewsStrip({ colors }: { colors: Colors }) {
  const { data } = useMarketDigest(todayISO());
  const content = data?.data?.content_json;
  const brief = isMuseBriefContent(content) ? content : null;
  const first = brief?.news?.[0];
  return (
    <>
      <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: colors.text }} numberOfLines={1}>
        {first?.headline ?? 'No headlines yet'}
      </Text>
      <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary }]}>NEWS</Text>
    </>
  );
}

function SignalsStrip({ colors }: { colors: Colors }) {
  const { data } = useSocialSignalContracts();
  const tracking = (data ?? []).filter((c) => c.status === 'tracking');
  const latest = tracking[0];
  return (
    <Strip
      title="SIGNALS"
      main={`${tracking.length} live`}
      sub={latest ? `${latest.ticker} ${latest.option_type} ${latest.strike}` : null}
      colors={colors}
    />
  );
}

export function DynamicCollapsedSummary({ view, tickerInfo }: { view: DynamicViewKey; tickerInfo: TickerInfo }) {
  const colors = useThemeColors();
  switch (view) {
    case 'charts': return <ChartsStrip info={tickerInfo} colors={colors} />;
    case 'account': return <AccountStrip colors={colors} />;
    case 'brief': return <BriefStrip colors={colors} />;
    case 'open': return <OpenStrip colors={colors} />;
    case 'watched': return <WatchedStrip colors={colors} />;
    case 'news': return <NewsStrip colors={colors} />;
    case 'signals': return <SignalsStrip colors={colors} />;
  }
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
});
