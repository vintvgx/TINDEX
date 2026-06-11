import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, FlatList, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useOptionsQuery } from '@/hooks/queries/ticker/useOptionsQuery';
import { useImmediateTradeByTicker } from '@/hooks/mutations/strategy/useImmediateTradeByTicker';
import { OptionsContractDetailModal } from '@/common/components/ticker/OptionsContractDetailModal';
import type { ProfileKey } from '@/common/types/strategy';
import type { OptionsContract, OptionsOpportunity } from '@/common/types/blogPosts/ticker';

interface Props {
  colors: any;
  /** Followed tickers (orb_monitoring_state) the user can trade. */
  tickerOptions: string[];
  /** Whether the panel is currently shown — gates the chain query. */
  visible: boolean;
  /** Dismiss the parent modal — called after a successful trade. */
  onClose?: () => void;
}

const PROFILE_OPTIONS: { key: ProfileKey; label: string }[] = [
  { key: 'BULL_DOG',    label: '🐂 Bull Dog' },
  { key: 'THUNDER_CAT', label: '🐱 Thunder Cat' },
  { key: 'WOLF',        label: '🐺 Wolf' },
];

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
  if (!price || contracts.length === 0) {
    return contracts.map(c => ({ type: 'contract' as const, data: c, isITM: false }));
  }
  if (side === 'CALL') {
    const sorted = [...contracts].sort((a, b) => b.strike - a.strike);
    return [
      ...sorted.filter(c => c.strike >= price).map(c => ({ type: 'contract' as const, data: c, isITM: false })),
      { type: 'separator' as const, price },
      ...sorted.filter(c => c.strike < price).map(c => ({ type: 'contract' as const, data: c, isITM: true })),
    ];
  }
  const sorted = [...contracts].sort((a, b) => a.strike - b.strike);
  return [
    ...sorted.filter(c => c.strike <= price).map(c => ({ type: 'contract' as const, data: c, isITM: false })),
    { type: 'separator' as const, price },
    ...sorted.filter(c => c.strike > price).map(c => ({ type: 'contract' as const, data: c, isITM: true })),
  ];
};

const asOpportunity = (c: OptionsContract): OptionsOpportunity => ({
  ask: c.ask,
  bid: c.bid,
  contractSymbol: c.symbol,
  delta: c.delta,
  dte: 0,
  expirationDate: c.expiration,
  extrinsicValue: 0,
  gamma: c.gamma,
  impliedVolatility: c.implied_volatility ?? 0,
  intrinsicValue: 0,
  lastPrice: c.last_price ?? null,
  mark: (c.bid + c.ask) / 2,
  moneyness: 0,
  openInterest: c.open_interest,
  optionType: c.option_type,
  reasons: '',
  signal: 'CONSIDER',
  spreadPct: c.ask > 0 ? ((c.ask - c.bid) / c.ask) * 100 : 0,
  strike: c.strike,
  theta: c.theta,
  total_score: 0,
  vega: c.vega,
  volume: c.volume,
});

/**
 * Embeddable Immediate-Trade panel: pick any followed ticker + paper/live, browse
 * the live 0DTE chain (from /options/<ticker>), tap a contract for full detail, then
 * submit a market order via the ticker-based immediate-trade endpoint. Exits are
 * managed by the chosen profile on a dedicated immediate engine.
 */
