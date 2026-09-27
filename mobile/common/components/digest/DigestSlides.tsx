import React from 'react';
import { View, Text, TouchableOpacity, Linking, Dimensions, Image, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { useThemeColors } from '@/lib/useColorScheme';
import type {
  MarketDigestContent, DigestWatchlistTicker, DigestTrendingTicker, DigestMover, DigestKeyLevel,
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
const AMBER = '#FF9F0A';

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

/** Apple-ish grouped-card look — generous radius, a hairline border for
 *  definition in light mode, and a soft shadow for depth in dark mode where
 *  the border alone barely reads against a near-black background. */
function cardStyle(colors: Colors): ViewStyle {
  return {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  };
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

/** `size="lg"` (default) is the big editorial headline used for short punchy
 *  lines ("Into the open"). `size="md"` is for a slide whose title is really
 *  a full sentence (Market Setup's overnight note) — full Header-1 styling
 *  read as overdone once that sentence got long, so this reads as a
 *  confident subhead instead of a shouted headline. */
export function SlideTitle({ children, colors, size = 'lg' }: { children: React.ReactNode; colors: Colors; size?: 'lg' | 'md' }) {
  const lg = size === 'lg';
  return (
    <Text style={{
      color: colors.text,
      fontSize: lg ? 27 : 18,
      fontWeight: lg ? '800' : '700',
      lineHeight: lg ? 33 : 24,
      letterSpacing: lg ? -0.3 : -0.1,
      marginBottom: lg ? 20 : 16,
    }}>
      {children}
    </Text>
  );
}

/** Section header for a grouped list (Watchlist's Key Levels/My
 *  Watchlist/Trending, stacked on one page) — an icon + title plus a
 *  one-line purpose so each section reads as "why this is here," not just a
 *  label. */
function SectionHeader({ icon, title, subtitle, colors }: {
  icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; colors: Colors;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Ionicons name={icon} size={15} color={colors.text} />
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>{title}</Text>
      </View>
      <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 3, lineHeight: 16 }}>{subtitle}</Text>
    </View>
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
    <View style={[cardStyle(colors), { width: '48%', padding: 14, marginBottom: 10 }]}>
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
      <SlideTitle colors={colors} size="md">
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
  const summary = data.headlines_summary ?? [];
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD }}>
      <SlideLabel label="Overnight & Pre-Market" right={dateLabel} colors={colors} />
      <SlideTitle colors={colors}>What moved the tape since yesterday’s close</SlideTitle>

      {summary.length > 0 && (
        <View style={[cardStyle(colors), { marginBottom: 18 }]}>
          {summary.map((line, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10, marginBottom: i === summary.length - 1 ? 0 : 10 }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.accent, marginTop: 7 }} />
              <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 }}>{line}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 10 }}>
        SOURCES
      </Text>
      {data.headlines.length === 0 && <EmptyNote text="No headlines found." colors={colors} />}
      {data.headlines.map((h, i) => (
        <TouchableOpacity
          key={i}
          disabled={!h.url}
          onPress={() => h.url && Linking.openURL(h.url)}
          activeOpacity={0.7}
          style={[cardStyle(colors), { marginBottom: 12 }]}
        >
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500' }}>{h.text}</Text>
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

// ── 3. Watchlist (Key Levels, My Watchlist, Trending — one continuous page) ──

function VerdictBadge({ verdict }: { verdict: DigestKeyLevel['verdict'] }) {
  if (!verdict) return null;
  const meta = {
    on_track: { label: 'On Track', color: RH_GREEN, icon: 'trending-up' as const },
    stalling: { label: 'Stalling', color: AMBER, icon: 'remove' as const },
    failing:  { label: 'Failing', color: RH_RED, icon: 'trending-down' as const },
  }[verdict];
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: meta.color + '1F', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
    }}>
      <Ionicons name={meta.icon} size={11} color={meta.color} />
      <Text style={{ color: meta.color, fontSize: 11, fontWeight: '800' }}>{meta.label}</Text>
    </View>
  );
}

