import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Linking, Dimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { useThemeColors } from '@/lib/useColorScheme';
import type {
  MarketDigestContent, DigestWatchlistTicker, DigestTrendingTicker, DigestMover,
} from '@/common/types/marketDigest';
import { DigestBarChart } from './DigestBarChart';

type Colors = ReturnType<typeof useThemeColors>;

const SCREEN_W = Dimensions.get('window').width;
const SLIDE_PAD = 20;

// Robinhood's signature gain/loss green & red — used for every price move in
// this digest (independent of the app's own theme accent) per the "Robinhood
// influenced" restyle.
const RH_GREEN = '#00C805';
const RH_RED = '#FF5000';

/** Small source favicon via Google's public favicon endpoint — no backend
 *  round-trip, degrades to nothing if the URL is missing/unparseable. */
function faviconUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
  } catch {
    return null;
  }
}

function Favicon({ url, size = 16 }: { url: string | null | undefined; size?: number }) {
  const src = faviconUrl(url);
  if (!src) return null;
  return (
    <Image
      source={{ uri: src }}
      style={{ width: size, height: size, borderRadius: size / 4 }}
    />
  );
}

// ── Shared atoms ─────────────────────────────────────────────────────────────

export function SlideLabel({ label, right, colors }: { label: string; right?: string; colors: Colors }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '700', letterSpacing: 1.2 }}>
        {label.toUpperCase()}
      </Text>
      {right && <Text style={{ color: colors.textTertiary, fontSize: 12, letterSpacing: 0.5 }}>{right}</Text>}
    </View>
  );
}

export function SlideTitle({ children, colors }: { children: React.ReactNode; colors: Colors }) {
  return (
    <Text style={{ color: colors.text, fontSize: 27, fontWeight: '800', lineHeight: 33, marginBottom: 20 }}>
      {children}
    </Text>
  );
}

export function SourceTag({ source, colors }: { source: { label: string; url: string } | null | undefined; colors: Colors }) {
  if (!source?.label) return null;
  return (
    <TouchableOpacity
      disabled={!source.url}
      onPress={() => source.url && Linking.openURL(source.url)}
      activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 }}
    >
      {faviconUrl(source.url)
        ? <Favicon url={source.url} size={13} />
        : <Ionicons name="link-outline" size={12} color={colors.textTertiary} />}
      <Text style={{ color: colors.textTertiary, fontSize: 11 }}>{source.label}</Text>
    </TouchableOpacity>
  );
}

function pctColor(v: number | null | undefined, colors: Colors) {
  if (v == null) return colors.textSecondary;
  return v >= 0 ? RH_GREEN : RH_RED;
}

