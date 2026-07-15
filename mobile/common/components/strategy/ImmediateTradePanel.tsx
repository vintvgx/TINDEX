import { useEffect, useRef, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
  FlatList, ScrollView, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useOptionsQuery } from '@/hooks/queries/ticker/useOptionsQuery';
import { useImmediateTradeByTicker } from '@/hooks/mutations/strategy/useImmediateTradeByTicker';
import { OptionsContractDetailModal } from '@/common/components/ticker/OptionsContractDetailModal';
import type { OptionsContract, OptionsOpportunity } from '@/common/types/blogPosts/ticker';
import {
  IMMEDIATE_PROFILES, DEFAULT_PROFILE_INDEX,
  getOtmAutoProfileIndex, ProfileDropdown, ManualSLPicker,
} from '@/common/components/strategy/ImmediateProfilePicker';

interface Props {
  colors: any;
  tickerOptions: string[];
  visible: boolean;
  onClose?: () => void;
}

// ── Expiration targeting ──────────────────────────────────────────────────────
// SPY/QQQ/IWM list a DAILY expiration every weekday (0DTE Mon-Fri) — this used
// to be restricted to a Mon/Wed/Fri-only set, which was correct years ago but
// is now stale: it meant a Tue/Thu attempt skipped that day's real 0DTE chain
// entirely and silently jumped to the next Mon/Wed/Fri match instead (e.g.
// trading on Tuesday would show Wednesday's contracts) — diagnosed 2026-07-15.
// Single stocks only ever list standard Friday weeklies — "today" is
// essentially never a listed expiration for them, which is why this panel
// used to show an empty chain for any non-ETF ticker.
const ETF_TICKERS = new Set(['SPY', 'QQQ', 'IWM']);
// Date.getUTCDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
const ETF_EXPIRY_WEEKDAYS   = new Set([1, 2, 3, 4, 5]); // Mon-Fri — daily 0DTE
const STOCK_EXPIRY_WEEKDAYS = new Set([5]);             // Friday weeklies

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function fmtExpiryLabel(iso: string, todayIso: string): string {
  if (iso === todayIso) return 'Today (0DTE)';
  const d = new Date(iso + 'T00:00:00Z');
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const md = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  return `${weekday} ${md}`;
}

/**
 * Pick the nearest expiration matching the ticker's expected cadence from
 * whatever the chain actually returned. Falls back to the single nearest
 * expiration overall if none match the cadence (holiday shift, data gap) —
 * never show an empty chain when the provider did return something.
 */
