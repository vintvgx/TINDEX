import { useEffect, useRef, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  FlatList, ScrollView, Animated, type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOptionsQuery } from '@/hooks/queries/ticker/useOptionsQuery';
import { blendHex } from '@/lib/colorBlend';
import type { OptionsContract } from '@/common/types/blogPosts/ticker';
import { accountModeColor } from '@/common/components/trade/AccountModeBanner';
import { TradeContractSheet } from '@/common/components/ticker/TradeContractSheet';
import { useCloseOnTradeEntered } from '@/common/services/tradeEntryEvents';

/**
 * Chain browser: expiration-range/date chips and a calls/puts strike chain
 * (auto-centered on the current price). Tapping a strike opens the v2 trade
 * sheet (TradeContractSheet → Confirm → Success → Home) — the same entry flow
 * as everywhere else; this picker no longer has an order form of its own
 * (entry-flow spec, 2026-10-13). Extracted out of ImmediateTradePanel so the same
 * "browse a chain, tap a strike, trade it" flow can be reused from a fixed
 * ticker (e.g. a ticker detail screen's Contracts tab) without also pulling
 * in the ticker picker, which only makes sense when the ticker isn't already
 * known.
 */
interface Props {
  ticker: string;
  colors: any;
  visible: boolean;
  /** Paper/live selection — lifted up to the parent (ImmediateTradePanel) so
   *  the toggle can live above the ticker picker, and so the same value
   *  drives a persistent background tint across both this screen and the
   *  confirm modal. See ImmediateTradePanel for why this moved out of here. */
  paperMode: boolean;
  /** Lets the Exit Profile section (in the confirm modal's footer) also
   *  switch paper/live, right before submitting, without backing out to the
   *  ticker picker. Calls back up to whichever parent owns paperMode so both
   *  toggles and the background tint everywhere stay in sync. */
  onChangePaperMode: (paper: boolean) => void;
  /** Called after a trade submission resolves (success or failure) — a toast has already been shown. */
  onSubmitted?: () => void;
  /** Open straight onto this contract (side + expiration preselected, its
   *  detail/Review sheet opened once the chain loads) — e.g. the Pick
   *  Detail Sheet's "Review $140P". Applied once per mount. */
  initialContract?: { symbol: string; side: OptionSide; expiration: string };
}

// ── Expiration range ──────────────────────────────────────────────────────────
// How far out to look for expirations. Kept as a few fixed buckets rather than
// a calendar picker: real option expirations are sparse, irregular dates
// (weeklies, then monthlies, then LEAPS), so a calendar would render mostly
// disabled days. "2W" covers same-week/near-term ORB-style trades; "3M"
// reaches ordinary monthly swing trades (e.g. an Aug expiration held for
// weeks); "LEAPS" reaches far-dated contracts (e.g. Jan next year) without
// mixing them into the same fetch as the liquid near-term chain — see the
// two-query split below for why that mixing mattered.
type ExpirationRange = '2W' | '3M' | 'LEAPS';
const RANGE_LABELS: Record<ExpirationRange, string> = { '2W': '2W', '3M': '3M', LEAPS: 'LEAPS' };
const RANGE_WINDOW_DAYS: Record<ExpirationRange, { gte: number; lte: number }> = {
  '2W':    { gte: 0,   lte: 14 },
  '3M':    { gte: 0,   lte: 100 },
  LEAPS:   { gte: 100, lte: 730 },
};

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function fmtExpiryLabel(iso: string, todayIso: string): string {
  if (iso === todayIso) return 'Today (0DTE)';
  const d   = new Date(iso + 'T00:00:00Z');
  const now = new Date(todayIso + 'T00:00:00Z');
  // A far-dated (3M/LEAPS) chip needs the year — "Fri 1/2" is ambiguous
  // between this January and next without it.
  const showYear = d.getUTCFullYear() !== now.getUTCFullYear();
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const md = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  return showYear ? `${weekday} ${md}/${String(d.getUTCFullYear()).slice(2)}` : `${weekday} ${md}`;
}

/**
 * Pick the nearest expiration from whatever the chain actually returned.
 */
