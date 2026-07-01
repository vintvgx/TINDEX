import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ScrollView, SafeAreaView, Switch, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import {
  ZERO_DTE_PROFILE_LABELS,
  ZERO_DTE_PROFILE_DESCRIPTIONS,
} from '@/common/types/zero_dte';
import type { ZeroDTEProfileName } from '@/common/types/zero_dte';
import type { FlowAlert } from '@/common/types/flow';
import { formatPremium } from '@/common/types/flow';

interface Props {
  alert: FlowAlert | null;
  visible: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    ticker: string;
    contract_type: 'call' | 'put';
    strike: number;
    expiry: string;
    qty: number;
    entry_price: number;
    strategy_profile: ZeroDTEProfileName;
    mode: 'paper' | 'live';
  }) => void;
  isLoading?: boolean;
}

const PROFILES: ZeroDTEProfileName[] = ['SCALP', 'MOMENTUM', 'AGGRESSIVE'];

const PROFILE_STOP: Record<ZeroDTEProfileName, number>       = { SCALP: 0.30, MOMENTUM: 0.40, AGGRESSIVE: 0.50 };
const PROFILE_TP1:  Record<ZeroDTEProfileName, number>       = { SCALP: 0.30, MOMENTUM: 0.40, AGGRESSIVE: 0.60 };
const PROFILE_TP2:  Record<ZeroDTEProfileName, number | null> = { SCALP: null, MOMENTUM: 0.80, AGGRESSIVE: 1.20 };

