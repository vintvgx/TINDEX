import { useEffect, useRef, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
  FlatList, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useOptionsQuery } from '@/hooks/queries/ticker/useOptionsQuery';
import { useImmediateTradeByTicker, StreamUnavailableError } from '@/hooks/mutations/strategy/useImmediateTradeByTicker';
import { OptionsContractDetailModal } from '@/common/components/ticker/OptionsContractDetailModal';
import { BlindEntryModal } from '@/common/components/strategy/BlindEntryModal';
import type { ImmediateTradeByTickerRequest } from '@/common/types/strategy';
import { blendHex } from '@/lib/colorBlend';
import type { OptionsContract, OptionsOpportunity } from '@/common/types/blogPosts/ticker';
import {
  IMMEDIATE_PROFILES, DEFAULT_PROFILE_INDEX, defaultQtyFor,
  getCheapContractAutoGraceMinutes, ProfileDropdown, ManualSLPicker,
} from '@/common/components/strategy/ImmediateProfilePicker';
import { StopTypeSelector, type StopType } from '@/common/components/strategy/StopTypeSelector';

/**
 * Chain browser + order-entry UI: expiration-range/date chips, a calls/puts
 * strike chain (auto-centered on the current price), and the exit-profile /
 * quantity / submit footer. Extracted out of ImmediateTradePanel so the same
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

const COL = { strike: 70, bid: 56, ask: 56, last: 56, oi: 64 };
const ROW_H = 44;
const SEP_H = 38;

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

const asOpportunity = (c: OptionsContract): OptionsOpportunity => ({
  ask: c.ask, bid: c.bid, contractSymbol: c.symbol, delta: c.delta, dte: 0,
  expirationDate: c.expiration, extrinsicValue: 0, gamma: c.gamma,
  impliedVolatility: c.implied_volatility ?? 0, intrinsicValue: 0,
  lastPrice: c.last_price ?? null, mark: (c.bid + c.ask) / 2, moneyness: 0,
  openInterest: c.open_interest, optionType: c.option_type, reasons: '',
  signal: 'CONSIDER', spreadPct: c.ask > 0 ? ((c.ask - c.bid) / c.ask) * 100 : 0,
  strike: c.strike, theta: c.theta, total_score: 0, vega: c.vega, volume: c.volume,
});

// ── Main component ────────────────────────────────────────────────────────────

export function OptionsChainPicker({ ticker, colors, visible, paperMode, onChangePaperMode, onSubmitted }: Props) {
  const toast = useToast();
  const [side, setSide]                 = useState<OptionSide>('CALL');
  const [profileIndex, setProfileIndex] = useState(DEFAULT_PROFILE_INDEX);
  const [selected, setSelected]         = useState<OptionsContract | null>(null);
  const [qty, setQty]                   = useState(defaultQtyFor(IMMEDIATE_PROFILES[DEFAULT_PROFILE_INDEX], 0));
  const [stopType, setStopType]         = useState<StopType>('HARD');
  const [volumeExit, setVolumeExit]     = useState(false);
  const [manualSlPct, setManualSlPct]   = useState(30);
  const [autoGraceMinutes, setAutoGraceMinutes] = useState<5 | 10 | null>(null);
  // SL/TP enable — on by default for every profile; turning either off lets
  // a runner run its course (or hold into close) instead of auto-exiting.
  const [slEnabled, setSlEnabled] = useState(true);
  const [tpEnabled, setTpEnabled] = useState(true);

  const profile      = IMMEDIATE_PROFILES[profileIndex];
  const isManual     = profile.isManual === true;
  const isNoStopLoss = profile.isNoStopLoss === true;
  // No stop loss in effect — either from a (legacy) NO_STOP_LOSS profile or
  // the user unchecking Stop Loss directly.
  const noSL = isNoStopLoss || !slEnabled;

  const handleProfileSelect = (idx: number) => {
    setProfileIndex(idx);
    setQty(defaultQtyFor(IMMEDIATE_PROFILES[idx], selected?.ask ?? 0));
  };

  // Auto-suggest the grace stop-type when a cheap contract is tapped — mirrors
  // the server-side unconditional price rule (see getCheapContractAutoGraceMinutes),
  // not gated on OTM-ness. Sizing/profile is untouched; only stop type follows.
  useEffect(() => {
    if (!selected) { setAutoGraceMinutes(null); return; }
    const minutes = getCheapContractAutoGraceMinutes(selected.ask);
    setAutoGraceMinutes(minutes);
    setStopType(minutes ?? 'HARD');
  // Only re-run when the selected contract changes, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.symbol]);

  // A contract selected for one ticker has no meaning once the ticker changes.
  useEffect(() => {
    setSelected(null);
  }, [ticker]);

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const [expirationRange, setExpirationRange] = useState<ExpirationRange>('2W');
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

  const { mutate: submit, isPending } = useImmediateTradeByTicker();

  // Blind Entry — set when the backend couldn't verify a live stream tick
  // within 8s (status: 'stream_unavailable'). Holds the exact request body
  // that was in flight so "Enter Anyway" can resubmit it unchanged, just
  // with bypass_stream_check added.
  const [blindEntry, setBlindEntry] = useState<{
    body: ImmediateTradeByTickerRequest;
    lastPrice: number;
  } | null>(null);

  const chain        = data?.success ? data.data : null;
  const currentPrice = chain?.current_price ?? 0;

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

  // Shared by the initial submit and the Blind Entry "Enter Anyway" retry, so
  // both go through identical success/error handling — the retry just adds
  // bypass_stream_check to an otherwise-unchanged body.
  const runSubmit = (body: ImmediateTradeByTickerRequest) => {
    submit(body, {
      onSuccess: (r) => {
        toast.success(r.message || 'Immediate trade submitted');
        setBlindEntry(null);
        setSelected(null);
        setQty(profile.qty);
        onSubmitted?.();
      },
      onError: (e) => {
        if (e instanceof StreamUnavailableError) {
          setBlindEntry({ body, lastPrice: e.payload.last_price ?? 0 });
          return;
        }
        toast.error(e.message || 'Trade failed');
        setBlindEntry(null);
        setSelected(null);
        onSubmitted?.();
      },
    });
  };

  const doSubmit = () => {
    if (!ticker || !selected) return;
    runSubmit({
      ticker,
      direction:       selected.option_type,
      contract_symbol: selected.symbol,
      qty,
      profile:         profile.key,
      paper_mode:      paperMode,
      volume_exit:     isManual ? false : volumeExit,
      sl_grace_minutes: (noSL || stopType === 'HARD') ? null : stopType,
      sl_enabled: slEnabled,
      tp_enabled: tpEnabled,
      ...(slEnabled && isManual ? { max_loss_pct: manualSlPct / 100 } : {}),
    });
  };

  const confirmSubmit = () => {
    if (!ticker || !selected) return;
    const profileNote = noSL
      ? `\n\n⚠️ No Stop Loss${!tpEnabled ? ' or Take Profit' : ''} — this contract will NOT auto-close on that leg${isNoStopLoss ? ', including end of day. It expires today (0DTE) if you don\'t sell it' : ''}.`
      : isManual ? `\nStop Loss: −${manualSlPct}%` : '';
    if (!paperMode) {
      Alert.alert(
        'Submit LIVE Order',
        `This will buy ${qty} × ${selected.symbol} with REAL money immediately.\n\nProfile: ${profile.emoji} ${profile.name}${profileNote}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit', style: 'destructive', onPress: doSubmit },
        ],
      );
    } else if (noSL) {
      Alert.alert(
        '⚠️ No Stop Loss',
        `This will buy ${qty} × ${selected.symbol}.${profileNote}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit', onPress: doSubmit },
        ],
      );
    } else {
      doSubmit();
    }
  };

  const renderRow = ({ item }: { item: ChainRow }) => {
    if (item.type === 'separator') {
      return (
        <View style={[styles.separatorRow, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
          <View style={[styles.separatorPill, { backgroundColor: colors.accent + '22' }]}>
            <Text style={[styles.separatorPillText, { color: colors.accent }]}>ITM</Text>
          </View>
          <Text style={[styles.separatorPrice, { color: colors.text }]}>${item.price.toFixed(2)}</Text>
          <View style={[styles.separatorPill, { backgroundColor: colors.accent + '22' }]}>
            <Text style={[styles.separatorPillText, { color: colors.accent }]}>ITM</Text>
          </View>
        </View>
      );
    }
    const c = item.data;
    return (
      <TouchableOpacity
        onPress={() => setSelected(c)}
        activeOpacity={0.7}
        style={[styles.contractRow, {
          backgroundColor: item.isITM ? colors.surface : 'transparent',
          borderBottomColor: colors.separator,
        }]}
      >
        <Text numberOfLines={1} style={[styles.cell, { width: COL.strike, color: colors.text, fontWeight: '600' }]}>
          ${c.strike.toFixed(1)}
        </Text>
        <Text numberOfLines={1} style={[styles.cell, { width: COL.bid, color: colors.success }]}>
          {c.bid > 0 ? c.bid.toFixed(2) : '-'}
        </Text>
        <Text numberOfLines={1} style={[styles.cell, { width: COL.ask, color: colors.error }]}>
          {c.ask > 0 ? c.ask.toFixed(2) : '-'}
        </Text>
        <Text numberOfLines={1} style={[styles.cell, { width: COL.last, color: colors.textSecondary }]}>
          {c.last_price != null ? c.last_price.toFixed(2) : '-'}
        </Text>
        <Text numberOfLines={1} style={[styles.cell, { width: COL.oi, color: colors.textTertiary }]}>
          {formatVol(c.open_interest)}
        </Text>
        <Text numberOfLines={1} style={[styles.cell, { flex: 1, color: colors.textTertiary }]}>
          {formatVol(c.volume)}
        </Text>
      </TouchableOpacity>
    );
  };

  const showError = !!error || (data && !data.success);

  // Matches the app-wide paper/live convention used on Dashboard/Live
  // Positions/Trade Log — amber for paper, green for live. Applied as a
  // persistent, subtle background wash rather than just the small toggle
  // pill, so which mode is selected stays visible in peripheral vision
  // through the whole chain-browsing screen and the confirm modal — the
  // toggle alone was easy to glance past and buy into the wrong account.
  const modeTint = paperMode ? '#FF9F0A' : '#30D158';

  const detailFooter = selected ? (
    <View style={{ gap: 12 }}>
      {/* Profile dropdown — also where paper/live can be switched, right
          before submitting, without backing out to the ticker picker.
          Background tinted more strongly than the rest of the screen so
          this card reads as "you're about to trade in X mode" at the exact
          point the trade is confirmed. */}
      <View style={[styles.exitProfileCard, { backgroundColor: blendHex(colors.card, modeTint, 0.16), borderColor: modeTint + '40' }]}>
        <View style={styles.exitAccountRow}>
          <Text style={[styles.footerLabel, { color: colors.tabBarInactive, marginBottom: 0 }]}>ACCOUNT</Text>
          <View style={[styles.exitAccountToggle, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {([['Paper', true], ['Live', false]] as const).map(([label, isPaper]) => {
              const active = paperMode === isPaper;
              const tint = isPaper ? '#FF9F0A' : '#30D158';
              return (
                <TouchableOpacity
                  key={label}
                  onPress={() => onChangePaperMode(isPaper)}
                  activeOpacity={0.8}
                  style={[styles.exitAccountBtn, active && { backgroundColor: tint + '22', borderRadius: 7 }]}
                >
                  <Text style={[styles.exitAccountText, { color: active ? tint : colors.tabBarInactive, fontWeight: active ? '700' : '500' }]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Text style={[styles.footerLabel, { color: colors.tabBarInactive, marginTop: 12 }]}>EXIT PROFILE</Text>
        <ProfileDropdown
          selectedIndex={profileIndex}
          onSelect={handleProfileSelect}
          colors={colors}
        />
      </View>

      {/* Manual SL picker — only when MANUAL selected and SL is enabled */}
      {isManual && slEnabled && (
        <ManualSLPicker
          slPct={manualSlPct}
          onChangePct={setManualSlPct}
          askPrice={(liveSelected ?? selected).ask}
          colors={colors}
        />
      )}

      {/* Contracts */}
      <View style={styles.footerQtyRow}>
        <View>
          <Text style={[styles.footerLabel, { color: colors.tabBarInactive, marginBottom: 2 }]}>CONTRACTS</Text>
          <Text style={[styles.qtyHint, { color: colors.tabBarInactive }]}>
            {noSL ? 'No stop loss — size carefully' : `Default for ${profile.name}: ${profile.qty}`}
          </Text>
        </View>
        <View style={styles.qtyGroup}>
          <TouchableOpacity
            onPress={() => setQty(q => Math.max(1, q - 1))}
            style={[styles.qtyBtn, { borderColor: colors.border }]}
          >
            <Ionicons name="remove" size={18} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.qtyValue, { color: colors.text }]}>{qty}</Text>
          <TouchableOpacity
            onPress={() => setQty(q => q + 1)}
            style={[styles.qtyBtn, { borderColor: colors.border }]}
          >
            <Ionicons name="add" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Exit Controls — SL/TP enable toggles apply on every profile;
          turning either off lets a runner run its course (or hold into
          close) instead of auto-exiting on that leg. */}
      <View>
        <Text style={[styles.footerLabel, { color: colors.tabBarInactive }]}>EXIT CONTROLS</Text>
        <View style={[styles.exitToggles, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.exitToggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.exitToggleLabel, { color: colors.text }]}>Stop Loss</Text>
              <Text style={[styles.exitToggleSub, { color: colors.tabBarInactive }]}>Auto-close on hard stop</Text>
            </View>
            <TouchableOpacity
              onPress={() => setSlEnabled(v => !v)}
              style={[styles.togglePill, { backgroundColor: slEnabled ? colors.accent + '33' : colors.border + '55', borderColor: slEnabled ? colors.accent : colors.border }]}
            >
              <View style={[styles.toggleThumb, { backgroundColor: slEnabled ? colors.accent : colors.tabBarInactive, transform: [{ translateX: slEnabled ? 14 : 0 }] }]} />
            </TouchableOpacity>
          </View>
          <View style={[styles.exitToggleRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.exitToggleLabel, { color: colors.text }]}>Take Profit</Text>
              <Text style={[styles.exitToggleSub, { color: colors.tabBarInactive }]}>Auto-close on TP1/TP2</Text>
            </View>
            <TouchableOpacity
              onPress={() => setTpEnabled(v => !v)}
              style={[styles.togglePill, { backgroundColor: tpEnabled ? colors.accent + '33' : colors.border + '55', borderColor: tpEnabled ? colors.accent : colors.border }]}
            >
              <View style={[styles.toggleThumb, { backgroundColor: tpEnabled ? colors.accent : colors.tabBarInactive, transform: [{ translateX: tpEnabled ? 14 : 0 }] }]} />
            </TouchableOpacity>
          </View>
          {!isManual && (
            <View style={[styles.exitToggleRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.exitToggleLabel, { color: colors.text }]}>Volume Exit</Text>
                <Text style={[styles.exitToggleSub, { color: colors.tabBarInactive }]}>Close half on low volume</Text>
              </View>
              <TouchableOpacity
                onPress={() => setVolumeExit(v => !v)}
                style={[styles.togglePill, { backgroundColor: volumeExit ? colors.accent + '33' : colors.border + '55', borderColor: volumeExit ? colors.accent : colors.border }]}
              >
                <View style={[styles.toggleThumb, { backgroundColor: volumeExit ? colors.accent : colors.tabBarInactive, transform: [{ translateX: volumeExit ? 14 : 0 }] }]} />
              </TouchableOpacity>
            </View>
          )}
        </View>
        {slEnabled && (
          <View style={{ marginTop: 10 }}>
            <StopTypeSelector value={stopType} onChange={setStopType} colors={colors} autoSuggested={autoGraceMinutes} />
          </View>
        )}
      </View>

      {/* Submit */}
      <TouchableOpacity
        onPress={confirmSubmit}
        disabled={isPending}
        activeOpacity={0.85}
        style={[styles.submitBtn, {
          backgroundColor: isPending ? colors.border : modeTint,
        }]}
      >
        {isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="flash" size={18} color="#fff" />
            <Text style={[styles.submitText, { color: '#fff' }]}>
              {paperMode ? '' : 'LIVE '}Buy {qty} {selected.option_type} · {profile.emoji} {profile.name}
              {isManual && slEnabled ? ` · SL −${manualSlPct}%` : ''}
              {noSL && !tpEnabled ? ' · no auto exit' : noSL ? ' · no SL' : !tpEnabled ? ' · no TP' : ''}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: blendHex(colors.background, modeTint, 0.08) }}>
      {/* Controls */}
      <View style={styles.controls}>
        {/* Calls / Puts + price */}
        <View style={styles.controlRow}>
          <View style={[styles.toggle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {(['CALL', 'PUT'] as const).map(s => {
              const active = side === s;
              const tint = s === 'CALL' ? colors.success : colors.error;
              return (
                <TouchableOpacity
                  key={s}
                  onPress={() => setSide(s)}
                  activeOpacity={0.8}
                  style={[styles.toggleBtn, { backgroundColor: active ? colors.surfaceTertiary : 'transparent' }]}
                >
                  <Text style={[styles.toggleText, { color: active ? tint : colors.textSecondary }]}>
                    {s === 'CALL' ? 'Calls' : 'Puts'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {currentPrice > 0 && (
            <Text style={[styles.priceText, { color: colors.textSecondary }]}>
              {ticker} · ${currentPrice.toFixed(2)}
            </Text>
          )}
        </View>

        {/* Expiration date — pick a specific date instead of only trusting
            the auto "nearest match" (the auto-pick is what silently showed
            the wrong day's chain — see pickTargetExpiration above). The range
            toggle controls how far out to look before picking a date — a
            calendar would show mostly disabled days since real expirations
            are sparse, so this stays a chip list, just fed from a wider or
            narrower window. */}
        <View>
          <View style={styles.expirationHeaderRow}>
            <Text style={[styles.controlLabel, { color: colors.tabBarInactive, marginTop: 4 }]}>EXPIRATION</Text>
            <View style={[styles.rangeToggle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {(Object.keys(RANGE_LABELS) as ExpirationRange[]).map(r => {
                const active = expirationRange === r;
                return (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setExpirationRange(r)}
                    activeOpacity={0.8}
                    style={[styles.rangeBtn, { backgroundColor: active ? colors.surfaceTertiary : 'transparent' }]}
                  >
                    <Text style={[styles.rangeBtnText, { color: active ? colors.accent : colors.textSecondary }]}>
                      {RANGE_LABELS[r]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          {availableExpirations.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {availableExpirations.map(exp => {
                  const active = exp === targetExpiration;
                  return (
                    <TouchableOpacity
                      key={exp}
                      onPress={() => setManualExpiration(exp)}
                      activeOpacity={0.8}
                      style={[
                        styles.expiryChip,
                        {
                          backgroundColor: active ? colors.accent + '22' : colors.card,
                          borderColor: active ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.expiryChipText, { color: active ? colors.accent : colors.text }]}>
                        {fmtExpiryLabel(exp, today)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          ) : (
            <Text style={[styles.emptySub, { color: colors.tabBarInactive, textAlign: 'left', paddingTop: 0 }]}>
              No {ticker || 'this ticker'} expirations found in this range.
            </Text>
          )}
        </View>
      </View>

      {/* Column headers */}
      {!contractsLoading && !showError && rows.length > 0 && (
        <View style={[styles.colHeaderRow, { backgroundColor: colors.surface, borderBottomColor: colors.separator }]}>
          <Text style={[styles.colHead, { width: COL.strike, color: colors.textTertiary }]}>Strike</Text>
          <Text style={[styles.colHead, { width: COL.bid,    color: colors.success }]}>Bid</Text>
          <Text style={[styles.colHead, { width: COL.ask,    color: colors.error }]}>Ask</Text>
          <Text style={[styles.colHead, { width: COL.last,   color: colors.textTertiary }]}>Last</Text>
          <Text style={[styles.colHead, { width: COL.oi,     color: colors.textTertiary }]}>OI</Text>
          <Text style={[styles.colHead, { flex: 1,           color: colors.textTertiary }]}>Volume</Text>
        </View>
      )}

      {/* Chain */}
      {contractsLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : showError ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
          <Text style={[styles.emptyText, { color: colors.text }]}>Could not load the options chain</Text>
          <Text style={[styles.emptySub, { color: colors.tabBarInactive }]}>
            Options data is only available during market hours.
          </Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="layers-outline" size={32} color={colors.tabBarInactive} />
          <Text style={[styles.emptyText, { color: colors.text }]}>No contracts found</Text>
          <Text style={[styles.emptySub, { color: colors.tabBarInactive }]}>
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

      {/* Detail modal with footer */}
      {selected && (
        <OptionsContractDetailModal
          visible
          onClose={() => setSelected(null)}
          contract={asOpportunity(liveSelected ?? selected)}
          ticker={ticker}
          currentPrice={currentPrice}
          footer={detailFooter}
          tintColor={modeTint}
          qty={qty}
        />
      )}

      {/* Blind Entry — backend couldn't verify a live stream tick within 8s.
          Lets the user enter off the last polled quote or skip, instead of
          the trade just being blocked outright. */}
      {blindEntry && (
        <BlindEntryModal
          visible
          colors={colors}
          contractSymbol={blindEntry.body.contract_symbol}
          lastPrice={blindEntry.lastPrice}
          qty={blindEntry.body.qty ?? qty}
          direction={blindEntry.body.direction}
          paperMode={blindEntry.body.paper_mode}
          isSubmitting={isPending}
          onConfirm={() => runSubmit({ ...blindEntry.body, bypass_stream_check: true })}
          onSkip={() => {
            setBlindEntry(null);
            setSelected(null);
            onSubmitted?.();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controls:     { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
  controlRow:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  controlLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },

  toggle:     { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: 100, padding: 3, borderWidth: 1 },
  toggleBtn:  { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 100 },
  toggleText: { fontSize: 13, fontWeight: '600' },
  priceText:  { fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },

  expiryChip:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100, borderWidth: 1 },
  expiryChipText: { fontSize: 12, fontWeight: '700' },

  expirationHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rangeToggle:    { flexDirection: 'row', borderRadius: 100, padding: 2, borderWidth: 1 },
  rangeBtn:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  rangeBtnText:   { fontSize: 11, fontWeight: '700' },

  colHeaderRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  colHead:      { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  contractRow:  { flexDirection: 'row', height: ROW_H, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  cell:         { fontSize: 13, textAlign: 'left' },

  separatorRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: SEP_H, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  separatorPill:     { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 100 },
  separatorPillText: { fontSize: 11, fontWeight: '700' },
  separatorPrice:    { fontSize: 13, fontWeight: '700' },

  centered:   { alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 6 },
  emptyText:  { fontSize: 15, fontWeight: '600', marginTop: 6 },
  emptySub:   { fontSize: 13, textAlign: 'center' },

  // ── Footer ──
  exitProfileCard:  { borderRadius: 12, borderWidth: 1, padding: 12 },
  exitAccountRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exitAccountToggle:{ flexDirection: 'row', borderRadius: 9, borderWidth: 1, padding: 2 },
  exitAccountBtn:   { paddingHorizontal: 14, paddingVertical: 5 },
  exitAccountText:  { fontSize: 12 },
  footerLabel:    { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  footerQtyRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qtyHint:        { fontSize: 10 },
  qtyGroup:       { flexDirection: 'row', alignItems: 'center', gap: 16 },
  qtyBtn:         { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyValue:       { fontSize: 18, fontWeight: '700', minWidth: 28, textAlign: 'center' },

  exitToggles:     { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  exitToggleRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  exitToggleLabel: { fontSize: 14, fontWeight: '500', marginBottom: 2 },
  exitToggleSub:   { fontSize: 11 },
  togglePill:      { width: 38, height: 24, borderRadius: 12, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 3 },
  toggleThumb:     { width: 18, height: 18, borderRadius: 9 },

  submitBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 12 },
  submitText: { fontSize: 15, fontWeight: '700' },
});