function pickTargetExpiration(available: string[]): string | null {
  if (!available.length) return null;
  return [...available].sort()[0];
}

// ── Chain helpers ─────────────────────────────────────────────────────────────

// Fixed heights for the iOS-style chain rows and the near-the-money
// divider. The ITM auto-centering (offsets / getItemLayout / scrollToIndex
// below) is computed from these two constants, and the row/divider styles
// use them too, so they can't drift apart.
const ROW_H = 54;
const SEP_H = 36;
// Bid/ask column width — fixed so tabular figures stay put on every poll.
const QUOTE_W = 64;

type OptionSide = 'CALL' | 'PUT';
type ChainRow =
  | { type: 'contract'; data: OptionsContract; isITM: boolean }
  | { type: 'separator'; price: number };

const formatVol = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const buildRows = (contracts: OptionsContract[], price: number, side: OptionSide): ChainRow[] => {
  if (!price || contracts.length === 0)
    return contracts.map(c => ({ type: 'contract' as const, data: c, isITM: false }));
  if (side === 'CALL') {
    const sorted = [...contracts].sort((a, b) => b.strike - a.strike);
    return [
      ...sorted.filter(c => c.strike >= price).map(c => ({ type: 'contract' as const, data: c, isITM: false })),
      { type: 'separator' as const, price },
      ...sorted.filter(c => c.strike < price).map(c => ({ type: 'contract' as const, data: c, isITM: true })),
    ];
  }
  // Puts sort descending too, same as calls, so the strike column always reads
  // high-to-low top-to-bottom regardless of which side is toggled — previously
  // this sorted ascending, which flipped reading direction when switching from
  // Calls to Puts.
  const sorted = [...contracts].sort((a, b) => b.strike - a.strike);
  return [
    ...sorted.filter(c => c.strike > price).map(c => ({ type: 'contract' as const, data: c, isITM: true })),
    { type: 'separator' as const, price },
    ...sorted.filter(c => c.strike <= price).map(c => ({ type: 'contract' as const, data: c, isITM: false })),
  ];
};


// ── Main component ────────────────────────────────────────────────────────────

