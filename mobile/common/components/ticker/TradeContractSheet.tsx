import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Modal,
  Animated, Easing, Pressable, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from '@/common/components/ui/Toast';
import { useImmediateTradeByTicker, StreamUnavailableError } from '@/hooks/mutations/strategy/useImmediateTradeByTicker';
import {
  IMMEDIATE_PROFILES, DEFAULT_PROFILE_INDEX,
  getCheapContractAutoGraceMinutes, ProfileDropdown, ManualSLPicker,
} from '@/common/components/strategy/ImmediateProfilePicker';
import { StopTypeSelector, type StopType } from '@/common/components/strategy/StopTypeSelector';
import { BlindEntryModal } from '@/common/components/strategy/BlindEntryModal';
import type { OptionsContract } from '@/common/types/blogPosts/ticker';
import type { ImmediateTradeByTickerRequest } from '@/common/types/strategy';

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: any;
  ticker: string;
  contract: OptionsContract | null;
  /** Underlying price at the time the contract was looked up (unused by the
   *  cheap-contract auto-profile check itself, kept for signature stability). */
  currentPrice: number;
}

/**
 * The actual form — account toggle, profile, qty, exit controls, submit —
 * shared by both TradeContractSheet (a full native Modal, used from the
 * Contracts tab / contract detail modal) and TradeContractQuickCard (an
 * inline animated overlay, used from AgentModal so the AI Assistant chat
 * never has to close to enter a trade). Neither wrapper duplicates any of
 * this logic — only how it's presented differs.
 */