export function ImmediateTradePanel({ colors, tickerOptions, visible, onClose }: Props) {
  const toast = useToast();
  const [ticker, setTicker]     = useState<string>('');
  const [tickerOpen, setTickerOpen] = useState(false);
  const [paperMode, setPaperMode] = useState(true);
  const [side, setSide]         = useState<OptionSide>('CALL');
  const [profile, setProfile]   = useState<ProfileKey>('THUNDER_CAT');
  const [selected, setSelected] = useState<OptionsContract | null>(null);
  const [qty, setQty]           = useState(1);

  // Default the ticker to the first available option once they load.
  useEffect(() => {
    if (!ticker && tickerOptions.length) setTicker(tickerOptions[0]);
  }, [tickerOptions, ticker]);

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const { data, isLoading, error } = useOptionsQuery(
    visible && ticker ? ticker : '',
    { limit: 100, expiration_date_gte: today, expiration_date_lte: today },
    4000,   // near real-time: refresh the 0DTE chain every 4s
  );

  const { mutate: submit, isPending } = useImmediateTradeByTicker();

  const chain = data?.success ? data.data : null;
  const currentPrice = chain?.current_price ?? 0;

  const sideContracts = useMemo(() => {
    if (!chain) return [];
    const list = side === 'CALL' ? chain.calls : chain.puts;
    return list.filter(c => c.expiration === today);
  }, [chain, side, today]);

  const rows = useMemo(() => buildRows(sideContracts, currentPrice, side), [sideContracts, currentPrice, side]);

  // ── ITM centering ──
  const listRef = useRef<FlatList<ChainRow>>(null);
  const sepIndex = useMemo(() => rows.findIndex(r => r.type === 'separator'), [rows]);
  const offsets = useMemo(() => {
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
      listRef.current?.scrollToIndex({ index: sepIndex, viewPosition: 0.5, animated: false });
    }, 0);
    return () => clearTimeout(id);
  }, [sepIndex, rows.length]);

  const doSubmit = () => {
    if (!ticker || !selected) return;
    submit(
      {
        ticker,
        direction:       selected.option_type,
        contract_symbol: selected.symbol,
        qty,
        profile,
        paper_mode:      paperMode,
      },
      {
        onSuccess: (r) => {
          toast.success(r.message || 'Immediate trade submitted');
          setSelected(null);
          setQty(1);
          onClose?.();   // navigate back to the strategies list on success
        },
        // On error: keep the toast + stay on the screen so the user can retry.
        onError: (e) => toast.error(e.message || 'Trade failed'),
      },
    );
  };

  const confirmSubmit = () => {
    if (!ticker || !selected) return;
    if (!paperMode) {
      Alert.alert(
        'Submit LIVE Order',
        `This will buy ${qty} × ${selected.symbol} with REAL money immediately.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit', style: 'destructive', onPress: doSubmit },
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

  const detailFooter = selected ? (
    <View style={{ gap: 12 }}>
      <View>
        <Text style={[styles.footerLabel, { color: colors.tabBarInactive }]}>EXIT PROFILE</Text>
        <View style={styles.footerProfileRow}>
          {PROFILE_OPTIONS.map(p => {
            const active = profile === p.key;
            return (
              <TouchableOpacity
                key={p.key}
                onPress={() => setProfile(p.key)}
                style={[styles.chip, { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent + '22' : colors.card }]}
              >
                <Text style={[styles.chipText, { color: active ? colors.accent : colors.text }]}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.footerQtyRow}>
        <Text style={[styles.footerLabel, { color: colors.tabBarInactive, marginBottom: 0 }]}>CONTRACTS</Text>
        <View style={styles.qtyGroup}>
          <TouchableOpacity onPress={() => setQty(q => Math.max(1, q - 1))} style={[styles.qtyBtn, { borderColor: colors.border }]}>
            <Ionicons name="remove" size={18} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.qtyValue, { color: colors.text }]}>{qty}</Text>
          <TouchableOpacity onPress={() => setQty(q => q + 1)} style={[styles.qtyBtn, { borderColor: colors.border }]}>
            <Ionicons name="add" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        onPress={confirmSubmit}
        disabled={isPending}
        activeOpacity={0.85}
        style={[styles.submitBtn, { backgroundColor: isPending ? colors.border : (paperMode ? colors.accent : colors.error) }]}
      >
        {/* Foreground contrasts the fill: accentForeground on the accent (paper)
            button, white on the red live button. */}
        {isPending ? (
          <ActivityIndicator color={paperMode ? colors.accentForeground : '#fff'} />
        ) : (
          <>
            <Ionicons name="flash" size={18} color={paperMode ? colors.accentForeground : '#fff'} />
            <Text style={[styles.submitText, { color: paperMode ? colors.accentForeground : '#fff' }]}>
              {paperMode ? '' : 'LIVE '}Immediate Trade — Buy {qty} {selected.option_type}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <View style={{ flex: 1 }}>
      {/* Controls */}
      <View style={styles.controls}>
        {/* Ticker + account */}
        <View style={styles.controlRow}>
          {/* Ticker dropdown */}
          <View style={{ flex: 1 }}>
            <Text style={[styles.controlLabel, { color: colors.tabBarInactive }]}>TICKER</Text>
            <TouchableOpacity
              onPress={() => setTickerOpen(o => !o)}
              activeOpacity={0.7}
              style={[styles.tickerSelect, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.tickerSelectText, { color: colors.text }]}>{ticker || '—'}</Text>
              <Ionicons name={tickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.tabBarInactive} />
            </TouchableOpacity>
          </View>

          {/* Account paper/live */}
          <View style={{ flex: 1 }}>
            <Text style={[styles.controlLabel, { color: colors.tabBarInactive }]}>ACCOUNT</Text>
            <View style={[styles.accountToggle, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {([['Paper', true], ['Live', false]] as const).map(([label, isPaper]) => {
                const active = paperMode === isPaper;
                const tint = isPaper ? '#FF9F0A' : colors.error;
                return (
                  <TouchableOpacity
                    key={label}
                    onPress={() => setPaperMode(isPaper)}
                    activeOpacity={0.8}
                    style={[styles.accountBtn, active && { backgroundColor: tint + '22', borderRadius: 8 }]}
                  >
                    <Text style={[styles.accountText, { color: active ? tint : colors.tabBarInactive, fontWeight: active ? '700' : '500' }]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Ticker dropdown list (inline) */}
        {tickerOpen && (
          <View style={[styles.tickerMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
              {tickerOptions.map(t => {
                const sel = ticker === t;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => { setTicker(t); setTickerOpen(false); setSelected(null); }}
                    activeOpacity={0.7}
                    style={[styles.tickerMenuItem, sel && { backgroundColor: colors.accent + '1A' }]}
                  >
                    <Text style={[styles.tickerMenuItemText, { color: sel ? colors.accent : colors.text, fontWeight: sel ? '700' : '500' }]}>
                      {t}
                    </Text>
                    {sel && <Ionicons name="checkmark" size={16} color={colors.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Calls / Puts + price */}
        <View style={styles.controlRow}>
          <View style={[styles.toggle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {(['CALL', 'PUT'] as const).map(s => {
              const active = side === s;
              const tint = s === 'CALL' ? colors.success : colors.error;
              return (
                <TouchableOpacity
                  key={s}
                  onPress={() => { setSide(s); }}
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
      </View>

      {/* Column headers */}
      {!isLoading && !showError && rows.length > 0 && (
        <View style={[styles.colHeaderRow, { backgroundColor: colors.surface, borderBottomColor: colors.separator }]}>
          <Text style={[styles.colHead, { width: COL.strike, color: colors.textTertiary }]}>Strike</Text>
          <Text style={[styles.colHead, { width: COL.bid, color: colors.success }]}>Bid</Text>
          <Text style={[styles.colHead, { width: COL.ask, color: colors.error }]}>Ask</Text>
          <Text style={[styles.colHead, { width: COL.last, color: colors.textTertiary }]}>Last</Text>
          <Text style={[styles.colHead, { width: COL.oi, color: colors.textTertiary }]}>OI</Text>
          <Text style={[styles.colHead, { flex: 1, color: colors.textTertiary }]}>Volume</Text>
        </View>
      )}

      {/* Chain */}
      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : showError ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
          <Text style={[styles.emptyText, { color: colors.text }]}>Could not load the 0DTE chain</Text>
          <Text style={[styles.emptySub, { color: colors.tabBarInactive }]}>
            0DTE options are only available during market hours.
          </Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="layers-outline" size={32} color={colors.tabBarInactive} />
          <Text style={[styles.emptyText, { color: colors.text }]}>No 0DTE contracts</Text>
          <Text style={[styles.emptySub, { color: colors.tabBarInactive }]}>
            No {side === 'CALL' ? 'calls' : 'puts'} expiring today for {ticker || 'this ticker'}.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          renderItem={renderRow}
          keyExtractor={(item, i) => item.type === 'separator' ? `sep-${i}` : item.data.symbol}
          getItemLayout={getItemLayout}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          initialNumToRender={40}
          maxToRenderPerBatch={20}
          windowSize={21}
        />
      )}

      {/* Detail modal (nested) with the Immediate Trade footer */}
      {selected && (
        <OptionsContractDetailModal
          visible
          onClose={() => setSelected(null)}
          contract={asOpportunity(selected)}
          ticker={ticker}
          currentPrice={currentPrice}
          footer={detailFooter}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controls:     { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
  controlRow:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  controlLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },

  tickerSelect:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  tickerSelectText: { fontSize: 15, fontWeight: '700' },
  tickerMenu:       { borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  tickerMenuItem:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  tickerMenuItemText: { fontSize: 14 },

  accountToggle: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3 },
  accountBtn:    { flex: 1, alignItems: 'center', paddingVertical: 7 },
  accountText:   { fontSize: 13 },

  toggle:      { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: 100, padding: 3, borderWidth: 1 },
  toggleBtn:   { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 100 },
  toggleText:  { fontSize: 13, fontWeight: '600' },
  priceText:   { fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },

  colHeaderRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  colHead:      { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  contractRow:  { flexDirection: 'row', height: ROW_H, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  cell:         { fontSize: 13, textAlign: 'left' },

  separatorRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: SEP_H, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  separatorPill:    { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 100 },
  separatorPillText:{ fontSize: 11, fontWeight: '700' },
  separatorPrice:   { fontSize: 13, fontWeight: '700' },

  centered:   { alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 6 },
  emptyText:  { fontSize: 15, fontWeight: '600', marginTop: 6 },
  emptySub:   { fontSize: 13, textAlign: 'center' },

  footerLabel:      { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  footerProfileRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  footerQtyRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip:        { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  chipText:    { fontSize: 13, fontWeight: '600' },
  qtyGroup:    { flexDirection: 'row', alignItems: 'center', gap: 16 },
  qtyBtn:      { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyValue:    { fontSize: 18, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  submitBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 12 },
  submitText:  { fontSize: 15, fontWeight: '700' },
});
