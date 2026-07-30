import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, SafeAreaView, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useImmediateTradeByTicker } from '@/hooks/mutations/strategy/useImmediateTradeByTicker';
import {
  IMMEDIATE_PROFILES, DEFAULT_PROFILE_INDEX,
  ProfileDropdown, ManualSLPicker,
} from '@/common/components/strategy/ImmediateProfilePicker';
import { formatContractSymbol } from '@/lib/formatContract';
import type { SocialSignalContract } from '@/common/types/social';

interface Props {
  contract: SocialSignalContract | null;
  livePrice?: number;
  colors: any;
  visible: boolean;
  onClose: () => void;
}

/**
 * "Enter" flow for a signal card — the contract is already known (it's the
 * exact one detected from the tweet), so unlike ImmediateTradePanel this
 * skips the options-chain browser entirely and goes straight to the
 * exit-profile footer, reusing the same picker pieces and the same
 * /strategy/immediate-trade order path.
 */
export function SignalEnterSheet({ contract, livePrice, colors, visible, onClose }: Props) {
  const toast = useToast();
  const [paperMode, setPaperMode] = useState(true);
  const [profileIndex, setProfileIndex] = useState(DEFAULT_PROFILE_INDEX);
  const [qty, setQty] = useState(IMMEDIATE_PROFILES[DEFAULT_PROFILE_INDEX].qty);
  const [volumeExit, setVolumeExit] = useState(false);
  const [manualSlPct, setManualSlPct] = useState(30);

  const { mutate: submit, isPending } = useImmediateTradeByTicker();

  if (!contract) return null;

  const profile = IMMEDIATE_PROFILES[profileIndex];
  const isManual = profile.isManual === true;
  const askPrice = livePrice ?? contract.current_price ?? contract.tracked_entry_price ?? 0;

  const handleProfileSelect = (idx: number) => {
    setProfileIndex(idx);
    setQty(IMMEDIATE_PROFILES[idx].qty);
  };

  const doSubmit = () => {
    submit(
      {
        ticker: contract.ticker,
        direction: contract.option_type,
        contract_symbol: contract.contract_symbol,
        qty,
        profile: profile.key,
        paper_mode: paperMode,
        volume_exit: isManual ? false : volumeExit,
        ...(isManual ? { max_loss_pct: manualSlPct / 100 } : {}),
      },
      {
        onSuccess: (r) => {
          toast.success(r.message || 'Trade submitted');
          onClose();
        },
        onError: (e) => {
          toast.error(e.message || 'Trade failed');
        },
      },
    );
  };

  const confirmSubmit = () => {
    if (!paperMode) {
      Alert.alert(
        'Submit LIVE Order',
        `This will buy ${qty} × ${contract.contract_symbol} with REAL money immediately.\n\nProfile: ${profile.emoji} ${profile.name}${isManual ? `\nStop Loss: −${manualSlPct}%` : ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit', style: 'destructive', onPress: doSubmit },
        ],
      );
    } else {
      doSubmit();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>{contract.ticker} · {contract.option_type}</Text>
            <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {formatContractSymbol(contract.contract_symbol)}
            </Text>
          </View>
          {askPrice > 0 && (
            <Text style={[styles.headerPrice, { color: colors.text }]}>${askPrice.toFixed(2)}</Text>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {/* Paper / Live */}
          <Text style={[styles.footerLabel, { color: colors.tabBarInactive }]}>ACCOUNT</Text>
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

          {/* Exit profile */}
          <Text style={[styles.footerLabel, { color: colors.tabBarInactive, marginTop: 16 }]}>EXIT PROFILE</Text>
          <ProfileDropdown selectedIndex={profileIndex} onSelect={handleProfileSelect} colors={colors} />

          {isManual && (
            <ManualSLPicker slPct={manualSlPct} onChangePct={setManualSlPct} askPrice={askPrice} colors={colors} />
          )}

          {/* Qty */}
          <View style={[styles.footerQtyRow, { marginTop: 16 }]}>
            <View>
              <Text style={[styles.footerLabel, { color: colors.tabBarInactive, marginBottom: 2 }]}>CONTRACTS</Text>
              <Text style={[styles.qtyHint, { color: colors.tabBarInactive }]}>Default for {profile.name}: {profile.qty}</Text>
            </View>
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

          {/* Exit controls */}
          {!isManual && (
            <View style={{ marginTop: 16 }}>
              <Text style={[styles.footerLabel, { color: colors.tabBarInactive }]}>EXIT CONTROLS</Text>
              <View style={[styles.exitToggles, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.exitToggleRow}>
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
            style={[styles.submitBtn, { backgroundColor: isPending ? colors.border : (paperMode ? colors.accent : colors.error) }]}
          >
            {isPending ? (
              <ActivityIndicator color={paperMode ? (colors.accentForeground ?? '#fff') : '#fff'} />
            ) : (
              <>
                <Ionicons name="flash" size={18} color={paperMode ? (colors.accentForeground ?? '#fff') : '#fff'} />
                <Text style={[styles.submitText, { color: paperMode ? (colors.accentForeground ?? '#fff') : '#fff' }]}>
                  {paperMode ? '' : 'LIVE '}Buy {qty} {contract.option_type} · {profile.emoji} {profile.name}
                  {isManual ? ` · SL −${manualSlPct}%` : ''}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  headerSub: { fontSize: 12, marginTop: 1 },
  headerPrice: { fontSize: 16, fontWeight: '700' },
  body: { padding: 20, paddingBottom: 60 },

  footerLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  accountToggle: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3 },
  accountBtn: { flex: 1, alignItems: 'center', paddingVertical: 9 },
  accountText: { fontSize: 14 },

  footerQtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qtyHint: { fontSize: 10 },
  qtyGroup: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  qtyBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { fontSize: 18, fontWeight: '700', minWidth: 28, textAlign: 'center' },

  exitToggles: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  exitToggleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  exitToggleLabel: { fontSize: 14, fontWeight: '500', marginBottom: 2 },
  exitToggleSub: { fontSize: 11 },
  togglePill: { width: 38, height: 24, borderRadius: 12, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 3 },
  toggleThumb: { width: 18, height: 18, borderRadius: 9 },

  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 12, marginTop: 24 },
  submitText: { fontSize: 15, fontWeight: '700' },
});