function pickTargetExpiration(ticker: string, available: string[]): string | null {
  if (!available.length) return null;
  const allowedWeekdays = ETF_TICKERS.has(ticker.toUpperCase())
    ? ETF_EXPIRY_WEEKDAYS
    : STOCK_EXPIRY_WEEKDAYS;
  const sorted = [...available].sort();
  const matching = sorted.filter(d => allowedWeekdays.has(new Date(d + 'T00:00:00Z').getUTCDay()));
  return matching[0] ?? sorted[0];
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
  const sorted = [...contracts].sort((a, b) => a.strike - b.strike);
  return [
    ...sorted.filter(c => c.strike <= price).map(c => ({ type: 'contract' as const, data: c, isITM: false })),
    { type: 'separator' as const, price },
    ...sorted.filter(c => c.strike > price).map(c => ({ type: 'contract' as const, data: c, isITM: true })),
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

export function ImmediateTradePanel({ colors, tickerOptions, visible, onClose }: Props) {
  const toast = useToast();
  const [ticker, setTicker]             = useState<string>('');
  const [tickerOpen, setTickerOpen]     = useState(false);
  const [tickerInput, setTickerInput]   = useState('');
  const [paperMode, setPaperMode]       = useState(true);
  const [side, setSide]                 = useState<OptionSide>('CALL');
  const [profileIndex, setProfileIndex] = useState(DEFAULT_PROFILE_INDEX);
  const [selected, setSelected]         = useState<OptionsContract | null>(null);
  const [qty, setQty]                   = useState(IMMEDIATE_PROFILES[DEFAULT_PROFILE_INDEX].qty);
  const [consolExit, setConsolExit]     = useState(false);
  const [volumeExit, setVolumeExit]     = useState(false);
  const [manualSlPct, setManualSlPct]   = useState(30);
  const [autoSelected, setAutoSelected] = useState(false);

  const profile   = IMMEDIATE_PROFILES[profileIndex];
  const isManual  = profile.isManual === true;

  const handleProfileSelect = (idx: number) => {
    setProfileIndex(idx);
    setQty(IMMEDIATE_PROFILES[idx].qty);
    setAutoSelected(false); // user explicitly chose — clear the auto flag
  };

  // Auto-select OTM profile when a cheap OTM contract is tapped.
  useEffect(() => {
    if (!selected || !currentPrice) { setAutoSelected(false); return; }
    const idx = getOtmAutoProfileIndex(selected, currentPrice);
    if (idx !== null && idx >= 0) {
      setProfileIndex(idx);
      setQty(IMMEDIATE_PROFILES[idx].qty);
      setAutoSelected(true);
    } else {
      setAutoSelected(false);
    }
  // Only re-run when the selected contract changes, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.symbol]);

  useEffect(() => {
    if (!ticker && tickerOptions.length) setTicker(tickerOptions[0]);
  }, [tickerOptions, ticker]);

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  // ETFs (SPY/QQQ/IWM) may not have a fresh expiration on any given day, and
  // stocks never expire same-day at all — fetch a 2-week window and pick the
  // nearest expiration that actually exists and matches the ticker's cadence,
  // rather than assuming "today" is always a listed expiration.
  const queryWindowEnd = useMemo(() => addDays(today, 14), [today]);
  const { data, isLoading, error } = useOptionsQuery(
    visible && ticker ? ticker : '',
    { limit: 100, expiration_date_gte: today, expiration_date_lte: queryWindowEnd },
    4000,
  );

  const { mutate: submit, isPending } = useImmediateTradeByTicker();

  const chain        = data?.success ? data.data : null;
  const currentPrice = chain?.current_price ?? 0;

  // Every expiration actually available for this ticker's cadence — lets the
  // user pick a specific date instead of only ever trusting the "nearest
  // match" auto-pick, which is exactly what silently substituted the wrong
  // day's chain (see the ETF_EXPIRY_WEEKDAYS comment above).
  const availableExpirations = useMemo(() => {
    if (!chain) return [];
    const allowedWeekdays = ETF_TICKERS.has(ticker.toUpperCase())
      ? ETF_EXPIRY_WEEKDAYS
      : STOCK_EXPIRY_WEEKDAYS;
    return [...chain.expirations_fetched]
      .filter(d => allowedWeekdays.has(new Date(d + 'T00:00:00Z').getUTCDay()))
      .sort();
  }, [chain, ticker]);

  const [manualExpiration, setManualExpiration] = useState<string | null>(null);

  // Reset the manual pick whenever the ticker changes — a date chosen for one
  // ticker's chain has no meaning for another.
  useEffect(() => {
    setManualExpiration(null);
  }, [ticker]);

  const targetExpiration = useMemo(() => {
    if (manualExpiration && availableExpirations.includes(manualExpiration)) {
      return manualExpiration;
    }
    if (!chain) return null;
    return pickTargetExpiration(ticker, chain.expirations_fetched);
  }, [manualExpiration, availableExpirations, chain, ticker]);

  const sideContracts = useMemo(() => {
    if (!chain || !targetExpiration) return [];
    const list = side === 'CALL' ? chain.calls : chain.puts;
    return list.filter(c => c.expiration === targetExpiration);
  }, [chain, side, targetExpiration]);

  const rows = useMemo(() => buildRows(sideContracts, currentPrice, side), [sideContracts, currentPrice, side]);

  // ── ITM centering ──
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
        profile:         profile.key,
        paper_mode:      paperMode,
        consol_exit:     isManual ? false : consolExit,
        volume_exit:     isManual ? false : volumeExit,
        ...(isManual ? { max_loss_pct: manualSlPct / 100 } : {}),
      },
      {
        onSuccess: (r) => {
          toast.success(r.message || 'Immediate trade submitted');
          setSelected(null);
          setQty(profile.qty);
          onClose?.();
        },
        onError: (e) => {
          toast.error(e.message || 'Trade failed');
          setSelected(null);
          onClose?.();
        },
      },
    );
  };

  const confirmSubmit = () => {
    if (!ticker || !selected) return;
    if (!paperMode) {
      Alert.alert(
        'Submit LIVE Order',
        `This will buy ${qty} × ${selected.symbol} with REAL money immediately.\n\nProfile: ${profile.emoji} ${profile.name}${isManual ? `\nStop Loss: −${manualSlPct}%` : ''}`,
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
      {/* Profile dropdown */}
      <View>
        <Text style={[styles.footerLabel, { color: colors.tabBarInactive }]}>EXIT PROFILE</Text>
        <ProfileDropdown
          selectedIndex={profileIndex}
          onSelect={handleProfileSelect}
          colors={colors}
        />
        {autoSelected && (
          <View style={[styles.autoSelectBanner, { backgroundColor: colors.accent + '15', borderColor: colors.accent + '35' }]}>
            <Ionicons name="flash-outline" size={12} color={colors.accent} />
            <Text style={[styles.autoSelectText, { color: colors.accent }]}>
              Auto-selected · OTM contract · ask ${selected!.ask.toFixed(2)}
            </Text>
            <Text style={[styles.autoSelectSub, { color: colors.tabBarInactive }]}>
              Tap above to override
            </Text>
          </View>
        )}
      </View>

      {/* Manual SL picker — only when MANUAL selected */}
      {isManual && (
        <ManualSLPicker
          slPct={manualSlPct}
          onChangePct={setManualSlPct}
          askPrice={selected.ask}
          colors={colors}
        />
      )}

      {/* Contracts */}
      <View style={styles.footerQtyRow}>
        <View>
          <Text style={[styles.footerLabel, { color: colors.tabBarInactive, marginBottom: 2 }]}>CONTRACTS</Text>
          <Text style={[styles.qtyHint, { color: colors.tabBarInactive }]}>
            Default for {profile.name}: {profile.qty}
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

      {/* Auto exit toggles — hidden for MANUAL (manual controls own exit) */}
      {!isManual && (
        <View>
          <Text style={[styles.footerLabel, { color: colors.tabBarInactive }]}>EXIT CONTROLS</Text>
          <View style={[styles.exitToggles, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.exitToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.exitToggleLabel, { color: colors.text }]}>Consolidation Exit</Text>
                <Text style={[styles.exitToggleSub, { color: colors.tabBarInactive }]}>Close when price stops moving</Text>
              </View>
              <TouchableOpacity
                onPress={() => setConsolExit(v => !v)}
                style={[styles.togglePill, { backgroundColor: consolExit ? colors.accent + '33' : colors.border + '55', borderColor: consolExit ? colors.accent : colors.border }]}
              >
                <View style={[styles.toggleThumb, { backgroundColor: consolExit ? colors.accent : colors.tabBarInactive, transform: [{ translateX: consolExit ? 14 : 0 }] }]} />
              </TouchableOpacity>
            </View>
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
          </View>
        </View>
      )}

      {/* Submit */}
      <TouchableOpacity
        onPress={confirmSubmit}
        disabled={isPending}
        activeOpacity={0.85}
        style={[styles.submitBtn, {
          backgroundColor: isPending ? colors.border : (paperMode ? colors.accent : colors.error),
        }]}
      >
        {isPending ? (
          <ActivityIndicator color={paperMode ? colors.accentForeground : '#fff'} />
        ) : (
          <>
            <Ionicons name="flash" size={18} color={paperMode ? colors.accentForeground : '#fff'} />
            <Text style={[styles.submitText, { color: paperMode ? colors.accentForeground : '#fff' }]}>
              {paperMode ? '' : 'LIVE '}Buy {qty} {selected.option_type} · {profile.emoji} {profile.name}
              {isManual ? ` · SL −${manualSlPct}%` : ''}
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
        <View style={styles.controlRow}>
          {/* Ticker */}
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

          {/* Paper / Live */}
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

        {/* Ticker dropdown */}
        {tickerOpen && (
          <View style={[styles.tickerMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Free-text entry — tickerOptions only lists ORB-monitored tickers
                (effectively SPY/QQQ/IWM today), so this is the only way to reach
                any other stock. Same 1-5 alpha validation the backend applies. */}
            <View style={styles.tickerSearchRow}>
              <TextInput
                value={tickerInput}
                onChangeText={t => setTickerInput(t.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5))}
                placeholder="Type any ticker (e.g. AAPL)"
                placeholderTextColor={colors.tabBarInactive}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[styles.tickerSearchInput, { color: colors.text, borderColor: colors.border }]}
                onSubmitEditing={() => {
                  if (!tickerInput) return;
                  setTicker(tickerInput);
                  setTickerOpen(false);
                  setSelected(null);
                  setTickerInput('');
                }}
                returnKeyType="go"
              />
              <TouchableOpacity
                onPress={() => {
                  if (!tickerInput) return;
                  setTicker(tickerInput);
                  setTickerOpen(false);
                  setSelected(null);
                  setTickerInput('');
                }}
                disabled={!tickerInput}
                style={[styles.tickerSearchGo, { backgroundColor: tickerInput ? colors.accent : colors.border }]}
              >
                <Ionicons name="arrow-forward" size={16} color={colors.iconButton ?? '#fff'} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 160 }} keyboardShouldPersistTaps="handled">
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
            the wrong day's chain — see ETF_EXPIRY_WEEKDAYS above). */}
        {availableExpirations.length > 0 && (
          <View>
            <Text style={[styles.controlLabel, { color: colors.tabBarInactive, marginTop: 4 }]}>EXPIRATION</Text>
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
          </View>
        )}
      </View>

      {/* Column headers */}
      {!isLoading && !showError && rows.length > 0 && (
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
      {isLoading ? (
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

  tickerSelect:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  tickerSelectText:  { fontSize: 15, fontWeight: '700' },
  tickerMenu:        { borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  tickerMenuItem:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  tickerMenuItemText:{ fontSize: 14 },
  tickerSearchRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  tickerSearchInput: { flex: 1, fontSize: 14, fontWeight: '600', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  tickerSearchGo:    { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  accountToggle: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3 },
  accountBtn:    { flex: 1, alignItems: 'center', paddingVertical: 7 },
  accountText:   { fontSize: 13 },

  toggle:     { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: 100, padding: 3, borderWidth: 1 },
  toggleBtn:  { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 100 },
  toggleText: { fontSize: 13, fontWeight: '600' },
  priceText:  { fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },

  expiryChip:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100, borderWidth: 1 },
  expiryChipText: { fontSize: 12, fontWeight: '700' },

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

  // ── Auto-select banner ──
  autoSelectBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  autoSelectText:   { fontSize: 11, fontWeight: '600', flex: 1 },
  autoSelectSub:    { fontSize: 10 },

  // ── Footer ──
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