function KeyLevelCard({ lvl, colors }: { lvl: DigestKeyLevel; colors: Colors }) {
  const rangeLabel = lvl.level_low === lvl.level_high
    ? `$${lvl.level_low.toFixed(2)}`
    : `$${lvl.level_low.toFixed(2)}–$${lvl.level_high.toFixed(2)}`;
  const dirIcon = lvl.direction === 'bullish' ? 'arrow-up-circle' : lvl.direction === 'bearish' ? 'arrow-down-circle' : 'swap-vertical';
  const dirColor = lvl.direction === 'bullish' ? RH_GREEN : lvl.direction === 'bearish' ? RH_RED : colors.textSecondary;
  return (
    <View style={[cardStyle(colors), { marginBottom: 10 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name={dirIcon} size={18} color={dirColor} />
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 }}>{lvl.ticker}</Text>
        </View>
        <VerdictBadge verdict={lvl.verdict} />
      </View>
      <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 8 }}>
        Level {rangeLabel} · {lvl.status === 'confirmed' ? 'Confirmed' : 'Watching'}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>
          {lvl.price != null ? `$${lvl.price.toFixed(2)}` : '—'}
        </Text>
        <PctBadge v={lvl.change_percent} size="sm" />
      </View>
      {!!lvl.analysis && (
        <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 8, lineHeight: 18 }}>{lvl.analysis}</Text>
      )}
    </View>
  );
}

function MyTickerRow({ t, colors, last }: { t: DigestWatchlistTicker; colors: Colors; last: boolean }) {
  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.separator }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 }}>{t.ticker}</Text>
        <PctBadge v={t.change_percent} size="sm" />
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 5, lineHeight: 18 }}>{t.catalyst}</Text>
      {t.level && (
        <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 4 }}>Level: {t.level}</Text>
      )}
    </View>
  );
}

function TrendingRow({ t, colors, last }: { t: DigestTrendingTicker; colors: Colors; last: boolean }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.separator,
    }}>
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800', letterSpacing: -0.2 }}>{t.ticker}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{t.company}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
          {t.price != null ? `$${t.price.toFixed(2)}` : '—'}
        </Text>
        <PctBadge v={t.change_percent} size="sm" />
      </View>
    </View>
  );
}

export function WatchlistSlide({ data, dateLabel, colors }: { data: MarketDigestContent; dateLabel: string; colors: Colors }) {
  const keyLevels = data.watchlist.key_levels ?? [];
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD }}>
      <SlideLabel label="Watchlist" right={dateLabel} colors={colors} />

      {keyLevels.length > 0 && (
        <View style={{ marginBottom: 22 }}>
          <SectionHeader
            icon="analytics-outline"
            title="Key Levels"
            subtitle="Your watched price levels, reviewed against today's price action — is it still on track?"
            colors={colors}
          />
          {keyLevels.map(lvl => <KeyLevelCard key={lvl.ticker + lvl.level_low} lvl={lvl} colors={colors} />)}
        </View>
      )}

      <View style={{ marginBottom: 22 }}>
        <SectionHeader
          icon="star-outline"
          title="My Watchlist"
          subtitle="Tickers you're personally tracking, with today's catalyst."
          colors={colors}
        />
        {data.watchlist.mine.length === 0
          ? <EmptyNote text="No watchlist configured." colors={colors} />
          : (
            <View style={cardStyle(colors)}>
              {data.watchlist.mine.map((t, i) => (
                <MyTickerRow key={t.ticker} t={t} colors={colors} last={i === data.watchlist.mine.length - 1} />
              ))}
            </View>
          )}
      </View>

      <View>
        <SectionHeader
          icon="flame-outline"
          title="Trending"
          subtitle="What the broader market is buzzing about right now, via Yahoo Finance."
          colors={colors}
        />
        {data.watchlist.trending.length === 0
          ? <EmptyNote text="Trending data unavailable." colors={colors} />
          : (
            <View style={cardStyle(colors)}>
              {data.watchlist.trending.map((t, i) => (
                <TrendingRow key={t.ticker} t={t} colors={colors} last={i === data.watchlist.trending.length - 1} />
              ))}
            </View>
          )}
      </View>
    </View>
  );
}

// ── 4. Pre-Market Movers ─────────────────────────────────────────────────────

function MoverRow({ m, colors, last }: { m: DigestMover; colors: Colors; last: boolean }) {
  const prevClose = m.price != null && m.change != null ? m.price - m.change : null;
  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.separator }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>{m.ticker}</Text>
        <PctBadge v={m.change_percent} size="sm" />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
          {m.price != null ? `$${m.price.toFixed(2)}` : '—'}
        </Text>
        {prevClose != null && (
          <Text style={{ color: colors.textTertiary, fontSize: 12 }}>prev ${prevClose.toFixed(2)}</Text>
        )}
      </View>
      {!!m.reason && <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 16 }}>{m.reason}</Text>}
    </View>
  );
}

