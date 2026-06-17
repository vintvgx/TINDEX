import { useEffect, useRef, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
  FlatList, ScrollView, Switch, Animated, LayoutChangeEvent,
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
  tickerOptions: string[];
  visible: boolean;
  onClose?: () => void;
}

// ── Immediate-trade profile definitions ──────────────────────────────────────
// Ordered left → right on slider: risk-conscious → profit-maximising
// Default index: 2 (MOMENTUM — center)

interface ImmediateProfile {
  key: ProfileKey;
  emoji: string;
  name: string;
  shortName: string;
  qty: number;
  maxLoss: number;  // percent, e.g. 30
  tp1: number;      // percent gain at TP1, e.g. 30
  tp2: number;      // percent gain at TP2 (0 = pure runner)
  risk: string;
  description: string;
}

const IMMEDIATE_PROFILES: ImmediateProfile[] = [
  {
    key: 'SCALPER',
    emoji: '⚡',
    name: 'Scalper',
    shortName: 'Scalp',
    qty: 3,
    maxLoss: 30,
    tp1: 30,
    tp2: 60,
    risk: 'Low',
    description: 'Quick locks, take gains fast, tight trail on the runner.',
  },
  {
    key: 'PRECISION',
    emoji: '🎯',
    name: 'Precision',
    shortName: 'Prec.',
    qty: 2,
    maxLoss: 25,
    tp1: 40,
    tp2: 80,
    risk: 'Low-Med',
    description: 'Disciplined ATM entry, balanced close at both targets.',
  },
  {
    key: 'MOMENTUM',
    emoji: '📈',
    name: 'Momentum',
    shortName: 'Momo',
    qty: 4,
    maxLoss: 40,
    tp1: 20,
    tp2: 50,
    risk: 'Medium',
    description: 'Small TP1 clip, let the bulk of the position run with the trend.',
  },
  {
    key: 'CONVICTION',
    emoji: '💎',
    name: 'Conviction',
    shortName: 'Conv.',
    qty: 5,
    maxLoss: 45,
    tp1: 15,
    tp2: 35,
    risk: 'Med-High',
    description: 'High-confidence runner play. Tiny TP1 clip, almost all rides.',
  },
  {
    key: 'ALL_IN',
    emoji: '🔥',
    name: 'All In',
    shortName: 'All In',
    qty: 8,
    maxLoss: 50,
    tp1: 10,
    tp2: 0,
    risk: 'High',
    description: 'Max size, no TP2 — pure runner trail until EOD or stopped.',
  },
];

const DEFAULT_PROFILE_INDEX = 2; // MOMENTUM

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

// ── Profile Slider ────────────────────────────────────────────────────────────