export function OptionsChainPicker({ ticker, colors, visible, paperMode, onSubmitted, initialContract }: Props) {
  const [side, setSide]                 = useState<OptionSide>(initialContract?.side ?? 'CALL');
  // Tapped contract → the v2 trade sheet (TradeContractSheet): Review →
  // Confirm → Success → Home. This picker no longer has its own order form.
  const [selected, setSelected]         = useState<OptionsContract | null>(null);
  // An entry from the sheet → tell the host (e.g. ImmediateTradePanel closes).
  useCloseOnTradeEntered(visible, () => { setSelected(null); onSubmitted?.(); });
  // A contract selected for one ticker has no meaning once the ticker changes.
  useEffect(() => {
    setSelected(null);
  }, [ticker]);

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const [expirationRange, setExpirationRange] = useState<ExpirationRange>(
    initialContract && initialContract.expiration > addDays(today, RANGE_WINDOW_DAYS['2W'].lte) ? '3M' : '2W',
  );
  const rangeWindow = RANGE_WINDOW_DAYS[expirationRange];
  const rangeGte = useMemo(() => addDays(today, rangeWindow.gte), [today, rangeWindow.gte]);
  const rangeLte = useMemo(() => addDays(today, rangeWindow.lte), [today, rangeWindow.lte]);

  // Query 1: which expirations exist in the selected range. limit=1 since only
  // `expirations_fetched` is needed here — the actual contract list for
  // whichever date gets picked comes from query 2 below, scoped to just that
  // one expiration. Splitting these matters once the range widens past a
  // couple weeks: the chain endpoint picks its `limit` contracts by nearest-
  // to-current-price ACROSS THE WHOLE WINDOW combined, so a single query
  // spanning (say) 2W-LEAPS would let near-term weeklies crowd out a
  // far-dated expiration's own strikes entirely, even though that far date
  // still showed up in expirations_fetched — i.e. the date would be tappable
  // but silently show "no contracts found." Scoping query 2 to one exact date
  // avoids that regardless of how wide the browsing range is.
  const { data: rangeData, isLoading: rangeLoading } = useOptionsQuery(
    visible && ticker ? ticker : '',
    { limit: 1, expiration_date_gte: rangeGte, expiration_date_lte: rangeLte },
  );

  const availableExpirations = useMemo(() => {
    if (!rangeData?.success) return [];
    return [...rangeData.data.expirations_fetched].sort();
  }, [rangeData]);

  const [manualExpiration, setManualExpiration] = useState<string | null>(null);

  // Reset the manual pick whenever the ticker or range changes — a date
  // chosen for one ticker/range has no meaning for another.
  useEffect(() => {
    setManualExpiration(null);
  }, [ticker, expirationRange]);

  // initialContract: pin its expiration. Declared after the reset above so
  // the mount-time reset runs first and this wins.
  const initialApplied = useRef(false);
  useEffect(() => {
    if (initialContract) setManualExpiration(initialContract.expiration);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetExpiration = useMemo(() => {
    if (manualExpiration && availableExpirations.includes(manualExpiration)) {
      return manualExpiration;
    }
    return pickTargetExpiration(availableExpirations);
  }, [manualExpiration, availableExpirations]);

  // Query 2: the full, live-polled contract list for ONLY targetExpiration —
  // see the comment on query 1 for why this is scoped to one exact date
  // rather than filtered client-side out of query 1's (potentially wide)
  // window.
  const { data, isLoading, error } = useOptionsQuery(
    visible && ticker && targetExpiration ? ticker : '',
    targetExpiration
      ? { limit: 100, expiration_date_gte: targetExpiration, expiration_date_lte: targetExpiration }
      : undefined,
    4000,
  );

  // Deliberately excludes isFetching/rangeFetching: those go true on every
  // background poll too (query 2 refetches every 4s for live quotes), and
  // including them here swapped the whole chain out for a full-screen
  // spinner on every single tick even though data was already on screen.
  // isLoading/rangeLoading alone still cover every real "nothing to show
  // yet" case — first load, a ticker/expiration switch that hasn't
  // resolved, or the range-switch gap where targetExpiration is briefly
  // null (query 2 disabled, so it can't be loading) — the last of those is
  // exactly what the `!targetExpiration` clause below still catches.
  const contractsLoading =
    isLoading || rangeLoading || (!!ticker && !targetExpiration);

  const chain        = data?.success ? data.data : null;
  const currentPrice = chain?.current_price ?? 0;

  // initialContract: open its detail sheet once the chain has it.
  useEffect(() => {
    if (!initialContract || initialApplied.current || !chain) return;
    const list = initialContract.side === 'CALL' ? chain.calls : chain.puts;
    const match = list.find(c => c.symbol === initialContract.symbol);
    if (match) {
      initialApplied.current = true;
      setSelected(match);
    }
  }, [chain, initialContract]);

  const sideContracts = useMemo(() => {
    if (!chain) return [];
    return side === 'CALL' ? chain.calls : chain.puts;
  }, [chain, side]);

  // `selected` is a one-time snapshot captured on tap — without this, the
  // detail modal's bid/ask/last stayed frozen at whatever they were the
  // instant the row was tapped, even while query 2 kept polling fresh
  // prices underneath every 4s (reported: a GOOGL 0DTE call's displayed
  // price never moved for 30+ seconds while the underlying price header
  // kept updating). Re-deriving the live contract by symbol on every poll,
  // and feeding THAT into the modal instead of the frozen `selected`, keeps
  // every displayed field (bid/ask/last/mark/spread) live for as long as
  // the modal stays open. Falls back to `selected` itself when the symbol
  // isn't found in the freshest poll (chain still loading, or the contract
  // rolled off the returned page).
  const liveSelected = useMemo(() => {
    if (!selected || !chain) return selected;
    const list = selected.option_type === 'CALL' ? chain.calls : chain.puts;
    return list.find(c => c.symbol === selected.symbol) ?? selected;
  }, [selected, chain]);

  const rows = useMemo(() => buildRows(sideContracts, currentPrice, side), [sideContracts, currentPrice, side]);

  // ── ITM centering ──
  // scrollToIndex can silently fail (or land at the wrong offset) if it fires
  // before the FlatList has completed its first native layout pass — a
  // setTimeout(0) isn't reliably "after layout," it's just "next JS
  // macrotask." Nudging the delay out a bit plus a real onScrollToIndexFailed
  // fallback (React Native's documented mechanism for exactly this race)
  // makes the initial center-on-current-price land reliably instead of
  // sometimes leaving the list scrolled to the top.
  const listRef  = useRef<FlatList<ChainRow>>(null);
  const sepIndex = useMemo(() => rows.findIndex(r => r.type === 'separator'), [rows]);
  const offsets  = useMemo(() => {
    const out: number[] = [];
    let off = 0;
    for (const r of rows) { out.push(off); off += r.type === 'separator' ? SEP_H : ROW_H; }
    return out;
  }, [rows]);
  const getItemLayout = (_: unknown, index: number) => ({
    length: rows[index]?.type === 'separator' ? SEP_H : ROW_H,
    offset: offsets[index] ?? 0,
    index,
  });
  useEffect(() => {
    if (sepIndex < 0) return;
    const id = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: sepIndex, viewPosition: 0.5, animated: false });
      } catch {
        listRef.current?.scrollToOffset({ offset: offsets[sepIndex] ?? 0, animated: false });
      }
    }, 60);
    return () => clearTimeout(id);
  }, [sepIndex, rows.length, offsets]);

  const renderRow = ({ item }: { item: ChainRow }) => {
    if (item.type === 'separator') {
      return (
        <View style={styles.separatorRow}>
          <View style={[styles.separatorLine, { backgroundColor: colors.separator }]} />
          <Text style={[styles.separatorText, { color: colors.textSecondary }]}>
            Near the money — ${item.price.toFixed(2)}
          </Text>
          <View style={[styles.separatorLine, { backgroundColor: colors.separator }]} />
        </View>
      );
    }
    const c = item.data;
    const detail = [
      c.last_price != null ? `Last ${c.last_price.toFixed(2)}` : null,
      `OI ${formatVol(c.open_interest)}`,
      `Vol ${formatVol(c.volume)}`,
    ].filter(Boolean).join('  ·  ');
    return (
      <TouchableOpacity
        onPress={() => setSelected(c)}
        activeOpacity={0.6}
        style={[styles.contractRow, { backgroundColor: item.isITM ? colors.card : 'transparent' }]}
      >
        <View style={[styles.contractInner, { borderBottomColor: colors.separator }]}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[styles.strikeText, { color: colors.text }]}>
              ${c.strike.toFixed(c.strike % 1 === 0 ? 0 : 1)}
            </Text>
            <Text numberOfLines={1} style={[styles.detailText, { color: colors.textTertiary }]}>{detail}</Text>
          </View>
          <Text numberOfLines={1} style={[styles.quoteText, { color: colors.text }]}>
            {c.bid > 0 ? c.bid.toFixed(2) : '–'}
          </Text>
          <Text numberOfLines={1} style={[styles.quoteText, { color: colors.text }]}>
            {c.ask > 0 ? c.ask.toFixed(2) : '–'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const showError = !!error || (data && !data.success);

  // Amber for paper, red for live — the same treatment as every other trade
  // entry sheet (AccountModeBanner), so a live-money order reads as a
  // warning rather than a go signal. Applied as a
  // persistent, subtle background wash rather than just the small toggle
  // pill, so which mode is selected stays visible in peripheral vision
  // through the whole chain-browsing screen and the confirm modal — the
  // toggle alone was easy to glance past and buy into the wrong account.
  const modeTint = accountModeColor(paperMode, colors);


  return (
    <View style={{ flex: 1, backgroundColor: blendHex(colors.background, modeTint, 0.08) }}>
      {/* Controls — one inset grouped card */}
      <View style={[styles.controlsCard, { backgroundColor: colors.card }]}>
        {/* Calls / Puts + price */}
        <View style={styles.controlRow}>
          <View style={{ width: 170 }}>
            <SegmentedControl
              colors={colors}
              options={[{ key: 'CALL', label: 'Calls', tint: colors.success }, { key: 'PUT', label: 'Puts', tint: colors.error }]}
              value={side}
              onChange={k => setSide(k as OptionSide)}
            />
          </View>
          {currentPrice > 0 && (
            <Text style={[styles.priceText, { color: colors.textSecondary }]}>
              {ticker}  <Text style={{ color: colors.text, fontWeight: '600' }}>${currentPrice.toFixed(2)}</Text>
            </Text>
          )}
        </View>

        {/* Expiration date — pick a specific date instead of only trusting
            the auto "nearest match" (the auto-pick is what silently showed
            the wrong day's chain — see pickTargetExpiration above). The range
            control sets how far out to look; real expirations are sparse, so
            this stays a chip list rather than a calendar. */}
        <View style={{ gap: 10 }}>
          <View style={styles.expirationHeaderRow}>
            <Text style={[styles.sectionHeader, { color: colors.textTertiary, marginBottom: 0, marginLeft: 0 }]}>EXPIRATION</Text>
            <View style={{ width: 168 }}>
              <SegmentedControl
                colors={colors}
                compact
                options={(Object.keys(RANGE_LABELS) as ExpirationRange[]).map(r => ({ key: r, label: RANGE_LABELS[r] }))}
                value={expirationRange}
                onChange={k => setExpirationRange(k as ExpirationRange)}
              />
            </View>
          </View>
          {availableExpirations.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {availableExpirations.map(exp => {
                const active = exp === targetExpiration;
                return (
                  <TouchableOpacity
                    key={exp}
                    onPress={() => setManualExpiration(exp)}
                    activeOpacity={0.6}
                    hitSlop={{ top: 4, bottom: 4 }}
                    style={[styles.expiryChip, { backgroundColor: active ? colors.accent : colors.surfaceSecondary }]}
                  >
                    <Text style={[styles.expiryChipText, { color: active ? colors.accentForeground : colors.text }]}>
                      {fmtExpiryLabel(exp, today)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={[styles.emptySub, { color: colors.textTertiary, textAlign: 'left' }]}>
              No {ticker || 'this ticker'} expirations found in this range.
            </Text>
          )}
        </View>
      </View>

      {/* Column headers */}
      {!contractsLoading && !showError && rows.length > 0 && (
        <View style={[styles.colHeaderRow, { borderBottomColor: colors.separator }]}>
          <Text style={[styles.colHead, { flex: 1, color: colors.textTertiary }]}>STRIKE</Text>
          <Text style={[styles.colHead, styles.colHeadQuote, { color: colors.textTertiary }]}>BID</Text>
          <Text style={[styles.colHead, styles.colHeadQuote, { color: colors.textTertiary }]}>ASK</Text>
        </View>
      )}

      {/* Chain */}
      {contractsLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : showError ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
          <Text style={[styles.emptyText, { color: colors.text }]}>Could not load the options chain</Text>
          <Text style={[styles.emptySub, { color: colors.textTertiary }]}>
            Options data is only available during market hours.
          </Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="layers-outline" size={32} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.text }]}>No contracts found</Text>
          <Text style={[styles.emptySub, { color: colors.textTertiary }]}>
            No {side === 'CALL' ? 'calls' : 'puts'} found for {ticker || 'this ticker'}
            {targetExpiration ? ` expiring ${targetExpiration}` : ' in the nearest expirations'}.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          renderItem={renderRow}
          keyExtractor={(item, i) => item.type === 'separator' ? `sep-${i}` : item.data.symbol}
          getItemLayout={getItemLayout}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({ offset: offsets[info.index] ?? 0, animated: false });
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false });
            }, 60);
          }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          initialNumToRender={40}
          maxToRenderPerBatch={20}
          windowSize={21}
        />
      )}

      {/* Tapped contract → the same v2 trade sheet every entry path uses
          (entry-flow spec, 2026-10-13). Fed the live-polled contract so its
          bid/ask/last keep moving while it's open. Its success hands off to
          TradeEntryNavigator (Home + highlight); hosts close themselves. */}
      <TradeContractSheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        colors={colors}
        ticker={ticker}
        contract={liveSelected ?? selected}
        currentPrice={currentPrice}
        initialPaperMode={paperMode}
      />
    </View>
  );
}

