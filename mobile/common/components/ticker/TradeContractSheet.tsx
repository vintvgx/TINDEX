import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal,
  Animated, Easing, Pressable, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from '@/common/components/ui/Toast';
import { useImmediateTradeByTicker, StreamUnavailableError } from '@/hooks/mutations/strategy/useImmediateTradeByTicker';
import { useImmediatePositions } from '@/hooks/queries/strategy/useImmediatePositions';
import {
  IMMEDIATE_PROFILES, DEFAULT_PROFILE_INDEX, defaultQtyFor,
  getCheapContractAutoGraceMinutes, ProfileDropdown, ManualSLPicker,
} from '@/common/components/strategy/ImmediateProfilePicker';
import { StopTypeSelector, type StopType } from '@/common/components/strategy/StopTypeSelector';
import { BlindEntryModal } from '@/common/components/strategy/BlindEntryModal';
import { useEntryCheck } from '@/hooks/queries/technicals/useEntryCheck';
import { EntryTechnicalsPanel } from '@/common/components/trade/EntryTechnicalsPanel';
import { GreeksExpander } from '@/common/components/trade/GreeksExpander';
import { GatedBuyButton } from '@/common/components/trade/GatedBuyButton';
import { AccountModeBanner, AccountModeTint } from '@/common/components/trade/AccountModeBanner';
import { OrderReviewSheet, type ReviewOrder } from '@/common/components/trade/OrderReviewSheet';
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
  /** Contract PREMIUM (not underlying stock price) the source alert stated
   *  for entry/stop, when known (see FlowChecklistContract.entry_price/
   *  stop_loss). When both are present, the form pre-applies a stop that
   *  preserves the alert's entry-to-stop DIFFERENCE against whatever price
   *  the contract is actually entered at — rarely the exact alert price by
   *  the time it's acted on. E.g. alert entry $1.50 / stop $1.25 (a $0.25
   *  differential), entered here at $1.35 → stop set to $1.10, not $1.25. */
  alertEntryPrice?: number | null;
  alertStopLoss?: number | null;
}

/**
 * The actual form — pricing, technicals gate, account toggle, profile, qty,
 * exit controls, Review → swipe-to-submit —
 * shared by both TradeContractSheet (a full native Modal, used from the
 * Contracts tab / contract detail modal) and TradeContractQuickCard (an
 * inline animated overlay, used from AgentModal so the AI Assistant chat
 * never has to close to enter a trade). Neither wrapper duplicates any of
 * this logic — only how it's presented differs.
 */
