import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/common/components/ui/Toast';
import { useImmediateTradeByTicker, StreamUnavailableError } from '@/hooks/mutations/strategy/useImmediateTradeByTicker';
import { useImmediatePositions } from '@/hooks/queries/strategy/useImmediatePositions';
import {
  IMMEDIATE_PROFILES, DEFAULT_PROFILE_INDEX, defaultQtyFor,
  getCheapContractAutoGraceMinutes, ProfileDropdown, ManualSLPicker,
} from '@/common/components/strategy/ImmediateProfilePicker';
import { StopTypeSelector, type StopType } from '@/common/components/strategy/StopTypeSelector';
import { EntrySafetySelector, BE_GRACE_DEFAULT, effectiveFloorPct } from '@/common/components/trade/EntrySafetySelector';
import { BlindEntryModal } from '@/common/components/strategy/BlindEntryModal';
import { formatContractSymbol } from '@/lib/formatContract';
import { useEntryCheck } from '@/hooks/queries/technicals/useEntryCheck';
import { EntryTechnicalsPanel } from '@/common/components/trade/EntryTechnicalsPanel';
import { PositioningRow } from '@/common/components/trade/PositioningRow';
import { GatedBuyButton } from '@/common/components/trade/GatedBuyButton';
import { AccountModeBanner, AccountModeTint } from '@/common/components/trade/AccountModeBanner';
import { OrderReviewSheet, type ReviewOrder } from '@/common/components/trade/OrderReviewSheet';
import type { SocialSignalContract } from '@/common/types/social';
import type { ImmediateTradeByTickerRequest } from '@/common/types/strategy';

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
  const [qty, setQty] = useState(defaultQtyFor(IMMEDIATE_PROFILES[DEFAULT_PROFILE_INDEX], 0));
  const [stopType, setStopType] = useState<StopType>(5);
  // Floor + breakeven grace chosen at entry (sent with the order).
  const [floorPct, setFloorPct] = useState<number | null>(null);
  const [beGrace, setBeGrace] = useState<number>(BE_GRACE_DEFAULT);
  const [volumeExit, setVolumeExit] = useState(false);
  const [manualSlPct, setManualSlPct] = useState(30);

  // Technicals gate + Review step — same as TradeContractSheet.
  const entryCheck = useEntryCheck(contract?.ticker, contract?.option_type ?? 'CALL', visible && !!contract);
  const [overridden, setOverridden] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { mutate: submit, isPending } = useImmediateTradeByTicker();
  // Overtrading guard — see TradeContractSheet's identical comment.
  const { data: openPositions } = useImmediatePositions();
  const openLiveCount = (openPositions ?? []).filter(p => p.paper_mode === false).length;

  // Blind Entry — set when the backend couldn't verify a live stream tick
  // within 8s (status: 'stream_unavailable'). See BlindEntryModal.
  const [blindEntry, setBlindEntry] = useState<{
    body: ImmediateTradeByTickerRequest;
    lastPrice: number;
  } | null>(null);

  const askPrice = livePrice ?? contract?.current_price ?? contract?.tracked_entry_price ?? 0;
  const autoGraceMinutes = contract ? getCheapContractAutoGraceMinutes(askPrice) : null;

  // Auto-suggest the grace stop-type for a cheap signal contract, mirroring
  // the other two entry sheets — this one previously had no auto-detect at
  // all, since SocialSignalContract has no `.ask` field to key off directly.
  useEffect(() => {
    if (!contract) return;
    setStopType(getCheapContractAutoGraceMinutes(askPrice) ?? 'HARD');
    setBlindEntry(null);
    setOverridden(false);
    setReviewOpen(false);
    setSuccessMessage(null);
    // Entry-safety choices are per-contract — a new sheet must not inherit
    // the previous trade's floor/grace.
    setFloorPct(null);
    setBeGrace(BE_GRACE_DEFAULT);
  // Only re-run when a different contract is opened, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract?.contract_symbol]);

  if (!contract) return null;

  const profile = IMMEDIATE_PROFILES[profileIndex];
  const isManual = profile.isManual === true;
  const isNoStopLoss = profile.isNoStopLoss === true;

  const handleProfileSelect = (idx: number) => {
    setProfileIndex(idx);
    setQty(defaultQtyFor(IMMEDIATE_PROFILES[idx], askPrice));
  };

  // Shared by the initial submit and the Blind Entry "Enter Anyway" retry.
  const runSubmit = (body: ImmediateTradeByTickerRequest) => {
    submit(body, {
      onSuccess: (r) => {
        setBlindEntry(null);
        // See TradeContractSheet — animate on the Review sheet when it's open.
        if (reviewOpen) {
          setSuccessMessage(r.message || 'Trade submitted');
          return;
        }
        toast.success(r.message || 'Trade submitted');
        onClose();
      },
      onError: (e) => {
        if (e instanceof StreamUnavailableError) {
          setReviewOpen(false);
          setBlindEntry({ body, lastPrice: e.payload.last_price ?? 0 });
          return;
        }
        toast.error(e.message || 'Trade failed');
        setBlindEntry(null);
      },
    });
  };

  // Shared by doSubmit and the opt-in enterBlind below — see
  // TradeContractSheet's buildTradeBody for the same split and why.
  const buildTradeBody = (): ImmediateTradeByTickerRequest => ({
    ticker: contract.ticker,
    direction: contract.option_type,
    contract_symbol: contract.contract_symbol,
    qty,
    profile: profile.key,
    paper_mode: paperMode,
    volume_exit: (isManual || isNoStopLoss) ? false : volumeExit,
    sl_grace_minutes: (isNoStopLoss || stopType === 'HARD') ? null : stopType,
    ...(!isNoStopLoss && floorPct != null ? { sl_outer_floor_pct: floorPct } : {}),
    be_grace_seconds: beGrace,
    ...(isManual ? { max_loss_pct: manualSlPct / 100 } : {}),
  });

  const doSubmit = () => runSubmit(buildTradeBody());

  // Opted into upfront from the Review sheet's "Skip live price check" —
  // see OrderReviewSheet's onEnterBlind doc comment.
  const enterBlind = () => runSubmit({ ...buildTradeBody(), bypass_stream_check: true });

  // Review sheet warnings — replace the old LIVE Alert confirm.
  const reviewWarnings = [
    ...(isNoStopLoss ? ['No automatic stop loss, including end of day.'] : []),
    ...(!paperMode && openLiveCount > 0 ? [`You already have ${openLiveCount} other live position${openLiveCount > 1 ? 's' : ''} open.`] : []),
  ];
  const stopPct = isNoStopLoss ? null : isManual ? manualSlPct / 100 : profile.maxLoss / 100;
  // See TradeContractSheet's isZeroDteContract — same rough client-side
  // check, purely to decide whether to show the option.
  const isZeroDteContract = contract.expiration_date?.slice(0, 10) === new Date().toISOString().slice(0, 10);
  const reviewOrder: ReviewOrder = {
    ticker: contract.ticker,
    optionType: contract.option_type,
    strike: contract.strike,
    expiration: contract.expiration_date,
    premium: askPrice,
    qty,
    profileLabel: `${profile.emoji} ${profile.name}`,
    stopPrice: stopPct == null ? null : askPrice * (1 - stopPct),
    stopLabel: stopPct == null ? 'Off' : stopType === 'HARD' ? 'Hard stop' : `${stopType}-min SL timer`,
    tp1Price: !isManual && !isNoStopLoss && profile.tp1 > 0 ? askPrice * (1 + profile.tp1 / 100) : null,
    tp2Price: !isManual && !isNoStopLoss && profile.tp2 > 0 ? askPrice * (1 + profile.tp2 / 100) : null,
    floorPrice: (() => { const f = stopPct == null ? null : effectiveFloorPct(floorPct, stopType !== 'HARD'); return f == null ? null : askPrice * (1 - f); })(),
    floorIsDefault: floorPct == null,
    beGraceSeconds: !isManual && !isNoStopLoss ? beGrace : 0,
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AccountModeTint paperMode={paperMode} colors={colors} />
      <SafeAreaView style={{ flex: 1 }}>
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
        <AccountModeBanner paperMode={paperMode} colors={colors} />

        <ScrollView contentContainerStyle={styles.body}>
          {/* Pricing */}
          <View style={[styles.priceRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.priceLabel, { color: colors.tabBarInactive }]}>Strike · Exp</Text>
              <Text style={[styles.priceValue, { color: colors.text }]}>${contract.strike} · {contract.expiration_date}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.priceLabel, { color: colors.tabBarInactive }]}>Cost × {qty}</Text>
              <Text style={[styles.priceValue, { color: colors.text }]}>{askPrice > 0 ? `$${(qty * askPrice * 100).toFixed(0)}` : '—'}</Text>
            </View>
          </View>

          {/* Technicals gate — above the account/profile controls */}
          <View style={{ marginTop: 12, marginBottom: 16 }}>
            <EntryTechnicalsPanel
              data={entryCheck.data}
              isLoading={entryCheck.isLoading}
              error={entryCheck.error}
              direction={contract.option_type}
              colors={colors}
            />
            <PositioningRow ticker={contract.ticker} direction={contract.option_type} expiry={contract.expiration_date} colors={colors} />
          </View>

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

          {/* Exit controls — hidden for NO_STOP_LOSS (no automatic exit to configure) */}
          {!isNoStopLoss && (
            <View style={{ marginTop: 16 }}>
              <Text style={[styles.footerLabel, { color: colors.tabBarInactive }]}>EXIT CONTROLS</Text>
              <StopTypeSelector value={stopType} onChange={setStopType} colors={colors} autoSuggested={autoGraceMinutes} />
              <View style={{ marginTop: 14 }}>
                <EntrySafetySelector colors={colors} floorPct={floorPct} onFloorPct={setFloorPct}
                  beGrace={beGrace} onBeGrace={setBeGrace} premium={askPrice} stopIsTimer={stopType !== 'HARD'} />
              </View>
              {!isManual && (
              <View style={[styles.exitToggles, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 10 }]}>
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
              )}
            </View>
          )}

        </ScrollView>

        {/* Sticky footer — see TradeContractSheet */}
        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <GatedBuyButton
            check={entryCheck.data}
            checkLoading={entryCheck.isLoading}
            paperMode={paperMode}
            label={`Buy ${qty} ${contract.option_type} · ${profile.emoji} ${profile.name}${isManual ? ` · SL −${manualSlPct}%` : ''}`}
            onReview={() => setReviewOpen(true)}
            overridden={overridden}
            onOverride={setOverridden}
            colors={colors}
          />
        </View>
      </SafeAreaView>

      <OrderReviewSheet
        visible={reviewOpen}
        order={reviewOrder}
        paperMode={paperMode}
        check={entryCheck.data}
        overridden={overridden}
        warnings={reviewWarnings}
        isSubmitting={isPending}
        onSubmit={doSubmit}
        onEnterBlind={isZeroDteContract ? enterBlind : undefined}
        onCancel={() => setReviewOpen(false)}
        successMessage={successMessage}
        onSuccessDone={() => { setSuccessMessage(null); setReviewOpen(false); onClose(); }}
        colors={colors}
      />
      </View>

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
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  headerSub: { fontSize: 12, marginTop: 1 },
  headerPrice: { fontSize: 16, fontWeight: '700' },
  body: { padding: 20, paddingBottom: 24 },

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

  priceRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, padding: 14 },
  priceLabel: { fontSize: 11 },
  priceValue: { fontSize: 15, fontWeight: '700', marginTop: 2 },

  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, borderTopWidth: StyleSheet.hairlineWidth },
});