export function MoversSlide({ data, dateLabel, colors }: { data: MarketDigestContent; dateLabel: string; colors: Colors }) {
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD }}>
      <SlideLabel label="Pre-Market Movers" right={dateLabel} colors={colors} />
      <SlideTitle colors={colors}>Biggest moves across the whole market</SlideTitle>

      <View style={[cardStyle(colors), { borderColor: RH_GREEN + '33', marginBottom: 16 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Ionicons name="trending-up" size={14} color={RH_GREEN} />
          <Text style={{ color: RH_GREEN, fontSize: 12, fontWeight: '800', letterSpacing: 0.6 }}>GAINERS</Text>
        </View>
        {data.movers.gainers.length === 0
          ? <EmptyNote text="No standout gainers." colors={colors} />
          : data.movers.gainers.map((m, i) => (
            <MoverRow key={m.ticker} m={m} colors={colors} last={i === data.movers.gainers.length - 1} />
          ))}
      </View>

      <View style={[cardStyle(colors), { borderColor: RH_RED + '33' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Ionicons name="trending-down" size={14} color={RH_RED} />
          <Text style={{ color: RH_RED, fontSize: 12, fontWeight: '800', letterSpacing: 0.6 }}>LOSERS</Text>
        </View>
        {data.movers.losers.length === 0
          ? <EmptyNote text="No standout losers." colors={colors} />
          : data.movers.losers.map((m, i) => (
            <MoverRow key={m.ticker} m={m} colors={colors} last={i === data.movers.losers.length - 1} />
          ))}
      </View>
    </View>
  );
}

// ── 5. Earnings & Events ─────────────────────────────────────────────────────

function EarningsRowCard({ e, colors, last }: {
  e: MarketDigestContent['events']['earnings'][number]; colors: Colors; last: boolean;
}) {
  const before = e.when === 'before_open';
  const tint = before ? AMBER : '#5E5CE6';
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.separator,
    }}>
      <View style={{
        width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
        backgroundColor: tint + '18',
      }}>
        <Ionicons name={before ? 'sunny-outline' : 'moon-outline'} size={16} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{e.ticker}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 }}>{e.note}</Text>
      </View>
      <Text style={{ color: tint, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4, maxWidth: 60, textAlign: 'right' }}>
        {before ? 'BEFORE OPEN' : 'AFTER CLOSE'}
      </Text>
    </View>
  );
}

function EconRow({ e, colors, last }: {
  e: MarketDigestContent['events']['economic'][number]; colors: Colors; last: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.separator,
    }}>
      <View style={{ width: 68, backgroundColor: colors.surfaceSecondary, borderRadius: 8, paddingVertical: 5, alignItems: 'center' }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>{e.time_et}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{e.label}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }}>Cons. {e.consensus} · Prior {e.prior}</Text>
      </View>
    </View>
  );
}

export function EventsSlide({ data, dateLabel, colors }: { data: MarketDigestContent; dateLabel: string; colors: Colors }) {
  const earnings = [...data.events.earnings].sort((a, b) => (a.when === b.when ? 0 : a.when === 'before_open' ? -1 : 1));
  return (
    <View style={{ paddingHorizontal: SLIDE_PAD }}>
      <SlideLabel label="Earnings & Events" right={dateLabel} colors={colors} />

      <SectionHeader icon="megaphone-outline" title="Earnings Today" subtitle="Reports that could move these names at the open or after the bell." colors={colors} />
      {earnings.length === 0
        ? <EmptyNote text="Nothing notable." colors={colors} />
        : (
          <View style={[cardStyle(colors), { marginBottom: 24 }]}>
            {earnings.map((e, i) => <EarningsRowCard key={i} e={e} colors={colors} last={i === earnings.length - 1} />)}
          </View>
        )}

      <SectionHeader icon="calendar-outline" title="Economic Calendar" subtitle="Scheduled data that can swing the whole tape, ET-anchored." colors={colors} />
      {data.events.economic.length === 0
        ? <EmptyNote text="Nothing scheduled." colors={colors} />
        : (
          <View style={cardStyle(colors)}>
            {data.events.economic.map((e, i) => <EconRow key={i} e={e} colors={colors} last={i === data.events.economic.length - 1} />)}
          </View>
        )}
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
    <View style={[cardStyle(colors), { marginBottom: 12 }]}>
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
          backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 14, marginTop: 6,
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