// ── Visual building blocks ───────────────────────────────────────────────────

type SegmentOption = { key: string; label: string; tint?: string };

/**
 * UISegmentedControl look: one rounded track, a raised highlight that slides
 * to the selected segment, no per-segment borders. Purely presentational —
 * it reports taps through `onChange` exactly like the buttons it replaces.
 */
function SegmentedControl({ options, value, onChange, colors, compact }: {
  options: SegmentOption[];
  value: string;
  onChange: (key: string) => void;
  colors: any;
  compact?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex(o => o.key === value));
  const anim = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: index, duration: 180, useNativeDriver: true }).start();
  }, [index, anim]);
  const segW = width > 0 ? (width - 4) / options.length : 0;
  const height = compact ? 30 : 34;
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.segTrack, { height, backgroundColor: colors.surfaceSecondary }]}
    >
      {segW > 0 && (
        <Animated.View
          style={[
            styles.segThumb,
            {
              width: segW, height: height - 4, backgroundColor: colors.card,
              transform: [{ translateX: Animated.multiply(anim, segW) }],
            },
          ]}
        />
      )}
      {options.map(o => {
        const active = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onChange(o.key)}
            activeOpacity={0.6}
            style={styles.segBtn}
          >
            <Text style={[styles.segText, { fontSize: compact ? 12 : 13, color: active ? (o.tint ?? colors.text) : colors.textSecondary, fontWeight: active ? '600' : '500' }]}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Settings-style row with a native iOS Switch. */

const styles = StyleSheet.create({
  controlsCard: { marginHorizontal: 16, marginTop: 12, marginBottom: 12, borderRadius: 13, padding: 12, gap: 14 },
  controlRow:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  priceText:    { fontSize: 13, flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },

  segTrack: { flexDirection: 'row', borderRadius: 9, padding: 2, position: 'relative' },
  segThumb: {
    position: 'absolute', top: 2, left: 2, borderRadius: 7,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  segBtn:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segText: { letterSpacing: -0.1 },

  expirationHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  expiryChip:     { height: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  expiryChipText: { fontSize: 13, fontWeight: '600' },

  colHeaderRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  colHead:      { fontSize: 11, fontWeight: '600', letterSpacing: 0.6 },
  colHeadQuote: { width: QUOTE_W, textAlign: 'right' },

  contractRow:   { height: ROW_H, paddingLeft: 16 },
  contractInner: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  strikeText:    { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'], letterSpacing: -0.2 },
  detailText:    { fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  quoteText:     { width: QUOTE_W, textAlign: 'right', fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },

  separatorRow:  { height: SEP_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 },
  separatorLine: { flex: 1, height: StyleSheet.hairlineWidth },
  separatorText: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },

  centered:   { alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 6 },
  emptyText:  { fontSize: 15, fontWeight: '600', marginTop: 6 },
  emptySub:   { fontSize: 13, textAlign: 'center' },

  // ── Detail form (iOS Settings-style grouped sections) ──
  sectionHeader: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, marginBottom: 7, marginLeft: 4 },
  groupCard:     { borderRadius: 13, padding: 12 },
  groupRow:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  qtyValue:      { fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  qtyHint:       { fontSize: 12, marginTop: 2 },
  stepper:       { flexDirection: 'row', alignItems: 'center', borderRadius: 8, height: 32 },
  stepperBtn:    { width: 47, height: 32, alignItems: 'center', justifyContent: 'center' },
  stepperDivider:{ width: StyleSheet.hairlineWidth, height: 18 },

  switchRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 12, minHeight: 56 },
  switchLabel: { fontSize: 15, fontWeight: '400' },
  switchSub:   { fontSize: 12, marginTop: 2 },
});