function TradeContractForm({ visible, onClose, colors, ticker, contract, currentPrice, alertEntryPrice, alertStopLoss }: Omit<Props, 'contract'> & { contract: OptionsContract }) {
  const toast = useToast();
  const [paperMode, setPaperMode]       = useState(true);
  const [profileIndex, setProfileIndex] = useState(DEFAULT_PROFILE_INDEX);
  const [qty, setQty]                   = useState(defaultQtyFor(IMMEDIATE_PROFILES[DEFAULT_PROFILE_INDEX], contract.ask));
  const [stopType, setStopType]         = useState<StopType>(5);
  const [volumeExit, setVolumeExit]     = useState(false);
  const [manualSlPct, setManualSlPct]   = useState(30);
  // Defaults ON whenever the checklist's parsed contract had both an alert
  // entry and stop — user can still turn it off to fall back to the
  // profile's own default stop (or the manual slider, if MANUAL).
  const [useAlertStop, setUseAlertStop] = useState(true);
  // SL/TP enable — on by default for every profile; turning either off lets
  // a runner run its course (or hold into close) instead of auto-exiting.
  const [slEnabled, setSlEnabled] = useState(true);
  const [tpEnabled, setTpEnabled] = useState(true);

  const profile      = IMMEDIATE_PROFILES[profileIndex];
  const isManual     = profile.isManual === true;
  const isNoStopLoss = profile.isNoStopLoss === true;
  // No stop loss in effect — either from a (legacy) NO_STOP_LOSS profile or
  // the user unchecking Stop Loss directly.
  const noSL = isNoStopLoss || !slEnabled;

  // Preserve the alert's entry→stop DOLLAR differential against the live
  // ask shown here, rather than reapplying its raw stop price verbatim —
  // see the alertEntryPrice/alertStopLoss prop doc for the worked example.
  const alertDiff = (alertEntryPrice != null && alertStopLoss != null)
    ? alertEntryPrice - alertStopLoss
    : null;
  const impliedAlertStop = alertDiff != null && contract
    ? Math.max(0, contract.ask - alertDiff)
    : null;
  const alertMaxLossPct = impliedAlertStop != null && contract && contract.ask > 0
    ? Math.min(0.95, Math.max(0.05, (contract.ask - impliedAlertStop) / contract.ask))
    : null;

  // Technicals gate — refreshed every 15s while the sheet is open. See
  // entry_check_service.py for the ENTER / WAIT / DON'T ENTER rules.
  const entryCheck = useEntryCheck(ticker, contract.option_type, visible);
  // Explicit two-tap override of a DON'T ENTER verdict (see GatedBuyButton).
  const [overridden, setOverridden] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Set on a successful order placed from the Review sheet — it plays the
  // confirmation animation, then finishSuccess closes everything.
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { mutate: submit, isPending } = useImmediateTradeByTicker();
  // Overtrading guard — surfaces how many OTHER live positions are already
  // open so a chase-more-losses (or double-up-on-a-win) entry gets a real
  // warning instead of sliding straight through. Purely a confirm-step
  // nudge, not a block — see the 2026-09-11/09-14 trade-log review.
  const { data: openPositions } = useImmediatePositions();
  const openLiveCount = (openPositions ?? []).filter(p => p.paper_mode === false).length;

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
    setQty(defaultQtyFor(IMMEDIATE_PROFILES[DEFAULT_PROFILE_INDEX], contract.ask));
    setStopType(getCheapContractAutoGraceMinutes(contract.ask) ?? 'HARD');
    setVolumeExit(false);
    setManualSlPct(30);
    setPaperMode(true);
    setBlindEntry(null);
    setUseAlertStop(true);
    setSlEnabled(true);
    setTpEnabled(true);
    setOverridden(false);
    setReviewOpen(false);
    setSuccessMessage(null);
  // Only re-run when a different contract is opened, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, contract?.symbol]);

  const handleProfileSelect = (idx: number) => {
    setProfileIndex(idx);
    setQty(defaultQtyFor(IMMEDIATE_PROFILES[idx], contract.ask));
  };

  // Shared by the initial submit and the Blind Entry "Enter Anyway" retry.
  const runSubmit = (body: ImmediateTradeByTickerRequest) => {
    submit(body, {
      onSuccess: (r) => {
        setBlindEntry(null);
        // From the Review sheet: let its success animation play first.
        // A Blind Entry retry has no Review sheet open — toast and close.
        if (reviewOpen) {
          setSuccessMessage(r.message || `${ticker} entered`);
          return;
        }
        toast.success(r.message || `${ticker} entered`);
        onClose();
      },
      onError: (e) => {
        if (e instanceof StreamUnavailableError) {
          setReviewOpen(false);
          setBlindEntry({ body, lastPrice: e.payload.last_price ?? 0 });
          return;
        }
        // Review stays open with a fresh swipe so the order can be retried.
        toast.error(e.message || 'Trade failed');
        setBlindEntry(null);
      },
    });
  };

  // Shared by doSubmit, enterBlind, and the Blind Entry "Enter Anyway"
  // retry (runSubmit's caller adds bypass_stream_check itself) — one place
  // building the body means the stop/profile precedence logic below can
  // never drift between the normal submit and the opt-in blind one.
  const buildTradeBody = (): ImmediateTradeByTickerRequest | null => {
    if (!contract) return null;
    return {
      ticker,
      direction:       contract.option_type,
      contract_symbol: contract.symbol,
      qty,
      profile:         profile.key,
      paper_mode:      paperMode,
      volume_exit:     isManual ? false : volumeExit,
      sl_grace_minutes: (noSL || stopType === 'HARD') ? null : stopType,
      sl_enabled: slEnabled,
      tp_enabled: tpEnabled,
      // Alert-matched stop takes priority over both the profile default and
      // the manual slider whenever it's on and available — matches the
      // "should be set to that price" request regardless of which profile
      // is selected. No point sending a stop at all once Stop Loss is off.
      ...(slEnabled && useAlertStop && alertMaxLossPct != null
        ? { max_loss_pct: alertMaxLossPct }
        : (slEnabled && isManual) ? { max_loss_pct: manualSlPct / 100 } : {}),
    };
  };

  const doSubmit = () => {
    const body = buildTradeBody();
    if (body) runSubmit(body);
  };

  // Opted into upfront, from the Review sheet's "Skip live price check" —
  // see OrderReviewSheet's onEnterBlind doc comment. Only offered for a
  // 0DTE contract (isZeroDteContract below) since that's the only case the
  // backend's stream check — and therefore this bypass — does anything.
  const enterBlind = () => {
    const body = buildTradeBody();
    if (body) runSubmit({ ...body, bypass_stream_check: true });
  };

  // Shown on the Review sheet in place of the old Alert confirms — the
  // concurrent-position count is still a warning, not a block, per the
  // 2026-09-11/09-14 trade-log review.
  const reviewWarnings = [
    ...(noSL ? [`No automatic stop loss${!tpEnabled ? ' or take-profit exit' : ''}${isNoStopLoss ? ', including end of day — it expires if you don\'t sell it' : ''}.`] : []),
    ...(!paperMode && openLiveCount > 0 ? [`You already have ${openLiveCount} other live position${openLiveCount > 1 ? 's' : ''} open.`] : []),
  ];

  // Exit profile translated to dollars for the Review sheet, using the same
  // stop precedence doSubmit sends (alert-matched → manual → profile).
  const stopPct = noSL ? null
    : (useAlertStop && alertMaxLossPct != null) ? alertMaxLossPct
    : isManual ? manualSlPct / 100
    : profile.maxLoss / 100;
  // "Skip live price check" only means anything for a 0DTE contract —
  // same is_zero_dte condition the backend gates verify_stream on
  // (submit_manual_trade). A rough client-side date compare is fine here:
  // it only decides whether to SHOW the option, never whether the bypass
  // actually does anything — the backend re-derives is_zero_dte itself
  // from the contract symbol regardless of what the client thinks.
  const isZeroDteContract = contract?.expiration?.slice(0, 10) === new Date().toISOString().slice(0, 10);

  const reviewOrder: ReviewOrder = {
    ticker,
    optionType: contract.option_type,
    strike: contract.strike,
    expiration: contract.expiration,
    premium: contract.ask,
    qty,
    profileLabel: `${profile.emoji} ${profile.name}`,
    stopPrice: stopPct == null ? null : contract.ask * (1 - stopPct),
    stopLabel: stopPct == null ? 'Off' : stopType === 'HARD' ? 'Hard stop' : `${stopType}-min SL timer`,
    tp1Price: tpEnabled && !isManual && profile.tp1 > 0 ? contract.ask * (1 + profile.tp1 / 100) : null,
    tp2Price: tpEnabled && !isManual && profile.tp2 > 0 ? contract.ask * (1 + profile.tp2 / 100) : null,
  };
  const mid = contract.bid > 0 && contract.ask > 0 ? (contract.bid + contract.ask) / 2 : null;
  const muted = colors.textSecondary ?? colors.tabBarInactive;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AccountModeTint paperMode={paperMode} colors={colors} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
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
        <AccountModeBanner paperMode={paperMode} colors={colors} />

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {/* Contract + pricing — stays first and prominent */}
          <View style={[s.priceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.priceTop}>
              <View style={{ flex: 1 }}>
                <Text style={[s.priceContract, { color: colors.text }]}>
                  {ticker} ${contract.strike} {contract.option_type === 'CALL' ? 'Call' : 'Put'}
                </Text>
                <Text style={[s.priceExp, { color: muted }]}>
                  Exp {contract.expiration}{entryCheck.data ? ` · ${ticker} $${entryCheck.data.price.toFixed(2)}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.priceAsk, { color: colors.text }]}>${contract.ask.toFixed(2)}</Text>
                <Text style={[s.priceExp, { color: muted }]}>ask / share</Text>
              </View>
            </View>
            <View style={[s.priceRow, { borderTopColor: colors.border }]}>
              <PriceCell label="Bid" value={`$${contract.bid.toFixed(2)}`} colors={colors} />
              <PriceCell label="Mid" value={mid != null ? `$${mid.toFixed(2)}` : '—'} colors={colors} />
              <PriceCell label="Per contract" value={`$${(contract.ask * 100).toFixed(0)}`} colors={colors} />
              <PriceCell label={`Cost × ${qty}`} value={`$${(qty * contract.ask * 100).toFixed(0)}`} colors={colors} strong />
            </View>
          </View>

          {/* Technicals gate — above the account/profile controls so the
              verdict is on screen without scrolling */}
          <View style={{ marginTop: 12, marginBottom: 18 }}>
            <EntryTechnicalsPanel
              data={entryCheck.data}
              isLoading={entryCheck.isLoading}
              error={entryCheck.error}
              direction={contract.option_type}
              colors={colors}
            />
          </View>

          {/* Alert-matched stop — only when the checklist's parsed contract
              had both an entry and stop price, and NO_STOP_LOSS (which
              ignores max_loss_pct entirely server-side) isn't selected. */}
          {alertMaxLossPct != null && slEnabled && (
            <TouchableOpacity
              onPress={() => setUseAlertStop(v => !v)}
              activeOpacity={0.8}
              style={[s.alertStopRow, {
                backgroundColor: (useAlertStop ? colors.accent : colors.tabBarInactive) + '14',
                borderColor: (useAlertStop ? colors.accent : colors.border) + '55',
                marginBottom: 18,
              }]}
            >
              <Ionicons
                name={useAlertStop ? 'checkbox' : 'square-outline'}
                size={19}
                color={useAlertStop ? colors.accent : colors.tabBarInactive}
              />
              <View style={{ flex: 1 }}>
                <Text style={[s.alertStopTitle, { color: colors.text }]}>
                  Use alert-matched stop — ${impliedAlertStop!.toFixed(2)}
                </Text>
                <Text style={[s.alertStopSub, { color: colors.tabBarInactive }]}>
                  Alert: ${alertEntryPrice!.toFixed(2)} entry / ${alertStopLoss!.toFixed(2)} stop
                  {' '}(${alertDiff!.toFixed(2)} differential) · applied against this ${contract.ask.toFixed(2)} ask
                </Text>
              </View>
            </TouchableOpacity>
          )}

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

          {/* Manual SL — only for MANUAL profile, and only while SL is enabled */}
          {isManual && slEnabled && (
            <View style={{ marginBottom: 18 }}>
              <ManualSLPicker slPct={manualSlPct} onChangePct={setManualSlPct} askPrice={contract.ask} colors={colors} />
            </View>
          )}

          {/* Qty */}
          <Text style={[s.label, { color: colors.tabBarInactive }]}>
            CONTRACTS{noSL ? ' — no stop loss, size carefully' : ''}
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

          {/* Exit Controls — SL/TP enable checkboxes apply on every profile;
              unchecking either lets a runner run its course (or hold into
              close) instead of auto-exiting on that leg. */}
          <Text style={[s.label, { color: colors.tabBarInactive, marginTop: 18 }]}>EXIT CONTROLS</Text>
          <View style={[s.exitToggles, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.exitRow}>
              <Text style={[s.exitLabel, { color: colors.text }]}>Stop Loss</Text>
              <TouchableOpacity onPress={() => setSlEnabled(v => !v)} hitSlop={8}>
                <Ionicons
                  name={slEnabled ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={slEnabled ? colors.accent : colors.tabBarInactive}
                />
              </TouchableOpacity>
            </View>
            <View style={[s.exitRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <Text style={[s.exitLabel, { color: colors.text }]}>Take Profit</Text>
              <TouchableOpacity onPress={() => setTpEnabled(v => !v)} hitSlop={8}>
                <Ionicons
                  name={tpEnabled ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={tpEnabled ? colors.accent : colors.tabBarInactive}
                />
              </TouchableOpacity>
            </View>
            {!isManual && (
              <View style={[s.exitRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <Text style={[s.exitLabel, { color: colors.text }]}>Volume Exit</Text>
                <TouchableOpacity onPress={() => setVolumeExit(v => !v)} hitSlop={8}>
                  <Ionicons
                    name={volumeExit ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={volumeExit ? colors.accent : colors.tabBarInactive}
                  />
                </TouchableOpacity>
              </View>
            )}
          </View>
          {slEnabled && (
            <View style={{ marginTop: 10 }}>
              <StopTypeSelector value={stopType} onChange={setStopType} colors={colors} autoSuggested={autoGraceMinutes} />
            </View>
          )}

          <View style={{ marginTop: 18 }}>
            <GreeksExpander greeks={contract} colors={colors} />
          </View>
        </ScrollView>

        {/* Sticky footer — the buy button (and any DON'T ENTER blocker)
            never scrolls out of view */}
        <View style={[s.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <GatedBuyButton
            check={entryCheck.data}
            checkLoading={entryCheck.isLoading}
            paperMode={paperMode}
            label={`Buy ${contract.option_type} × ${qty}`}
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
    </View>
  );
}

function PriceCell({ label, value, colors, strong }: { label: string; value: string; colors: any; strong?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[s.priceCellLabel, { color: colors.textSecondary ?? colors.tabBarInactive }]}>{label}</Text>
      <Text style={[s.priceCellValue, { color: colors.text, fontWeight: strong ? '800' : '600' }]}>{value}</Text>
    </View>
  );
}

/**
 * Trade-entry sheet for a contract already chosen via the Contracts tab (as
 * opposed to ImmediateTradePanel, which browses a chain first). Reuses the
 * exact same profile/SL pickers and submission path as Home's Trade flow so
 * behavior is identical regardless of where the contract was found.
 */
export function TradeContractSheet({ visible, onClose, colors, ticker, contract, currentPrice, alertEntryPrice, alertStopLoss }: Props) {
  if (!contract) return null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <TradeContractForm
        visible={visible} onClose={onClose} colors={colors}
        ticker={ticker} contract={contract} currentPrice={currentPrice}
        alertEntryPrice={alertEntryPrice} alertStopLoss={alertStopLoss}
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
export function TradeContractQuickCard({ visible, onClose, colors, ticker, contract, currentPrice, alertEntryPrice, alertStopLoss }: Props) {
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
          alertEntryPrice={alertEntryPrice} alertStopLoss={alertStopLoss}
        />
      </Animated.View>
    </View>
  );
}

const qs = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: '88%', borderTopLeftRadius: 20, borderTopRightRadius: 20,
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

  alertStopRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  alertStopTitle: { fontSize: 13.5, fontWeight: '700' },
  alertStopSub:   { fontSize: 11, marginTop: 2, lineHeight: 15 },

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

  priceCard:      { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  priceTop:       { flexDirection: 'row', alignItems: 'center', padding: 14 },
  priceContract:  { fontSize: 17, fontWeight: '800' },
  priceExp:       { fontSize: 12, marginTop: 2 },
  priceAsk:       { fontSize: 26, fontWeight: '800' },
  priceRow:       { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10 },
  priceCellLabel: { fontSize: 11 },
  priceCellValue: { fontSize: 14, marginTop: 2 },

  footer:      { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20, borderTopWidth: StyleSheet.hairlineWidth },
});
