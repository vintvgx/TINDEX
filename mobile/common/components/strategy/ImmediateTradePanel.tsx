import { useEffect, useRef, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
  FlatList, ScrollView,
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

interface ImmediateProfile {
  key: ProfileKey;
  emoji: string;
  name: string;
  qty: number;
  maxLoss: number;  // percent, e.g. 30
  tp1: number;      // percent gain at TP1 (0 = no auto TP)
  tp2: number;      // percent gain at TP2 (0 = runner or none)
  risk: string;
  description: string;
  isManual?: boolean;
  isOtmProfile?: boolean;
}

const IMMEDIATE_PROFILES: ImmediateProfile[] = [
  {
    key: 'SCALPER',
    emoji: '⚡',
    name: 'Scalper',
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
    qty: 8,
    maxLoss: 50,
    tp1: 10,
    tp2: 0,
    risk: 'High',
    description: 'Max size, no TP2 — pure runner trail until EOD or stopped.',
  },
  {
    key: 'OTM_RUNNER',
    emoji: '🚀',
    name: 'OTM Runner',
    qty: 10,
    maxLoss: 60,
    tp1: 100,
    tp2: 250,
    risk: 'High',
    description: 'For contracts under $0.25. TP targets sized for a real underlying move — not bid/ask noise.',
    isOtmProfile: true,
  },
  {
    key: 'OTM_CONVICTION',
    emoji: '🎯',
    name: 'OTM Conviction',
    qty: 6,
    maxLoss: 55,
    tp1: 75,
    tp2: 200,
    risk: 'Med-High',
    description: 'For contracts $0.25–$0.40. High-confidence directional play with room to breathe.',
    isOtmProfile: true,
  },
  {
    key: 'MANUAL',
    emoji: '✋',
    name: 'Manual',
    qty: 2,
    maxLoss: 30,
    tp1: 0,
    tp2: 0,
    risk: 'Custom',
    description: 'You control the exit. Set your stop loss below — nothing else closes automatically.',
    isManual: true,
  },
];

const DEFAULT_PROFILE_INDEX = 2; // MOMENTUM
const SL_PRESETS = [20, 30, 40, 50];

// ── OTM auto-selection ────────────────────────────────────────────────────────
// Above this ask price, OTM contracts are priced well enough for normal profiles.
// Raised to $0.50 to capture mid-range OTM contracts like the $0.48 QQQ CALL today.
const OTM_PRICE_CEILING = 0.50;
// Below this ask price, use OTM_RUNNER (cheaper lottery-ticket contracts).
// Between OTM_RUNNER_CEILING and OTM_PRICE_CEILING, use OTM_CONVICTION.
const OTM_RUNNER_CEILING = 0.25;

function getOtmAutoProfileIndex(
  contract: OptionsContract,
  underlyingPrice: number,
): number | null {
  if (!underlyingPrice || underlyingPrice <= 0) return null;
  const isOTM =
    contract.option_type === 'CALL'
      ? contract.strike > underlyingPrice
      : contract.strike < underlyingPrice;
  if (!isOTM || contract.ask <= 0 || contract.ask >= OTM_PRICE_CEILING) return null;
  const targetKey: ProfileKey =
    contract.ask < OTM_RUNNER_CEILING ? 'OTM_RUNNER' : 'OTM_CONVICTION';
  return IMMEDIATE_PROFILES.findIndex(p => p.key === targetKey);
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const riskColor = (r: string, colors: any): string => {
  if (r === 'Low')      return '#22C55E';
  if (r === 'Low-Med')  return '#84CC16';
  if (r === 'Medium')   return '#F59E0B';
  if (r === 'Med-High') return '#F97316';
  if (r === 'High')     return '#EF4444';
  return colors.accent; // Custom / OTM
};

// ── ProfileDropdown ───────────────────────────────────────────────────────────

function ProfileDropdown({
  selectedIndex,
  onSelect,
  colors,
}: {
  selectedIndex: number;
  onSelect: (idx: number) => void;
  colors: any;
}) {
  const [open, setOpen] = useState(false);
  const profile = IMMEDIATE_PROFILES[selectedIndex];

  return (
    <View>
      {/* Trigger */}
      <TouchableOpacity
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.8}
        style={[styles.ddTrigger, { backgroundColor: colors.card, borderColor: open ? colors.accent : colors.border }]}
      >
        <Text style={[styles.ddTriggerEmoji]}>{profile.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.ddTriggerName, { color: colors.text }]}>{profile.name}</Text>
          <Text style={[styles.ddTriggerSub, { color: colors.tabBarInactive }]} numberOfLines={1}>
            {profile.isManual
              ? 'Manual exit — SL only'
              : `Stop −${profile.maxLoss}%  ·  TP1 +${profile.tp1}%  ·  ${profile.tp2 > 0 ? `TP2 +${profile.tp2}%` : 'Runner'}`}
          </Text>
        </View>
        <View style={[styles.ddRiskBadge, { backgroundColor: riskColor(profile.risk, colors) + '22' }]}>
          <Text style={[styles.ddRiskText, { color: riskColor(profile.risk, colors) }]}>{profile.risk}</Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.tabBarInactive}
          style={{ marginLeft: 6 }}
        />
      </TouchableOpacity>

      {/* Expanded list */}
      {open && (
        <View style={[styles.ddList, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {IMMEDIATE_PROFILES.map((p, i) => {
            const active = i === selectedIndex;
            const rc = riskColor(p.risk, colors);
            const prevProfile = i > 0 ? IMMEDIATE_PROFILES[i - 1] : null;
            const showOtmHeader = p.isOtmProfile && !prevProfile?.isOtmProfile;
            const showManualHeader = p.isManual && !prevProfile?.isManual;
            return (
              <View key={p.key}>
                {showOtmHeader && (
                  <View style={[styles.ddSectionHeader, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
                    <View style={[styles.ddSectionDivider, { backgroundColor: colors.border }]} />
                    <Text style={[styles.ddSectionLabel, { color: colors.tabBarInactive }]}>OTM CONTRACTS</Text>
                    <View style={[styles.ddSectionDivider, { backgroundColor: colors.border }]} />
                  </View>
                )}
                {showManualHeader && (
                  <View style={[styles.ddSectionHeader, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
                    <View style={[styles.ddSectionDivider, { backgroundColor: colors.border }]} />
                    <Text style={[styles.ddSectionLabel, { color: colors.tabBarInactive }]}>MANUAL CONTROL</Text>
                    <View style={[styles.ddSectionDivider, { backgroundColor: colors.border }]} />
                  </View>
                )}
              <TouchableOpacity
                onPress={() => { onSelect(i); setOpen(false); }}
                activeOpacity={0.75}
                style={[
                  styles.ddItem,
                  { borderBottomColor: colors.border },
                  active && { backgroundColor: colors.accent + '12' },
                  i === IMMEDIATE_PROFILES.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <View style={styles.ddItemHeader}>
                  <Text style={styles.ddItemEmoji}>{p.emoji}</Text>
                  <Text style={[styles.ddItemName, { color: colors.text }]}>{p.name}</Text>
                  {active && (
                    <Ionicons name="checkmark-circle" size={15} color={colors.accent} style={{ marginLeft: 4 }} />
                  )}
                  <View style={[styles.ddRiskBadge, { backgroundColor: rc + '22', marginLeft: 'auto' }]}>
                    <Text style={[styles.ddRiskText, { color: rc }]}>{p.risk}</Text>
                  </View>
                </View>
                <Text style={[styles.ddItemDesc, { color: colors.tabBarInactive }]}>{p.description}</Text>
                {!p.isManual && (
                  <View style={styles.ddItemStats}>
                    <DDStat label="Max Loss" value={`−${p.maxLoss}%`} color="#EF4444" colors={colors} />
                    <DDStat label="TP1"      value={`+${p.tp1}%`}   color="#22C55E" colors={colors} />
                    <DDStat
                      label={p.tp2 > 0 ? 'TP2' : 'Exit'}
                      value={p.tp2 > 0 ? `+${p.tp2}%` : 'Runner'}
                      color={p.tp2 > 0 ? '#22C55E' : colors.accent}
                      colors={colors}
                    />
                    <DDStat label="Qty" value={String(p.qty)} colors={colors} />
                  </View>
                )}
                {p.isManual && (
                  <View style={styles.ddItemStats}>
                    <DDStat label="TP1 / TP2" value="None" color={colors.tabBarInactive} colors={colors} />
                    <DDStat label="Stop Loss" value="You set it" color="#EF4444" colors={colors} />
                    <DDStat label="Qty" value={String(p.qty)} colors={colors} />
                  </View>
                )}
              </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const DDStat = ({ label, value, color, colors }: { label: string; value: string; color?: string; colors: any }) => (
  <View style={styles.ddStatItem}>
    <Text style={[styles.ddStatValue, { color: color ?? colors.text }]}>{value}</Text>
    <Text style={[styles.ddStatLabel, { color: colors.tabBarInactive }]}>{label}</Text>
  </View>
);

// ── ManualSLPicker ────────────────────────────────────────────────────────────

function ManualSLPicker({
  slPct,
  onChangePct,
  askPrice,
  colors,
}: {
  slPct: number;
  onChangePct: (pct: number) => void;
  askPrice: number;
  colors: any;
}) {
  const stopPrice = askPrice > 0 ? (askPrice * (1 - slPct / 100)).toFixed(2) : null;

  return (
    <View style={[styles.slPickerWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.slHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="shield-half-outline" size={14} color="#EF4444" />
          <Text style={[styles.slTitle, { color: colors.text }]}>Stop Loss</Text>
        </View>
        <View style={styles.slValueRow}>
          <Text style={[styles.slPct, { color: '#EF4444' }]}>−{slPct}%</Text>
          {stopPrice && (
            <Text style={[styles.slStop, { color: colors.tabBarInactive }]}>
              stop at ${stopPrice}
            </Text>
          )}
        </View>
      </View>

      {/* Preset chips */}
      <View style={styles.slPresets}>
        {SL_PRESETS.map(pct => {
          const active = slPct === pct;
          const stopAt = askPrice > 0 ? (askPrice * (1 - pct / 100)).toFixed(2) : null;
          return (
            <TouchableOpacity
              key={pct}
              onPress={() => onChangePct(pct)}
              activeOpacity={0.75}
              style={[
                styles.slChip,
                {
                  backgroundColor: active ? '#EF444422' : colors.surface ?? colors.card,
                  borderColor: active ? '#EF4444' : colors.border,
                },
              ]}
            >
              <Text style={[styles.slChipPct, { color: active ? '#EF4444' : colors.text }]}>
                −{pct}%
              </Text>
              {stopAt && (
                <Text style={[styles.slChipStop, { color: active ? '#EF4444' : colors.tabBarInactive }]}>
                  ${stopAt}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Fine stepper */}
      <View style={[styles.slStepper, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => onChangePct(Math.max(10, slPct - 5))}
          style={[styles.slStepBtn, { borderColor: colors.border }]}
          hitSlop={8}
        >
          <Ionicons name="remove" size={16} color={colors.text} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.slStepValue, { color: colors.text }]}>{slPct}%</Text>
          <Text style={[styles.slStepLabel, { color: colors.tabBarInactive }]}>custom</Text>
        </View>
        <TouchableOpacity
          onPress={() => onChangePct(Math.min(75, slPct + 5))}
          style={[styles.slStepBtn, { borderColor: colors.border }]}
          hitSlop={8}
        >
          <Ionicons name="add" size={16} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImmediateTradePanel({ colors, tickerOptions, visible, onClose }: Props) {
  const toast = useToast();
  const [ticker, setTicker]             = useState<string>('');
  const [tickerOpen, setTickerOpen]     = useState(false);
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
  const { data, isLoading, error } = useOptionsQuery(
    visible && ticker ? ticker : '',
    { limit: 100, expiration_date_gte: today, expiration_date_lte: today },
    4000,
  );

  const { mutate: submit, isPending } = useImmediateTradeByTicker();

  const chain        = data?.success ? data.data : null;
  const currentPrice = chain?.current_price ?? 0;

  const sideContracts = useMemo(() => {
    if (!chain) return [];
    const list = side === 'CALL' ? chain.calls : chain.puts;
    return list.filter(c => c.expiration === today);
  }, [chain, side, today]);

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

  // ── Auto-select banner ──
  autoSelectBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  autoSelectText:   { fontSize: 11, fontWeight: '600', flex: 1 },
  autoSelectSub:    { fontSize: 10 },

  // ── Profile dropdown ──
  ddTrigger:      { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  ddTriggerEmoji: { fontSize: 22 },
  ddTriggerName:  { fontSize: 15, fontWeight: '700', marginBottom: 1 },
  ddTriggerSub:   { fontSize: 11 },
  ddRiskBadge:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  ddRiskText:     { fontSize: 10, fontWeight: '700' },
  ddList:         { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginTop: 6 },
  ddItem:         { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  ddItemHeader:   { flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 6 },
  ddItemEmoji:    { fontSize: 16 },
  ddItemName:     { fontSize: 14, fontWeight: '700' },
  ddItemDesc:     { fontSize: 11, lineHeight: 15, marginBottom: 8 },
  ddItemStats:    { flexDirection: 'row', gap: 16 },
  ddSectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  ddSectionDivider:{ flex: 1, height: StyleSheet.hairlineWidth },
  ddSectionLabel:  { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  ddStatItem:      { alignItems: 'center' },
  ddStatValue:    { fontSize: 13, fontWeight: '700' },
  ddStatLabel:    { fontSize: 10, marginTop: 1 },

  // ── Manual SL picker ──
  slPickerWrap: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  slHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  slTitle:      { fontSize: 13, fontWeight: '700' },
  slValueRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slPct:        { fontSize: 16, fontWeight: '800' },
  slStop:       { fontSize: 11 },
  slPresets:    { flexDirection: 'row', paddingHorizontal: 10, paddingBottom: 10, gap: 8 },
  slChip:       { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  slChipPct:    { fontSize: 13, fontWeight: '700' },
  slChipStop:   { fontSize: 10, marginTop: 2 },
  slStepper:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  slStepBtn:    { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  slStepValue:  { fontSize: 18, fontWeight: '700' },
  slStepLabel:  { fontSize: 10, marginTop: 1 },

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