function fmtPct(v: number | null | undefined) {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtMoney(v: number, decimals = 2) {
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(decimals)}`;
}

export function EmptyNote({ text, colors }: { text: string; colors: Colors }) {
  return <Text style={{ color: colors.textTertiary, fontSize: 13, fontStyle: 'italic' }}>{text}</Text>;
}

/** Robinhood-style tinted percent-change pill — used everywhere a move needs
 *  to read at a glance instead of as plain colored text. */
export function PctBadge({ v, size = 'md' }: { v: number | null | undefined; size?: 'sm' | 'md' }) {
  const color = v == null ? '#8E8E93' : v >= 0 ? RH_GREEN : RH_RED;
  const small = size === 'sm';
  return (
    <View style={{
      backgroundColor: color + '1F', borderRadius: 999,
      paddingHorizontal: small ? 8 : 10, paddingVertical: small ? 3 : 5,
    }}>
      <Text style={{ color, fontSize: small ? 11 : 13, fontWeight: '800' }}>{fmtPct(v)}</Text>
    </View>
  );
}

// ── 1. Market Setup ──────────────────────────────────────────────────────────

function MacroStatTile({ stat, colors }: { stat: MarketDigestContent['market_setup']['stats'][number]; colors: Colors }) {
  const unit = stat.kind === 'yield' ? '%' : stat.kind === 'currency' ? '' : '';
  const prefix = stat.kind === 'currency' ? '$' : '';
  return (
    <View style={{
      width: '48%', backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
      padding: 14, marginBottom: 10,
    }}>
      <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '600', marginBottom: 6 }}>{stat.label}</Text>
      <Text style={{ color: colors.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 }}>
        {prefix}{stat.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit}
      </Text>
      <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
        <PctBadge v={stat.change_percent} size="sm" />
      </View>
    </View>
  );
}

export function MarketSetupSlide({ data, dateLabel, colors }: { data: MarketDigestContent; dateLabel: string; colors: Colors }) {
  const stats = data.market_setup.stats;
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD }}>
      <SlideLabel label="Market Setup" right={dateLabel} colors={colors} />
      <SlideTitle colors={colors}>
        {data.market_setup.note || 'Live levels for today’s session.'}
      </SlideTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {stats.length === 0
          ? <EmptyNote text="Macro levels unavailable." colors={colors} />
          : stats.map(s => <MacroStatTile key={s.symbol} stat={s} colors={colors} />)}
      </View>
      <SourceTag source={data.market_setup.source} colors={colors} />
    </View>
  );
}

// ── 2. Overnight & Pre-Market Headlines ──────────────────────────────────────

export function HeadlinesSlide({ data, dateLabel, colors }: { data: MarketDigestContent; dateLabel: string; colors: Colors }) {
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD }}>
      <SlideLabel label="Overnight & Pre-Market" right={dateLabel} colors={colors} />
      <SlideTitle colors={colors}>What moved the tape since yesterday’s close</SlideTitle>
      {data.headlines.length === 0 && <EmptyNote text="No headlines found." colors={colors} />}
      {data.headlines.map((h, i) => (
        <TouchableOpacity
          key={i}
          disabled={!h.url}
          onPress={() => h.url && Linking.openURL(h.url)}
          activeOpacity={0.7}
          style={{
            backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
            padding: 16, marginBottom: 12,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '500' }}>{h.text}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
            <Favicon url={h.url} size={14} />
            <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>
              {h.source?.toUpperCase()}
            </Text>
            {!!h.url && (
              <Ionicons name="chevron-forward" size={12} color={colors.textTertiary} style={{ marginLeft: 'auto' }} />
            )}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── 3. Watchlist (My Watchlist / Trending toggle) ────────────────────────────

function MyTickerRow({ t, colors }: { t: DigestWatchlistTicker; colors: Colors }) {
  return (
    <View style={{
      backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
      padding: 16, marginBottom: 10,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 }}>{t.ticker}</Text>
        <PctBadge v={t.change_percent} />
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 8, lineHeight: 18 }}>{t.catalyst}</Text>
      {t.level && (
        <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 6 }}>Level: {t.level}</Text>
      )}
    </View>
  );
}

function TrendingRow({ t, colors }: { t: DigestTrendingTicker; colors: Colors }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
      padding: 16, marginBottom: 10,
    }}>
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 }}>{t.ticker}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 3 }} numberOfLines={1}>{t.company}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>
          {t.price != null ? `$${t.price.toFixed(2)}` : '—'}
        </Text>
        <PctBadge v={t.change_percent} size="sm" />
      </View>
    </View>
  );
}

export function WatchlistSlide({ data, dateLabel, colors }: { data: MarketDigestContent; dateLabel: string; colors: Colors }) {
  const [tab, setTab] = useState<'mine' | 'trending'>('mine');
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD }}>
      <SlideLabel label="Watchlist" right={dateLabel} colors={colors} />
      <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 3, marginBottom: 18 }}>
        {(['mine', 'trending'] as const).map(key => (
          <TouchableOpacity
            key={key}
            onPress={() => setTab(key)}
            activeOpacity={0.8}
            style={{
              flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center',
              backgroundColor: tab === key ? colors.accent : 'transparent',
            }}
          >
            <Text style={{
              fontSize: 13, fontWeight: '700',
              color: tab === key ? colors.accentForeground : colors.textSecondary,
            }}>
              {key === 'mine' ? 'My Watchlist' : 'Trending'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'mine'
        ? (data.watchlist.mine.length === 0
          ? <EmptyNote text="No watchlist configured." colors={colors} />
          : data.watchlist.mine.map(t => <MyTickerRow key={t.ticker} t={t} colors={colors} />))
        : (data.watchlist.trending.length === 0
          ? <EmptyNote text="Trending data unavailable." colors={colors} />
          : data.watchlist.trending.map(t => <TrendingRow key={t.ticker} t={t} colors={colors} />))}
      {tab === 'trending' && (
        <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 4 }}>via Yahoo Finance</Text>
      )}
    </View>
  );
}

// ── 4. Pre-Market Movers ─────────────────────────────────────────────────────

function MoverRow({ m, colors }: { m: DigestMover; colors: Colors }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{m.ticker}</Text>
        <PctBadge v={m.change_percent} size="sm" />
      </View>
      {!!m.reason && <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 5, lineHeight: 16 }}>{m.reason}</Text>}
    </View>
  );
}

export function MoversSlide({ data, dateLabel, colors }: { data: MarketDigestContent; dateLabel: string; colors: Colors }) {
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD }}>
      <SlideLabel label="Pre-Market Movers" right={dateLabel} colors={colors} />
      <SlideTitle colors={colors}>Biggest moves across the whole market</SlideTitle>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{
          flex: 1, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1,
          borderColor: RH_GREEN + '33', padding: 14,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 12 }}>
            <Ionicons name="trending-up" size={13} color={RH_GREEN} />
            <Text style={{ color: RH_GREEN, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }}>GAINERS</Text>
          </View>
          {data.movers.gainers.length === 0
            ? <EmptyNote text="—" colors={colors} />
            : data.movers.gainers.map(m => <MoverRow key={m.ticker} m={m} colors={colors} />)}
        </View>
        <View style={{
          flex: 1, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1,
          borderColor: RH_RED + '33', padding: 14,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 12 }}>
            <Ionicons name="trending-down" size={13} color={RH_RED} />
            <Text style={{ color: RH_RED, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }}>LOSERS</Text>
          </View>
          {data.movers.losers.length === 0
            ? <EmptyNote text="—" colors={colors} />
            : data.movers.losers.map(m => <MoverRow key={m.ticker} m={m} colors={colors} />)}
        </View>
      </View>
    </View>
  );
}

// ── 5. Earnings & Events ─────────────────────────────────────────────────────

export function EventsSlide({ data, dateLabel, colors }: { data: MarketDigestContent; dateLabel: string; colors: Colors }) {
  const before = data.events.earnings.filter(e => e.when === 'before_open');
  const after  = data.events.earnings.filter(e => e.when === 'after_close');
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD }}>
      <SlideLabel label="Earnings & Events" right={dateLabel} colors={colors} />
      <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>EARNINGS TODAY</Text>
      {data.events.earnings.length === 0 && <EmptyNote text="Nothing notable." colors={colors} />}
      {before.length > 0 && (
        <View style={{ marginBottom: 10 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, marginBottom: 4 }}>Before Open</Text>
          {before.map((e, i) => (
            <Text key={i} style={{ color: colors.text, fontSize: 13, marginBottom: 3 }}>
              <Text style={{ fontWeight: '800' }}>{e.ticker}</Text>  {e.note}
            </Text>
          ))}
        </View>
      )}
      {after.length > 0 && (
        <View style={{ marginBottom: 18 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, marginBottom: 4 }}>After Close</Text>
          {after.map((e, i) => (
            <Text key={i} style={{ color: colors.text, fontSize: 13, marginBottom: 3 }}>
              <Text style={{ fontWeight: '800' }}>{e.ticker}</Text>  {e.note}
            </Text>
          ))}
        </View>
      )}

      <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>ECONOMIC CALENDAR</Text>
      {data.events.economic.length === 0 && <EmptyNote text="Nothing scheduled." colors={colors} />}
      {data.events.economic.map((e, i) => (
        <View key={i} style={{ flexDirection: 'row', marginBottom: 8 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 12, width: 78 }}>{e.time_et}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{e.label}</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>Cons. {e.consensus} · Prior {e.prior}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── 6. What to Watch Into the Open ───────────────────────────────────────────

export function WatchSlide({ data, dateLabel, colors }: { data: MarketDigestContent; dateLabel: string; colors: Colors }) {
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD }}>
      <SlideLabel label="What to Watch" right={dateLabel} colors={colors} />
      <SlideTitle colors={colors}>Into the open</SlideTitle>
      {data.what_to_watch.length === 0 && <EmptyNote text="Nothing flagged today." colors={colors} />}
      {data.what_to_watch.map((line, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 7 }} />
          <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21, flex: 1 }}>{line}</Text>
        </View>
      ))}
    </View>
  );
}

// ── 7. Your Trading ──────────────────────────────────────────────────────────

function TradingStatCard({ label, netPnl, tradeCount, winRate, sub, colors, chart }: {
  label: string; netPnl: number; tradeCount: number; winRate: number; sub?: string; colors: Colors;
  chart?: React.ReactNode;
}) {
  return (
    <View style={{
      backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
      padding: 16, marginBottom: 12,
    }}>
      <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 }}>
        {label.toUpperCase()}
      </Text>
      {sub && <Text style={{ color: colors.textTertiary, fontSize: 10, marginTop: 1 }}>{sub}</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
        <Text style={{ color: pctColor(netPnl, colors), fontSize: 24, fontWeight: '800' }}>{fmtMoney(netPnl)}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          {tradeCount} trade{tradeCount === 1 ? '' : 's'} · {winRate.toFixed(0)}% win rate
        </Text>
      </View>
      {chart}
    </View>
  );
}

export function TradingSlide({ data, dateLabel, colors }: { data: MarketDigestContent; dateLabel: string; colors: Colors }) {
  const { last_session, week, all_time, advice } = data.trading;
  const chartW = SCREEN_W - SLIDE_PAD * 2 - 32;
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD }}>
      <SlideLabel label="Your Trading" right={dateLabel} colors={colors} />
      <SlideTitle colors={colors}>Live account performance</SlideTitle>

      {last_session
        ? <TradingStatCard label="Last Session" sub={last_session.date} netPnl={last_session.net_pnl}
            tradeCount={last_session.trade_count} winRate={last_session.win_rate} colors={colors} />
        : <EmptyNote text="No prior session on record." colors={colors} />}

      {week && (
        <TradingStatCard
          label="This Week" netPnl={week.net_pnl} tradeCount={week.trade_count} winRate={week.win_rate}
          colors={colors}
          chart={week.daily.length > 1
            ? <View style={{ marginTop: 12 }}>
                <DigestBarChart values={week.daily.map(d => d.net_pnl)} width={chartW} colors={colors} />
              </View>
            : undefined}
        />
      )}

      {all_time && (
        <TradingStatCard label="All-Time" netPnl={all_time.net_pnl} tradeCount={all_time.trade_count}
          winRate={all_time.win_rate} colors={colors} />
      )}

      {!!advice && (
        <View style={{
          backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 14, marginTop: 6,
          flexDirection: 'row', gap: 10,
        }}>
          <Ionicons name="bulb-outline" size={16} color={colors.accent} style={{ marginTop: 1 }} />
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19, flex: 1 }}>{advice}</Text>
        </View>
      )}
    </View>
  );
}

// ── 8. Happy Trading (close) ─────────────────────────────────────────────────

export function ClosingSlide({ onClose, colors }: { onClose: () => void; colors: Colors }) {
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD, flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 44, marginBottom: 18 }}>📈</Text>
      <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center' }}>Happy Trading</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 10, lineHeight: 20 }}>
        That’s today’s digest. Trade the plan, not the noise.
      </Text>
      <TouchableOpacity
        onPress={onClose}
        activeOpacity={0.85}
        style={{
          marginTop: 32, backgroundColor: colors.accent, borderRadius: 14,
          paddingVertical: 14, paddingHorizontal: 36,
        }}
      >
        <Text style={{ color: colors.accentForeground, fontSize: 15, fontWeight: '700' }}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}