const formatExpiry = (d: string): string => {
  try {
    const [, m, day] = d.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[m - 1]} ${day}`;
  } catch { return d; }
};

function fmt_cost(premium: number, qty: number): string {
  return `$${(premium * 100 * qty).toFixed(0)}`;
}

export function FlowEnterModal({ alert, visible, onClose, onSubmit, isLoading }: Props) {
  const colors = useThemeColors();
  const [profile, setProfile]     = useState<ZeroDTEProfileName>('SCALP');
  const [qty, setQty]             = useState('1');
  const [entryPrice, setEntryPrice] = useState('');
  const [isLive, setIsLive]       = useState(false);

  if (!alert) return null;

  const isCall       = alert.contract_type === 'call';
  const sideColor    = isCall ? '#10B981' : '#EF4444';
  const strike       = parseFloat(alert.strike);
  const askPrice     = parseFloat(alert.ask) || parseFloat(alert.price) || 0;
  const parsedQty    = Math.max(1, parseInt(qty, 10) || 1);
  const displayPrice = parseFloat(entryPrice) || askPrice;
  const estimatedCost = fmt_cost(displayPrice, parsedQty);
  const iv           = alert.implied_volatility ? `${(parseFloat(alert.implied_volatility) * 100).toFixed(1)}%` : null;
  const delta        = alert.delta ? parseFloat(alert.delta).toFixed(2) : null;
  const uwScore      = alert.unusual_score ? parseFloat(alert.unusual_score) : null;

  const stopPrice = displayPrice * (1 - PROFILE_STOP[profile]);
  const tp1Price  = displayPrice * (1 + PROFILE_TP1[profile]);
  const tp2Pct    = PROFILE_TP2[profile];
  const tp2Price  = tp2Pct ? displayPrice * (1 + tp2Pct) : null;

  const handleSubmit = () => {
    if (parsedQty < 1 || !displayPrice) return;
    onSubmit({
      ticker:           alert.ticker,
      contract_type:    alert.contract_type,
      strike,
      expiry:           alert.expiry,
      qty:              parsedQty,
      entry_price:      displayPrice,
      strategy_profile: profile,
      mode:             isLive ? 'live' : 'paper',
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[s.header, { borderColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.text }]}>Enter Flow Trade</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {alert.is_sweep && (
              <View style={[s.tag, { backgroundColor: '#FF9F0A22', borderColor: '#FF9F0A44' }]}>
                <Text style={{ color: '#FF9F0A', fontSize: 10, fontWeight: '700' }}>SWEEP</Text>
              </View>
            )}
            {alert.is_floor && (
              <View style={[s.tag, { backgroundColor: '#5856D622', borderColor: '#5856D644' }]}>
                <Text style={{ color: '#5856D6', fontSize: 10, fontWeight: '700' }}>FLOOR</Text>
              </View>
            )}
          </View>
        </View>

        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {/* Contract summary */}
          <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={s.contractRow}>
              <Text style={[s.ticker, { color: colors.text }]}>{alert.ticker}</Text>
              <View style={[s.sidePill, { backgroundColor: sideColor + '22' }]}>
                <Text style={[s.sideLabel, { color: sideColor }]}>
                  {isCall ? '▲' : '▼'} {alert.contract_type.toUpperCase()}
                </Text>
              </View>
            </View>
            <Text style={[s.contractDetail, { color: colors.textSecondary }]}>
              ${strike.toFixed(0)} strike · expires {formatExpiry(alert.expiry)}
            </Text>

            {/* Flow stats */}
            <View style={s.statsRow}>
              <Stat label="Flow $" value={formatPremium(alert.premium)} accent colors={colors} />
              {iv    && <Stat label="IV"    value={iv}    colors={colors} />}
              {delta && <Stat label="Δ"     value={delta} colors={colors} />}
              {uwScore !== null && <Stat label="UW" value={uwScore.toFixed(0)} warn={uwScore > 70} colors={colors} />}
              <Stat label="Size" value={alert.size.toLocaleString()} colors={colors} />
            </View>

            {/* Ask / bid context */}
            <View style={[s.bidAskRow, { borderTopColor: colors.border }]}>
              <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
                Bid <Text style={{ color: colors.text, fontWeight: '600' }}>${parseFloat(alert.bid).toFixed(2)}</Text>
                {'  ·  '}
                Ask <Text style={{ color: colors.text, fontWeight: '600' }}>${parseFloat(alert.ask).toFixed(2)}</Text>
              </Text>
              <View style={[s.sideBadge, { backgroundColor: (alert.side === 'ask' ? colors.success : colors.error) + '22' }]}>
                <Text style={{ color: alert.side === 'ask' ? colors.success : colors.error, fontSize: 10, fontWeight: '700' }}>
                  {alert.side === 'ask' ? 'ASK — aggressive buy' : 'BID — aggressive sell'}
                </Text>
              </View>
            </View>
          </View>

          {/* Paper / Live toggle */}
          <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'row', alignItems: 'center' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, { color: colors.text }]}>{isLive ? 'Live Trade' : 'Paper Trade'}</Text>
              <Text style={[s.hint, { color: colors.textSecondary }]}>
                {isLive ? 'Places a real Alpaca order' : 'Simulated — no real money'}
              </Text>
            </View>
            <Switch
              value={isLive}
              onValueChange={setIsLive}
              trackColor={{ false: colors.border, true: sideColor + '66' }}
              thumbColor={isLive ? sideColor : colors.textTertiary}
            />
          </View>

          {/* Profile picker */}
          <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>EXIT PROFILE</Text>
          <View style={{ gap: 8, marginBottom: 20 }}>
            {PROFILES.map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setProfile(p)}
                style={[s.profileCard, { backgroundColor: colors.surface, borderColor: profile === p ? sideColor : colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.profileName, { color: colors.text }]}>{ZERO_DTE_PROFILE_LABELS[p]}</Text>
                  <Text style={[s.profileDesc, { color: colors.textSecondary }]}>{ZERO_DTE_PROFILE_DESCRIPTIONS[p]}</Text>
                </View>
                {profile === p && <Ionicons name="checkmark-circle" size={22} color={sideColor} />}
              </TouchableOpacity>
            ))}
          </View>

          {/* Order details */}
          <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>ORDER DETAILS</Text>
          <View style={[s.orderRow, { marginBottom: 20 }]}>
            {/* Qty stepper */}
            <View style={{ flex: 1 }}>
              <Text style={[s.inputLabel, { color: colors.textSecondary }]}>Contracts</Text>
              <View style={s.stepper}>
                <TouchableOpacity
                  onPress={() => setQty(String(Math.max(1, parsedQty - 1)))}
                  style={[s.stepBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Ionicons name="remove" size={18} color={colors.text} />
                </TouchableOpacity>
                <TextInput
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="number-pad"
                  style={[s.stepInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                />
                <TouchableOpacity
                  onPress={() => setQty(String(Math.min(20, parsedQty + 1)))}
                  style={[s.stepBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Ionicons name="add" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Entry price */}
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[s.inputLabel, { color: colors.textSecondary }]}>Entry Price</Text>
              <TextInput
                value={entryPrice}
                onChangeText={setEntryPrice}
                keyboardType="decimal-pad"
                placeholder={askPrice.toFixed(2)}
                placeholderTextColor={colors.textTertiary}
                style={[s.textInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
              />
            </View>
          </View>

          {/* TP/SL levels preview */}
          <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 24 }]}>
            <Text style={[s.sectionLabel, { color: colors.textSecondary, marginBottom: 10 }]}>
              LEVELS PREVIEW · {parsedQty} contract{parsedQty > 1 ? 's' : ''} · {estimatedCost} cost
            </Text>
            <LevelRow label="Stop loss" price={stopPrice} change={-PROFILE_STOP[profile] * 100} color="#EF4444" qty={parsedQty} entry={displayPrice} isLoss colors={colors} />
            <LevelRow label="Target 1"  price={tp1Price}  change={PROFILE_TP1[profile] * 100}   color="#10B981" qty={parsedQty} entry={displayPrice} colors={colors} />
            {tp2Price && tp2Pct && (
              <LevelRow label="Target 2" price={tp2Price} change={tp2Pct * 100} color="#F59E0B" qty={parsedQty} entry={displayPrice} colors={colors} />
            )}
          </View>

          {/* Submit */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={isLoading}
            style={[s.submitBtn, { backgroundColor: isLoading ? colors.border : sideColor }]}
          >
            <Text style={s.submitLabel}>
              {isLoading
                ? 'Entering...'
                : `${isLive ? 'Place' : 'Paper'} ${alert.contract_type.toUpperCase()} — ${estimatedCost}`}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Stat({ label, value, accent, warn, colors }: {
  label: string; value: string; accent?: boolean; warn?: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const color = warn ? '#8B5CF6' : accent ? colors.accent : colors.text;
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color, fontSize: 13, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 10, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

function LevelRow({ label, price, change, color, qty, entry, isLoss, colors }: {
  label: string; price: number; change: number; color: string;
  qty: number; entry: number; isLoss?: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const pnl = (price - entry) * 100 * qty;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 10 }} />
      <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', marginRight: 8 }}>
        ${price.toFixed(2)}
      </Text>
      <Text style={{ color, fontSize: 12, fontWeight: '600', minWidth: 52, textAlign: 'right' }}>
        {isLoss ? '-' : '+'}{Math.abs(change).toFixed(0)}% ({isLoss ? '-' : '+'}{Math.abs(pnl).toFixed(0)})
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:          { flex: 1 },
  header:        { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  headerTitle:   { fontSize: 17, fontWeight: '700', flex: 1 },
  tag:           { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  scroll:        { padding: 16 },
  card:          { borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1 },
  contractRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
  ticker:        { fontSize: 20, fontWeight: '800' },
  sidePill:      { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 2 },
  sideLabel:     { fontSize: 12, fontWeight: '700' },
  contractDetail:{ fontSize: 12, marginBottom: 12 },
  statsRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  bidAskRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 8 },
  sideBadge:     { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  label:         { fontSize: 14, fontWeight: '600' },
  hint:          { fontSize: 12, marginTop: 2 },
  sectionLabel:  { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  profileCard:   { borderRadius: 12, padding: 14, borderWidth: 2, flexDirection: 'row', alignItems: 'center' },
  profileName:   { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  profileDesc:   { fontSize: 12 },
  orderRow:      { flexDirection: 'row' },
  inputLabel:    { fontSize: 12, marginBottom: 6 },
  stepper:       { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn:       { width: 38, height: 44, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepInput:     { flex: 1, height: 44, borderRadius: 8, borderWidth: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  textInput:     { height: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 16 },
  submitBtn:     { borderRadius: 12, padding: 16, alignItems: 'center' },
  submitLabel:   { color: '#fff', fontSize: 16, fontWeight: '700' },
});