function ProfileSlider({
  selectedIndex,
  onSelect,
  colors,
}: {
  selectedIndex: number;
  onSelect: (idx: number) => void;
  colors: any;
}) {
  const thumbAnim = useRef(new Animated.Value(selectedIndex)).current;
  const [trackWidth, setTrackWidth] = useState(0);

  const onTrackLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  useEffect(() => {
    Animated.spring(thumbAnim, {
      toValue: selectedIndex,
      useNativeDriver: false,
      speed: 20,
      bounciness: 4,
    }).start();
  }, [selectedIndex, thumbAnim]);

  const count = IMMEDIATE_PROFILES.length;
  const stopPct = (idx: number) => (idx / (count - 1)) * 100;

  const thumbLeft = trackWidth > 0
    ? thumbAnim.interpolate({
        inputRange:  IMMEDIATE_PROFILES.map((_, i) => i),
        outputRange: IMMEDIATE_PROFILES.map((_, i) => (trackWidth * i) / (count - 1) - 10),
      })
    : new Animated.Value(0);

  const profile = IMMEDIATE_PROFILES[selectedIndex];
  const riskColor = (r: string) => {
    if (r === 'Low')      return '#22C55E';
    if (r === 'Low-Med')  return '#84CC16';
    if (r === 'Medium')   return '#F59E0B';
    if (r === 'Med-High') return '#F97316';
    return '#EF4444';
  };

  return (
    <View>
      {/* Track + labels */}
      <View style={styles.sliderContainer} onLayout={onTrackLayout}>
        {/* Background track */}
        <View style={[styles.sliderTrack, { backgroundColor: colors.border }]} />

        {/* Filled track (left → thumb) */}
        {trackWidth > 0 && (
          <Animated.View
            style={[
              styles.sliderFill,
              {
                backgroundColor: colors.accent,
                width: thumbAnim.interpolate({
                  inputRange:  IMMEDIATE_PROFILES.map((_, i) => i),
                  outputRange: IMMEDIATE_PROFILES.map((_, i) => (trackWidth * i) / (count - 1)),
                }),
              },
            ]}
          />
        )}

        {/* Stop dots + labels */}
        {IMMEDIATE_PROFILES.map((p, i) => {
          const active = i === selectedIndex;
          return (
            <TouchableOpacity
              key={p.key}
              onPress={() => onSelect(i)}
              hitSlop={12}
              activeOpacity={0.7}
              style={[styles.sliderStop, { left: `${stopPct(i)}%` as any }]}
            >
              <View style={[
                styles.sliderDot,
                {
                  backgroundColor: i <= selectedIndex ? colors.accent : colors.border,
                  borderColor:     active ? colors.accent : colors.border,
                  transform: [{ scale: active ? 1.2 : 1 }],
                },
              ]} />
              <Text style={[
                styles.sliderStopEmoji,
                { color: active ? colors.text : colors.tabBarInactive },
              ]}>
                {p.emoji}
              </Text>
              <Text style={[
                styles.sliderStopLabel,
                { color: active ? colors.accent : colors.tabBarInactive, fontWeight: active ? '700' : '500' },
              ]}>
                {p.shortName}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Animated thumb */}
        {trackWidth > 0 && (
          <Animated.View
            style={[styles.sliderThumb, { backgroundColor: colors.accent, left: thumbLeft }]}
          />
        )}
      </View>

      {/* Profile detail card */}
      <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.profileCardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.profileCardName, { color: colors.text }]}>
              {profile.emoji} {profile.name}
            </Text>
            <Text style={[styles.profileCardDesc, { color: colors.tabBarInactive }]}>
              {profile.description}
            </Text>
          </View>
          <View style={[styles.riskBadge, { backgroundColor: riskColor(profile.risk) + '22' }]}>
            <Text style={[styles.riskBadgeText, { color: riskColor(profile.risk) }]}>{profile.risk}</Text>
          </View>
        </View>
        <View style={[styles.profileStats, { borderTopColor: colors.border }]}>
          <ProfileStat label="Contracts" value={String(profile.qty)} colors={colors} />
          <ProfileStat label="Max Loss"  value={`${profile.maxLoss}%`} valueColor="#EF4444" colors={colors} />
          <ProfileStat label="TP1"       value={`+${profile.tp1}%`}  valueColor="#22C55E" colors={colors} />
          <ProfileStat
            label="TP2"
            value={profile.tp2 > 0 ? `+${profile.tp2}%` : 'Runner'}
            valueColor={profile.tp2 > 0 ? '#22C55E' : colors.accent}
            colors={colors}
          />
        </View>
      </View>
    </View>
  );
}

const ProfileStat = ({ label, value, valueColor, colors }: {
  label: string; value: string; valueColor?: string; colors: any;
}) => (
  <View style={styles.profileStatItem}>
    <Text style={[styles.profileStatValue, { color: valueColor ?? colors.text }]}>{value}</Text>
    <Text style={[styles.profileStatLabel, { color: colors.tabBarInactive }]}>{label}</Text>
  </View>
);

// ── Main component ────────────────────────────────────────────────────────────

export function ImmediateTradePanel({ colors, tickerOptions, visible, onClose }: Props) {
  const toast = useToast();
  const [ticker, setTicker]       = useState<string>('');
  const [tickerOpen, setTickerOpen] = useState(false);
  const [paperMode, setPaperMode] = useState(true);
  const [side, setSide]           = useState<OptionSide>('CALL');
  const [profileIndex, setProfileIndex] = useState(DEFAULT_PROFILE_INDEX);
  const [selected, setSelected]   = useState<OptionsContract | null>(null);
  const [qty, setQty]             = useState(IMMEDIATE_PROFILES[DEFAULT_PROFILE_INDEX].qty);
  const [consolExit, setConsolExit] = useState(false);
  const [volumeExit, setVolumeExit] = useState(false);

  const profile = IMMEDIATE_PROFILES[profileIndex];

  // When profile changes: reset qty to that profile's default
  const handleProfileSelect = (idx: number) => {
    setProfileIndex(idx);
    setQty(IMMEDIATE_PROFILES[idx].qty);
  };

  useEffect(() => {
    if (!ticker && tickerOptions.length) setTicker(tickerOptions[0]);
  }, [tickerOptions, ticker]);

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const { data, isLoading, error } = useOptionsQuery(
    visible && ticker ? ticker : '',
    { limit: 100, expiration_date_gte: today, expiration_date_lte: today },
    4000,
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
        profile:         profile.key,
        paper_mode:      paperMode,
        consol_exit:     consolExit,
        volume_exit:     volumeExit,
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
        `This will buy ${qty} × ${selected.symbol} with REAL money immediately.\n\nProfile: ${profile.emoji} ${profile.name}`,
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
      {/* Profile slider */}
      <View>
        <Text style={[styles.footerLabel, { color: colors.tabBarInactive }]}>EXIT PROFILE</Text>
        <ProfileSlider
          selectedIndex={profileIndex}
          onSelect={handleProfileSelect}
          colors={colors}
        />
      </View>

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

      {/* Exit controls */}
      <View>
        <Text style={[styles.footerLabel, { color: colors.tabBarInactive }]}>EXIT CONTROLS</Text>
        <View style={[styles.exitToggles, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.exitToggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.exitToggleLabel, { color: colors.text }]}>Consolidation Exit</Text>
              <Text style={[styles.exitToggleSub, { color: colors.tabBarInactive }]}>Close when price stops moving</Text>
            </View>
            <Switch
              value={consolExit}
              onValueChange={setConsolExit}
              thumbColor={consolExit ? '#4A9EFF' : '#ccc'}
              trackColor={{ true: '#4A9EFF55', false: colors.border }}
            />
          </View>
          <View style={[styles.exitToggleRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.exitToggleLabel, { color: colors.text }]}>Volume Exit</Text>
              <Text style={[styles.exitToggleSub, { color: colors.tabBarInactive }]}>Close half on low volume</Text>
            </View>
            <Switch
              value={volumeExit}
              onValueChange={setVolumeExit}
              thumbColor={volumeExit ? '#4A9EFF' : '#ccc'}
              trackColor={{ true: '#4A9EFF55', false: colors.border }}
            />
          </View>
        </View>
      </View>

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

  accountToggle: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3 },
  accountBtn:    { flex: 1, alignItems: 'center', paddingVertical: 7 },
  accountText:   { fontSize: 13 },

  toggle:     { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: 100, padding: 3, borderWidth: 1 },
  toggleBtn:  { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 100 },
  toggleText: { fontSize: 13, fontWeight: '600' },
  priceText:  { fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },

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

  // ── Slider ──
  sliderContainer: { height: 90, marginHorizontal: 10, marginBottom: 4, position: 'relative', justifyContent: 'flex-start', paddingTop: 2 },
  sliderTrack:     { position: 'absolute', top: 10, left: 10, right: 10, height: 3, borderRadius: 2 },
  sliderFill:      { position: 'absolute', top: 10, left: 10, height: 3, borderRadius: 2 },
  sliderThumb:     { position: 'absolute', top: 3, width: 20, height: 20, borderRadius: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  sliderStop:      { position: 'absolute', alignItems: 'center', transform: [{ translateX: -10 }] },
  sliderDot:       { width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginBottom: 4 },
  sliderStopEmoji: { fontSize: 14, marginBottom: 1 },
  sliderStopLabel: { fontSize: 10 },

  // ── Profile card ──
  profileCard:       { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 2, gap: 10 },
  profileCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  profileCardName:   { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  profileCardDesc:   { fontSize: 12, lineHeight: 16 },
  riskBadge:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  riskBadgeText:     { fontSize: 11, fontWeight: '700' },
  profileStats:      { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  profileStatItem:   { alignItems: 'center' },
  profileStatValue:  { fontSize: 14, fontWeight: '700' },
  profileStatLabel:  { fontSize: 10, marginTop: 2 },

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

  submitBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 12 },
  submitText: { fontSize: 15, fontWeight: '700' },
});