function TradeContractForm({ visible, onClose, colors, ticker, contract, currentPrice }: Omit<Props, 'contract'> & { contract: OptionsContract }) {
  const toast = useToast();
  const [paperMode, setPaperMode]       = useState(true);
  const [profileIndex, setProfileIndex] = useState(DEFAULT_PROFILE_INDEX);
  const [qty, setQty]                   = useState(IMMEDIATE_PROFILES[DEFAULT_PROFILE_INDEX].qty);
  const [stopType, setStopType]         = useState<StopType>('HARD');
  const [volumeExit, setVolumeExit]     = useState(false);
  const [manualSlPct, setManualSlPct]   = useState(30);

  const profile      = IMMEDIATE_PROFILES[profileIndex];
  const isManual     = profile.isManual === true;
  const isNoStopLoss = profile.isNoStopLoss === true;

  const { mutate: submit, isPending } = useImmediateTradeByTicker();

  // Blind Entry — set when the backend couldn't verify a live stream tick
  // within 8s (status: 'stream_unavailable'). See BlindEntryModal.
  const [blindEntry, setBlindEntry] = useState<{
    body: ImmediateTradeByTickerRequest;
    lastPrice: number;
  } | null>(null);

  // Reset to defaults + auto-suggest a grace stop-type for any sub-$0.50
  // contract every time a new contract is opened, mirroring ImmediateTradePanel.
  const autoGraceMinutes = contract ? getCheapContractAutoGraceMinutes(contract.ask) : null;
  useEffect(() => {
    if (!visible || !contract) return;
    setProfileIndex(DEFAULT_PROFILE_INDEX);
    setQty(IMMEDIATE_PROFILES[DEFAULT_PROFILE_INDEX].qty);
    setStopType(getCheapContractAutoGraceMinutes(contract.ask) ?? 'HARD');
    setVolumeExit(false);
    setManualSlPct(30);
    setPaperMode(true);
    setBlindEntry(null);
  // Only re-run when a different contract is opened, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, contract?.symbol]);

  const handleProfileSelect = (idx: number) => {
    setProfileIndex(idx);
    setQty(IMMEDIATE_PROFILES[idx].qty);
  };

  // Shared by the initial submit and the Blind Entry "Enter Anyway" retry.
  const runSubmit = (body: ImmediateTradeByTickerRequest) => {
    submit(body, {
      onSuccess: (r) => {
        toast.success(r.message || `${ticker} entered`);
        setBlindEntry(null);
        onClose();
      },
      onError: (e) => {
        if (e instanceof StreamUnavailableError) {
          setBlindEntry({ body, lastPrice: e.payload.last_price ?? 0 });
          return;
        }
        toast.error(e.message || 'Trade failed');
        setBlindEntry(null);
      },
    });
  };

  const doSubmit = () => {
    if (!contract) return;
    runSubmit({
      ticker,
      direction:       contract.option_type,
      contract_symbol: contract.symbol,
      qty,
      profile:         profile.key,
      paper_mode:      paperMode,
      volume_exit:     (isManual || isNoStopLoss) ? false : volumeExit,
      sl_grace_minutes: (isNoStopLoss || stopType === 'HARD') ? null : stopType,
      ...(isManual ? { max_loss_pct: manualSlPct / 100 } : {}),
    });
  };

  const handleSubmitPress = () => {
    if (isNoStopLoss) {
      Alert.alert(
        `${profile.emoji} No Stop Loss`,
        `Enter ${contract?.option_type} ${contract?.symbol} × ${qty}?\n\n⚠️ This will NOT auto-close for any reason, including end of day — it expires today (0DTE) if you don't sell it.${!paperMode ? '\n\nThis is a LIVE order with REAL money.' : ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Trade', style: paperMode ? 'default' : 'destructive', onPress: doSubmit },
        ],
      );
      return;
    }
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

  return (
    <>
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
          <Text style={[s.label, { color: colors.tabBarInactive }]}>
            CONTRACTS{isNoStopLoss ? ' — no stop loss, size carefully' : ''}
          </Text>
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

          {/* Exit Controls — hidden for NO_STOP_LOSS (no automatic exit to configure) */}
          {!isNoStopLoss && (
            <>
              <Text style={[s.label, { color: colors.tabBarInactive, marginTop: 18 }]}>EXIT CONTROLS</Text>
              <StopTypeSelector value={stopType} onChange={setStopType} colors={colors} autoSuggested={autoGraceMinutes} />
              {!isManual && (
                <View style={[s.exitToggles, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 10 }]}>
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
              )}
            </>
          )}

          <TouchableOpacity
            onPress={handleSubmitPress}
            disabled={isPending}
            activeOpacity={0.85}
            style={[s.submitBtn, { backgroundColor: isPending ? colors.border : (paperMode ? colors.accent : colors.error), marginTop: 22 }]}
          >
            {isPending ? (
              <ActivityIndicator color={colors.textSecondary} />
            ) : (
              <>
                {/* colors.accent flips light/dark between themes — the fixed
                    white here only stayed contrast-safe on the live (colors.error)
                    branch, which is why paperMode gets accentForeground instead. */}
                <Ionicons name="flash" size={18} color={paperMode ? colors.accentForeground : '#fff'} />
                <Text style={[s.submitText, { color: paperMode ? colors.accentForeground : '#fff' }]}>
                  {paperMode ? '' : 'LIVE '}Enter {contract.option_type} × {qty}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>

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
          onSkip={() => setBlindEntry(null)}
        />
      )}
    </>
  );
}

/**
 * Trade-entry sheet for a contract already chosen via the Contracts tab (as
 * opposed to ImmediateTradePanel, which browses a chain first). Reuses the
 * exact same profile/SL pickers and submission path as Home's Trade flow so
 * behavior is identical regardless of where the contract was found.
 */
export function TradeContractSheet({ visible, onClose, colors, ticker, contract, currentPrice }: Props) {
  if (!contract) return null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <TradeContractForm
        visible={visible} onClose={onClose} colors={colors}
        ticker={ticker} contract={contract} currentPrice={currentPrice}
      />
    </Modal>
  );
}

const SCREEN_H = Dimensions.get('window').height;

/**
 * Non-blocking inline variant of TradeContractSheet — same form, same
 * submission path, but rendered as an animated bottom-sheet overlay INSIDE
 * the caller's own view tree instead of a second native Modal. RN can only
 * reliably present one native Modal at a time (see AgentModal's
 * handleTradeContract history — closing the first, waiting out its dismiss
 * animation, then presenting the second), which meant entering a contract
 * from the AI Assistant's checklist used to close the assistant's own Modal
 * first — losing its (unsaved, image-free) conversation state and adding a
 * close/reopen animation. This exists so that flow can overlay AgentModal
 * instead: AgentModal never closes, so there's nothing to lose and nothing
 * to animate back open.
 */
export function TradeContractQuickCard({ visible, onClose, colors, ticker, contract, currentPrice }: Props) {
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // Kept mounted through the close animation (visible flips to false first,
  // then this flips false once the slide-down finishes) — an immediate
  // unmount on visible=false would cut the close animation off mid-flight.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SCREEN_H, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [visible]);

  if (!mounted || !contract) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, qs.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          qs.sheet,
          { backgroundColor: colors.background, borderColor: colors.border, transform: [{ translateY }] },
        ]}
      >
        <View style={[qs.grabber, { backgroundColor: colors.border }]} />
        <TradeContractForm
          visible={visible} onClose={onClose} colors={colors}
          ticker={ticker} contract={contract} currentPrice={currentPrice}
        />
      </Animated.View>
    </View>
  );
}

const qs = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '88%', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderBottomWidth: 0, overflow: 'hidden',
  },
  grabber: {
    width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 8, marginBottom: 2,
  },
});

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
  submitText:  { fontSize: 15, fontWeight: '700' },
});
