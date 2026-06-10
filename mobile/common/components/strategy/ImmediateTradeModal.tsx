import React, { useState } from 'react';
import {
  View, Text, Modal, SafeAreaView, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useStrategyContracts } from '@/hooks/queries/strategy/useStrategyContracts';
import { useImmediateTrade } from '@/hooks/mutations/strategy/useImmediateTrade';
import type { StrategyConfig, ProfileKey, Contract0DTE } from '@/common/types/strategy';

interface Props {
  visible: boolean;
  config: StrategyConfig | null;
  colors: any;
  onClose: () => void;
}

const PROFILE_OPTIONS: { key: ProfileKey; label: string }[] = [
  { key: 'BULL_DOG',    label: '🐂 Bull Dog' },
  { key: 'THUNDER_CAT', label: '🐱 Thunder Cat' },
  { key: 'WOLF',        label: '🐺 Wolf' },
];

/**
 * Immediate / conviction trade: pick a direction + a live 0DTE contract and
 * submit a market order right now, skipping the breakout wait / sentiment / flow
 * filters. Exits are managed by the chosen profile.
 */
export function ImmediateTradeModal({ visible, config, colors, onClose }: Props) {
  const toast = useToast();
  const [direction, setDirection] = useState<'CALL' | 'PUT'>('CALL');
  const [profile, setProfile]     = useState<ProfileKey | null>(null);
  const [selected, setSelected]   = useState<string | null>(null);
  const [qty, setQty]             = useState(1);

  const activeProfile = profile ?? config?.profile ?? 'THUNDER_CAT';

  const { data, isLoading, isError } = useStrategyContracts(
    config?.id ?? null, direction, visible,
  );
  const { mutate: submit, isPending } = useImmediateTrade();

  const reset = () => { setSelected(null); setQty(1); setProfile(null); setDirection('CALL'); };
  const close = () => { reset(); onClose(); };

  const doSubmit = () => {
    if (!config || !selected) return;
    submit(
      { strategyId: config.id, direction, contract_symbol: selected, qty, profile: activeProfile },
      {
        onSuccess: (r) => { toast.success(r.message || 'Trade submitted'); close(); },
        onError:   (e) => toast.error(e.message || 'Trade failed'),
      },
    );
  };

  const confirmSubmit = () => {
    if (!config || !selected) {
      toast.error('Select a contract first');
      return;
    }
    if (!config.paper_mode) {
      Alert.alert(
        'Submit LIVE Order',
        `This will buy ${qty} × ${selected} with REAL money immediately.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit', style: 'destructive', onPress: doSubmit },
        ],
      );
    } else {
      doSubmit();
    }
  };

  const contracts = data?.contracts ?? [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={close} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.title, { color: colors.text }]}>⚡ Immediate Trade</Text>
            <Text style={[styles.subtitle, { color: colors.tabBarInactive }]}>
              {config?.ticker} · {config?.paper_mode ? 'Paper' : 'LIVE'}
              {data?.underlying != null ? ` · $${data.underlying.toFixed(2)}` : ''}
            </Text>
          </View>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* Direction */}
          <Text style={[styles.label, { color: colors.tabBarInactive }]}>DIRECTION</Text>
          <View style={styles.row}>
            {(['CALL', 'PUT'] as const).map(d => {
              const active = direction === d;
              const tint = d === 'CALL' ? colors.success : colors.error;
              return (
                <TouchableOpacity
                  key={d}
                  onPress={() => { setDirection(d); setSelected(null); }}
                  style={[styles.segment, { borderColor: active ? tint : colors.border, backgroundColor: active ? tint + '22' : colors.card }]}
                >
                  <Text style={[styles.segmentText, { color: active ? tint : colors.text }]}>{d}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Profile */}
          <Text style={[styles.label, { color: colors.tabBarInactive }]}>EXIT PROFILE</Text>
          <View style={styles.row}>
            {PROFILE_OPTIONS.map(p => {
              const active = activeProfile === p.key;
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

          {/* Quantity */}
          <Text style={[styles.label, { color: colors.tabBarInactive }]}>CONTRACTS</Text>
          <View style={styles.qtyRow}>
            <TouchableOpacity
              onPress={() => setQty(q => Math.max(1, q - 1))}
              style={[styles.qtyBtn, { borderColor: colors.border }]}
            >
              <Ionicons name="remove" size={20} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.qtyValue, { color: colors.text }]}>{qty}</Text>
            <TouchableOpacity
              onPress={() => setQty(q => q + 1)}
              style={[styles.qtyBtn, { borderColor: colors.border }]}
            >
              <Ionicons name="add" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Contract chain */}
          <Text style={[styles.label, { color: colors.tabBarInactive }]}>SELECT 0DTE CONTRACT</Text>
          {isLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
          ) : isError ? (
            <Text style={[styles.empty, { color: colors.error }]}>Failed to load contracts</Text>
          ) : contracts.length === 0 ? (
            <Text style={[styles.empty, { color: colors.tabBarInactive }]}>
              No 0DTE contracts available
            </Text>
          ) : (
            contracts.map(c => (
              <ContractRow
                key={c.symbol}
                contract={c}
                selected={selected === c.symbol}
                onSelect={() => setSelected(c.symbol)}
                colors={colors}
              />
            ))
          )}
          <View style={{ height: 24 }} />
        </ScrollView>

        {/* Submit */}
        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity
            onPress={confirmSubmit}
            disabled={!selected || isPending}
            style={[styles.submitBtn, { backgroundColor: !selected || isPending ? colors.border : colors.accent }]}
          >
            {isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>
                {selected ? `Buy ${qty} ${direction}` : 'Select a contract'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const ContractRow = ({ contract, selected, onSelect, colors }: {
  contract: Contract0DTE; selected: boolean; onSelect: () => void; colors: any;
}) => (
  <TouchableOpacity
    onPress={onSelect}
    style={[styles.contractRow, {
      backgroundColor: colors.card,
      borderColor: selected ? colors.accent : colors.border,
      borderWidth: selected ? 2 : 1,
    }]}
  >
    <View style={{ flex: 1 }}>
      <Text style={[styles.contractStrike, { color: colors.text }]}>${contract.strike}</Text>
      <Text style={[styles.contractMeta, { color: colors.tabBarInactive }]}>
        Δ {contract.delta ?? '—'} · OI {contract.oi ?? '—'}
      </Text>
    </View>
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={[styles.contractAsk, { color: colors.text }]}>${contract.ask.toFixed(2)}</Text>
      <Text style={[styles.contractMeta, { color: colors.tabBarInactive }]}>
        bid ${contract.bid.toFixed(2)}
      </Text>
    </View>
    {selected && <Ionicons name="checkmark-circle" size={20} color={colors.accent} style={{ marginLeft: 10 }} />}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container:   { flex: 1 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title:       { fontSize: 17, fontWeight: '700' },
  subtitle:    { fontSize: 12, marginTop: 2 },
  body:        { paddingHorizontal: 16, paddingTop: 12 },
  label:       { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginTop: 16, marginBottom: 8 },
  row:         { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  segment:     { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  segmentText: { fontSize: 15, fontWeight: '700' },
  chip:        { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  chipText:    { fontSize: 13, fontWeight: '600' },
  qtyRow:      { flexDirection: 'row', alignItems: 'center', gap: 20 },
  qtyBtn:      { width: 44, height: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyValue:    { fontSize: 20, fontWeight: '700', minWidth: 30, textAlign: 'center' },
  empty:       { textAlign: 'center', marginTop: 20, fontSize: 13 },
  contractRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, padding: 12, marginBottom: 8 },
  contractStrike: { fontSize: 16, fontWeight: '700' },
  contractAsk:    { fontSize: 16, fontWeight: '700' },
  contractMeta:   { fontSize: 11, marginTop: 2 },
  footer:      { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, borderTopWidth: StyleSheet.hairlineWidth },
  submitBtn:   { paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  submitText:  { color: '#fff', fontSize: 16, fontWeight: '700' },
});
