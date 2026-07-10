import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from '@/common/components/ui/Toast';
import { useImmediateTradeByTicker } from '@/hooks/mutations/strategy/useImmediateTradeByTicker';
import {
  IMMEDIATE_PROFILES, DEFAULT_PROFILE_INDEX,
  getOtmAutoProfileIndex, ProfileDropdown, ManualSLPicker,
} from '@/common/components/strategy/ImmediateProfilePicker';
import type { OptionsContract } from '@/common/types/blogPosts/ticker';

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: any;
  ticker: string;
  contract: OptionsContract | null;
  /** Underlying price at the time the contract was looked up — drives OTM auto-profile selection. */
  currentPrice: number;
}

/**
 * Trade-entry sheet for a contract already chosen via the Contracts tab (as
 * opposed to ImmediateTradePanel, which browses a chain first). Reuses the
 * exact same profile/SL pickers and submission path as Home's Trade flow so
 * behavior is identical regardless of where the contract was found.
 */
export function TradeContractSheet({ visible, onClose, colors, ticker, contract, currentPrice }: Props) {
  const toast = useToast();
  const [paperMode, setPaperMode]       = useState(true);
  const [profileIndex, setProfileIndex] = useState(DEFAULT_PROFILE_INDEX);
  const [qty, setQty]                   = useState(IMMEDIATE_PROFILES[DEFAULT_PROFILE_INDEX].qty);
  const [consolExit, setConsolExit]     = useState(false);
  const [volumeExit, setVolumeExit]     = useState(false);
  const [manualSlPct, setManualSlPct]   = useState(30);

  const profile  = IMMEDIATE_PROFILES[profileIndex];
  const isManual = profile.isManual === true;

  const { mutate: submit, isPending } = useImmediateTradeByTicker();

  // Reset to defaults + auto-pick an OTM profile for a cheap OTM contract
  // every time a new contract is opened, mirroring ImmediateTradePanel.
  useEffect(() => {
    if (!visible || !contract) return;
    const otmIdx = getOtmAutoProfileIndex(contract, currentPrice);
    const idx = otmIdx ?? DEFAULT_PROFILE_INDEX;
    setProfileIndex(idx);
    setQty(IMMEDIATE_PROFILES[idx].qty);
    setConsolExit(false);
    setVolumeExit(false);
    setManualSlPct(30);
    setPaperMode(true);
  // Only re-run when a different contract is opened, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, contract?.symbol]);

  const handleProfileSelect = (idx: number) => {
    setProfileIndex(idx);
    setQty(IMMEDIATE_PROFILES[idx].qty);
  };

  const doSubmit = () => {
    if (!contract) return;
    submit(
      {
        ticker,
        direction:       contract.option_type,
        contract_symbol: contract.symbol,
        qty,
        profile:         profile.key,
        paper_mode:      paperMode,
        consol_exit:     isManual ? false : consolExit,
        volume_exit:     isManual ? false : volumeExit,
        ...(isManual ? { max_loss_pct: manualSlPct / 100 } : {}),
      },
      {
        onSuccess: (r) => { toast.success(r.message || `${ticker} entered`); onClose(); },
        onError:   (e) => toast.error(e.message || 'Trade failed'),
      },
    );
  };

  const handleSubmitPress = () => {
    if (paperMode) { doSubmit(); return; }
    Alert.alert(
      'Trade LIVE',
      `Enter ${contract?.option_type} ${contract?.symbol} × ${qty} with REAL money now?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Trade', style: 'destructive', onPress: doSubmit },
      ],
    );
  };

  if (!contract) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[s.header, { borderBottomColor: colors.separator ?? colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: colors.text }]}>Trade {ticker}</Text>
            <Text style={[s.subhead, { color: colors.textSecondary ?? colors.tabBarInactive }]} numberOfLines={1}>
              {contract.symbol} · ${contract.ask.toFixed(2)} ask
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={[s.closeBtn, { backgroundColor: colors.surface ?? colors.card, borderColor: colors.border }]}>
            <Ionicons name="close" size={18} color={colors.textSecondary ?? colors.tabBarInactive} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {/* Account */}
          <Text style={[s.label, { color: colors.tabBarInactive }]}>ACCOUNT</Text>
          <View style={[s.accountToggle, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 18 }]}>
            {([['Paper', true], ['Live', false]] as const).map(([lbl, isPaper]) => {
              const active = paperMode === isPaper;
              const tint = isPaper ? '#FF9F0A' : colors.error;
              return (
                <TouchableOpacity
                  key={lbl}
                  onPress={() => setPaperMode(isPaper)}
                  activeOpacity={0.8}
                  style={[s.accountBtn, active && { backgroundColor: tint + '22', borderRadius: 8 }]}
                >
                  <Text style={[s.accountText, { color: active ? tint : colors.tabBarInactive, fontWeight: active ? '700' : '500' }]}>
                    {lbl}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Profile */}
          <Text style={[s.label, { color: colors.tabBarInactive }]}>PROFILE</Text>
          <View style={{ marginBottom: 18 }}>
            <ProfileDropdown selectedIndex={profileIndex} onSelect={handleProfileSelect} colors={colors} />
          </View>

          {/* Manual SL — only for MANUAL profile */}
          {isManual && (
            <View style={{ marginBottom: 18 }}>
              <ManualSLPicker slPct={manualSlPct} onChangePct={setManualSlPct} askPrice={contract.ask} colors={colors} />
            </View>
          )}

          {/* Qty */}
          <Text style={[s.label, { color: colors.tabBarInactive }]}>CONTRACTS</Text>
          <View style={[s.qtyRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setQty(q => Math.max(1, q - 1))}
              style={[s.qtyBtn, { borderColor: colors.border }]}
              hitSlop={8}
            >
              <Ionicons name="remove" size={18} color={colors.text} />
            </TouchableOpacity>
            <Text style={[s.qtyValue, { color: colors.text }]}>{qty}</Text>
            <TouchableOpacity
              onPress={() => setQty(q => Math.min(50, q + 1))}
              style={[s.qtyBtn, { borderColor: colors.border }]}
              hitSlop={8}
            >
              <Ionicons name="add" size={18} color={colors.text} />
            </TouchableOpacity>
            <Text style={[s.qtyCost, { color: colors.tabBarInactive }]}>
              ≈ ${(qty * contract.ask * 100).toFixed(0)}
            </Text>
          </View>

          {/* Exit toggles — hidden for MANUAL, which only has the SL above */}
          {!isManual && (
            <>
              <Text style={[s.label, { color: colors.tabBarInactive, marginTop: 18 }]}>EXTRA EXITS</Text>
              <View style={[s.exitToggles, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[s.exitRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                  <Text style={[s.exitLabel, { color: colors.text }]}>Consolidation Exit</Text>
                  <TouchableOpacity onPress={() => setConsolExit(v => !v)} hitSlop={8}>
                    <Ionicons
                      name={consolExit ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={consolExit ? colors.accent : colors.tabBarInactive}
                    />
                  </TouchableOpacity>
                </View>
                <View style={s.exitRow}>
                  <Text style={[s.exitLabel, { color: colors.text }]}>Volume Exit</Text>
                  <TouchableOpacity onPress={() => setVolumeExit(v => !v)} hitSlop={8}>
                    <Ionicons
                      name={volumeExit ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={volumeExit ? colors.accent : colors.tabBarInactive}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}

          <TouchableOpacity
            onPress={handleSubmitPress}
            disabled={isPending}
            activeOpacity={0.85}
            style={[s.submitBtn, { backgroundColor: isPending ? colors.border : (paperMode ? colors.accent : colors.error), marginTop: 22 }]}
          >
            {isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="flash" size={18} color="#fff" />
                <Text style={s.submitText}>
                  {paperMode ? '' : 'LIVE '}Enter {contract.option_type} × {qty}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title:       { fontSize: 18, fontWeight: '700' },
  subhead:     { fontSize: 13, marginTop: 1 },
  closeBtn:    { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  label:       { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },

  accountToggle: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3 },
  accountBtn:    { flex: 1, alignItems: 'center', paddingVertical: 9 },
  accountText:   { fontSize: 13 },

  qtyRow:      { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 12, borderWidth: 1, padding: 12 },
  qtyBtn:      { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyValue:    { fontSize: 18, fontWeight: '700', minWidth: 24, textAlign: 'center' },
  qtyCost:     { marginLeft: 'auto', fontSize: 12, fontWeight: '600' },

  exitToggles: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  exitRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  exitLabel:   { fontSize: 14, fontWeight: '500' },

  submitBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 12 },
  submitText:  { color: '#fff', fontSize: 15, fontWeight: '700' },
});
