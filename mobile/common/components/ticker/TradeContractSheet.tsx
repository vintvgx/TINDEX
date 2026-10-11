import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal,
  Animated, Easing, Pressable, Dimensions, AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from '@/common/components/ui/Toast';
import { useImmediateTradeByTicker, StreamUnavailableError } from '@/hooks/mutations/strategy/useImmediateTradeByTicker';
import { useImmediatePositions } from '@/hooks/queries/strategy/useImmediatePositions';
import {
  IMMEDIATE_PROFILES, DEFAULT_PROFILE_INDEX, defaultQtyFor, scalperSmartQty,
  getCheapContractAutoGraceMinutes, ProfileDropdown, ManualSLPicker,
} from '@/common/components/strategy/ImmediateProfilePicker';
import { StopTypeSelector, type StopType } from '@/common/components/strategy/StopTypeSelector';
import { EntrySafetySelector, BE_GRACE_DEFAULT, effectiveFloorPct } from '@/common/components/trade/EntrySafetySelector';
import { BlindEntryModal } from '@/common/components/strategy/BlindEntryModal';
import { useEntryCheck } from '@/hooks/queries/technicals/useEntryCheck';
import { EntryTechnicalsPanel } from '@/common/components/trade/EntryTechnicalsPanel';
import { PositioningRow } from '@/common/components/trade/PositioningRow';
import { GreeksExpander } from '@/common/components/trade/GreeksExpander';
import { GatedBuyButton } from '@/common/components/trade/GatedBuyButton';
import { AccountModeBanner, AccountModeTint } from '@/common/components/trade/AccountModeBanner';
import { OrderReviewSheet, type ReviewOrder } from '@/common/components/trade/OrderReviewSheet';
import type { OptionsContract } from '@/common/types/blogPosts/ticker';
import type { ImmediateTradeByTickerRequest } from '@/common/types/strategy';
import { emitTradeEntered } from '@/common/services/tradeEntryEvents';
import {
  ExitLadder, ladderRequest, ladderRungs, LADDER_TP1_PCT, LADDER_TP2_PCT, type LadderSetup,
} from '@/common/components/trade/ExitLadder';
import { useTradeSheetPrefs } from '@/hooks/useTradeSheetPrefs';

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
 * The actual form — trade sheet v2 (2026-10-11): compact contract header,
 * Paper/Live, one-line market + market value, CONTRACTS chips + stepper,
 * TECHNICALS (gate panel untouched), EXIT LADDER, then collapsed Contract
 * info / Exit details / All profiles, and a sticky Review CTA → the Review
 * sheet (unchanged, the last gate) → success → Home.
 * Shared by both TradeContractSheet (a full native Modal, used from the
 * Contracts tab / contract detail modal) and TradeContractQuickCard (an
 * inline animated overlay, used from AgentModal so the AI Assistant chat
 * never has to close to enter a trade). Neither wrapper duplicates any of
 * this logic — only how it's presented differs.
 */
function TradeContractForm({ visible, onClose, colors, ticker, contract, currentPrice, alertEntryPrice, alertStopLoss }: Omit<Props, 'contract'> & { contract: OptionsContract }) {
  const toast = useToast();
  const [paperMode, setPaperMode]       = useState(true);
  // The ladder runs on SCALPER; picking another profile under "All
  // profiles" switches the ladder off and uses that profile as before.
  const [profileIndex, setProfileIndex] = useState(LADDER_PROFILE_INDEX);
  const [qty, setQty]                   = useState(scalperSmartQty(contract.ask));
  const [ladderSetup, setLadderSetup]   = useState<LadderSetup>('standard');
  // Exit details — remembered across opens (see useTradeSheetPrefs).
  const { prefs, loaded: prefsLoaded, remember } = useTradeSheetPrefs();
  const [stopType, setStopTypeState]    = useState<StopType>(5);
  const [floorPct, setFloorPctState]    = useState<number | null>(null);
  const [beGrace, setBeGraceState]      = useState<number>(BE_GRACE_DEFAULT);
  const [volumeExit, setVolumeExitState] = useState(false);
  const setStopType   = (v: StopType)      => { setStopTypeState(v); remember({ stopType: v }); };
  const setFloorPct   = (v: number | null) => { setFloorPctState(v); remember({ floorPct: v }); };
  const setBeGrace    = (v: number)        => { setBeGraceState(v); remember({ beGrace: v }); };
  const setVolumeExit = (v: boolean)       => { setVolumeExitState(v); remember({ volumeExit: v }); };
  const chooseLadderSetup = (v: LadderSetup) => { setLadderSetup(v); remember({ ladderSetup: v }); };
  const [manualSlPct, setManualSlPct]   = useState(30);
  // Defaults ON whenever the checklist's parsed contract had both an alert
  // entry and stop — user can still turn it off to fall back to the
  // ladder/profile's own default stop (or the manual slider, if MANUAL).
  const [useAlertStop, setUseAlertStop] = useState(true);
  // SL/TP enable — on by default; turning either off lets a runner run its
  // course (or hold into close) instead of auto-exiting.
  const [slEnabled, setSlEnabled] = useState(true);
  const [tpEnabled, setTpEnabled] = useState(true);
  const [openSection, setOpenSection] = useState<'info' | 'exit' | 'profiles' | null>(null);
  const toggleSection = (k: 'info' | 'exit' | 'profiles') => setOpenSection(o => (o === k ? null : k));

  const profile      = IMMEDIATE_PROFILES[profileIndex];
  const ladderOn     = profileIndex === LADDER_PROFILE_INDEX;
  const isManual     = profile.isManual === true;
  const isNoStopLoss = profile.isNoStopLoss === true;
  // No stop loss in effect — either from a (legacy) NO_STOP_LOSS profile or
  // the user disarming Stop Loss directly.
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
  // Set on a successful order — the Review sheet plays its success state,
  // then finishSuccess closes everything and hands off to Home.
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // The order the success state is for — read when handing off to Home.
  const entered = useRef<{ strategyId?: string; body: ImmediateTradeByTickerRequest } | null>(null);
  // Backgrounded while the success state was up → don't yank the user to
  // Home when they come back; just close the sheet.
  const backgroundedDuringSuccess = useRef(false);
  useEffect(() => {
    if (!successMessage) return;
    backgroundedDuringSuccess.current = false;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') backgroundedDuringSuccess.current = true;
    });
    return () => sub.remove();
  }, [successMessage]);

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

  // Reset to defaults every time a new contract is opened — exit details
  // from the remembered prefs (once loaded), else a grace stop-type auto-
  // suggested for any sub-$0.50 contract, mirroring ImmediateTradePanel.
  const autoGraceMinutes = contract ? getCheapContractAutoGraceMinutes(contract.ask) : null;
  useEffect(() => {
    if (!visible || !contract || !prefsLoaded) return;
    setProfileIndex(LADDER_PROFILE_INDEX);
    setQty(scalperSmartQty(contract.ask));
    setLadderSetup(prefs.ladderSetup ?? 'standard');
    setStopTypeState(prefs.stopType ?? getCheapContractAutoGraceMinutes(contract.ask) ?? 'HARD');
    setVolumeExitState(prefs.volumeExit ?? false);
    setFloorPctState(prefs.floorPct !== undefined ? prefs.floorPct : null);
    setBeGraceState(prefs.beGrace ?? BE_GRACE_DEFAULT);
    setManualSlPct(30);
    setPaperMode(true);
    setBlindEntry(null);
    setUseAlertStop(true);
    setSlEnabled(true);
    setTpEnabled(true);
    setOverridden(false);
    setReviewOpen(false);
    setSuccessMessage(null);
    setOpenSection(null);
  // Only re-run when a different contract is opened (or prefs first land),
  // not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, contract?.symbol, prefsLoaded]);

  const handleProfileSelect = (idx: number) => {
    setProfileIndex(idx);
    setQty(defaultQtyFor(IMMEDIATE_PROFILES[idx], contract.ask));
  };

  // Shared by the initial submit and the Blind Entry "Enter Anyway" retry.
  const runSubmit = (body: ImmediateTradeByTickerRequest) => {
    submit(body, {
      onSuccess: (r) => {
        setBlindEntry(null);
        // Every success — Review submit or the Blind Entry retry (which has
        // no Review sheet open, so re-present it) — plays the full-sheet
        // success state; finishSuccess then hands off to Home.
        entered.current = { strategyId: r.strategy_id, body };
        setReviewOpen(true);
        setSuccessMessage(r.message || `${ticker} entered`);
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
      ...(slEnabled && !noSL && floorPct != null ? { sl_outer_floor_pct: floorPct } : {}),
      be_grace_seconds: beGrace,
      tp_enabled: tpEnabled,
      ...(ladderOn ? { ladder: ladderRequest(qty, ladderSetup) } : {}),
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

  // Exit plan translated to dollars for the Review sheet, using the same
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

  const tp1Pct = ladderOn ? LADDER_TP1_PCT : profile.tp1;
  const tp2Pct = ladderOn ? (qty >= 3 ? LADDER_TP2_PCT[ladderSetup] : 0) : profile.tp2;
  const reviewOrder: ReviewOrder = {
    ticker,
    optionType: contract.option_type,
    strike: contract.strike,
    expiration: contract.expiration,
    premium: contract.ask,
    qty,
    profileLabel: ladderOn
      ? `Ladder · ${ladderRungs(qty, ladderSetup).map(r => (r.pct != null ? `+${r.pct}%` : 'runner')).join(' / ')}`
      : `${profile.emoji} ${profile.name}`,
    stopPrice: stopPct == null ? null : contract.ask * (1 - stopPct),
    stopLabel: stopPct == null ? 'Off' : stopType === 'HARD' ? 'Hard stop' : `${stopType}-min SL timer`,
    tp1Price: tpEnabled && !isManual && tp1Pct > 0 ? contract.ask * (1 + tp1Pct / 100) : null,
    tp2Price: tpEnabled && !isManual && tp2Pct > 0 ? contract.ask * (1 + tp2Pct / 100) : null,
    floorPrice: (() => { const f = stopPct == null ? null : effectiveFloorPct(floorPct, stopType !== 'HARD'); return f == null ? null : contract.ask * (1 - f); })(),
    floorIsDefault: floorPct == null,
    beGraceSeconds: tpEnabled && !isManual ? beGrace : 0,
  };

  // Success state done: close this sheet, then (unless the app went to the
  // background meanwhile) hand off to TradeEntryNavigator, which closes any
  // hosting modal and lands on Home with the new position highlighted.
  const finishSuccess = () => {
    setSuccessMessage(null);
    setReviewOpen(false);
    onClose();
    const e = entered.current;
    entered.current = null;
    if (!e || backgroundedDuringSuccess.current) return;
    emitTradeEntered({
      ticker,
      contractSymbol: e.body.contract_symbol,
      strategyId: e.strategyId,
      label: `${ticker} ${strikeLabel}${contract.option_type === 'CALL' ? 'C' : 'P'} ×${e.body.qty ?? qty}`,
      paperMode: e.body.paper_mode,
    });
  };

  const muted = colors.textSecondary ?? colors.tabBarInactive;
  const faint = colors.textTertiary ?? colors.tabBarInactive;
  const mid = contract.bid > 0 && contract.ask > 0 ? (contract.bid + contract.ask) / 2 : null;
  const spreadPct = mid ? ((contract.ask - contract.bid) / mid) * 100 : null;
  const strikeLabel = contract.strike % 1 === 0 ? contract.strike.toFixed(0) : contract.strike.toFixed(2);
  const marketValue = qty * contract.ask * 100;
  const underlying = entryCheck.data?.price ?? (currentPrice > 0 ? currentPrice : null);
  const hasGreeks = [contract.delta, contract.gamma, contract.theta, contract.vega, contract.implied_volatility].some(v => v != null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AccountModeTint paperMode={paperMode} colors={colors} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        {/* Compact contract header */}
        <View style={[s.header, { borderBottomColor: colors.separator ?? colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: colors.text }]}>
              {ticker} ${strikeLabel}{contract.option_type === 'CALL' ? 'C' : 'P'}
            </Text>
            <Text style={[s.subhead, { color: muted }]} numberOfLines={1}>
              {ticker}{underlying != null ? ` · $${underlying.toFixed(2)}` : ''} · {fmtExpiration(contract.expiration)}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={[s.closeBtn, { backgroundColor: colors.surface ?? colors.card, borderColor: colors.border }]}>
            <Ionicons name="close" size={18} color={muted} />
          </TouchableOpacity>
        </View>
        {!paperMode && <AccountModeBanner paperMode={paperMode} colors={colors} />}

        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {/* Paper / Live */}
          <View style={[s.accountToggle, { backgroundColor: colors.card, borderColor: colors.border }]}>
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

          {/* One-line market + market value */}
          <View style={s.marketLine}>
            <Text style={[s.tab, { flex: 1, fontSize: 12.5, color: muted }]} numberOfLines={1}>
              Ask <Text style={{ color: colors.text, fontWeight: '700' }}>${contract.ask.toFixed(2)}</Text>
              {' · '}Bid ${contract.bid.toFixed(2)}
              {spreadPct != null ? ` · Spread ${spreadPct.toFixed(0)}%` : ''}
            </Text>
            <Text style={[s.tab, { fontSize: 17, fontWeight: '800', color: colors.text }]}>${marketValue.toFixed(2)}</Text>
          </View>

          {/* Contracts: 1/2/3 chips + 1–10 stepper */}
          <Text style={[s.label, { color: colors.tabBarInactive }]}>
            CONTRACTS{noSL ? ' — no stop loss, size carefully' : ''}
          </Text>
          <View style={s.qtyRow}>
            <View style={s.chips}>
              {[1, 2, 3].map(n => {
                const on = qty === n;
                return (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setQty(n)}
                    activeOpacity={0.75}
                    style={[s.chip, { borderColor: on ? '#4A9EFF' : colors.border, backgroundColor: on ? '#4A9EFF14' : colors.card }]}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '800', color: on ? colors.text : muted }}>{n}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={[s.stepper, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <TouchableOpacity onPress={() => setQty(q => Math.max(1, q - 1))} hitSlop={8} style={s.stepBtn}>
                <Ionicons name="remove" size={18} color={colors.text} />
              </TouchableOpacity>
              <Text style={[s.tab, s.qtyValue, { color: colors.text }]}>{qty}</Text>
              <TouchableOpacity onPress={() => setQty(q => Math.min(MAX_QTY, q + 1))} hitSlop={8} style={s.stepBtn}>
                <Ionicons name="add" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Technicals gate — untouched, above the exit plan */}
          <Text style={[s.label, { color: colors.tabBarInactive, marginTop: 16 }]}>TECHNICALS</Text>
          <EntryTechnicalsPanel
            data={entryCheck.data}
            isLoading={entryCheck.isLoading}
            error={entryCheck.error}
            direction={contract.option_type}
            colors={colors}
          />
          <PositioningRow ticker={ticker} direction={contract.option_type} expiry={contract.expiration} colors={colors} />

          {/* Alert-matched stop — only when the checklist's parsed contract
              had both an entry and stop price, and SL is armed. */}
          {alertMaxLossPct != null && slEnabled && (
            <TouchableOpacity
              onPress={() => setUseAlertStop(v => !v)}
              activeOpacity={0.8}
              style={[s.alertStopRow, {
                backgroundColor: (useAlertStop ? colors.accent : colors.tabBarInactive) + '14',
                borderColor: (useAlertStop ? colors.accent : colors.border) + '55',
                marginTop: 14,
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

          {/* Exit ladder (or the chosen non-ladder profile) */}
          <Text style={[s.label, { color: colors.tabBarInactive, marginTop: 16 }]}>
            {ladderOn ? 'EXIT LADDER' : `EXIT PROFILE · ${profile.emoji} ${profile.name.toUpperCase()}`}
          </Text>
          {ladderOn ? (
            <ExitLadder
              qty={qty}
              setup={ladderSetup}
              onSetup={chooseLadderSetup}
              ask={contract.ask}
              slPct={stopPct}
              slEnabled={slEnabled}
              tpEnabled={tpEnabled}
              onToggleSl={() => setSlEnabled(v => !v)}
              onToggleTp={() => setTpEnabled(v => !v)}
              colors={colors}
            />
          ) : (
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 12.5, color: muted, lineHeight: 18 }}>
                {profile.description}
                {!isManual && ` TP1 +${profile.tp1}%${profile.tp2 > 0 ? ` · TP2 +${profile.tp2}%` : ''} · SL −${profile.maxLoss}%.`}
              </Text>
              {isManual && slEnabled && (
                <ManualSLPicker slPct={manualSlPct} onChangePct={setManualSlPct} askPrice={contract.ask} colors={colors} />
              )}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <ArmToggle label="Stop Loss" on={slEnabled} onPress={() => setSlEnabled(v => !v)} colors={colors} />
                <ArmToggle label="Take Profit" on={tpEnabled} onPress={() => setTpEnabled(v => !v)} colors={colors} />
              </View>
              <TouchableOpacity onPress={() => handleProfileSelect(LADDER_PROFILE_INDEX)} hitSlop={6}>
                <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#4A9EFF' }}>← Back to the exit ladder</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Contract info */}
          <Dropdown title="Contract info" open={openSection === 'info'} onToggle={() => toggleSection('info')} colors={colors}>
            <KV k="Symbol" v={contract.symbol} colors={colors} />
            <KV k="Last" v={contract.last_price != null ? `$${contract.last_price.toFixed(2)}` : '—'} colors={colors} />
            <KV k="Bid / Ask" v={`$${contract.bid.toFixed(2)} / $${contract.ask.toFixed(2)}`} colors={colors} />
            <KV k="Midpoint" v={mid != null ? `$${mid.toFixed(3)}` : '—'} colors={colors} />
            <KV k="Spread" v={spreadPct != null ? `${spreadPct.toFixed(1)}%` : '—'} colors={colors} />
            <KV k="Expiration" v={fmtExpiration(contract.expiration)} colors={colors} />
            <KV k="Volume / OI" v={`${(contract.volume ?? 0).toLocaleString()} / ${(contract.open_interest ?? 0).toLocaleString()}`} colors={colors} />
            {hasGreeks ? (
              <View style={{ marginTop: 8 }}>
                <GreeksExpander greeks={contract} colors={colors} />
              </View>
            ) : (
              <KV k="Greeks" v="not on current feed" muted colors={colors} />
            )}
          </Dropdown>

          {/* Exit details — remembered across opens */}
          <Dropdown title="Exit details" open={openSection === 'exit'} onToggle={() => toggleSection('exit')} colors={colors}>
            {slEnabled ? (
              <View style={{ marginTop: 6 }}>
                <StopTypeSelector value={stopType} onChange={setStopType} colors={colors} autoSuggested={autoGraceMinutes} />
                <View style={{ marginTop: 14 }}>
                  <EntrySafetySelector colors={colors} floorPct={floorPct} onFloorPct={setFloorPct}
                    beGrace={beGrace} onBeGrace={setBeGrace} premium={contract.ask} stopIsTimer={stopType !== 'HARD'} />
                </View>
              </View>
            ) : (
              <Text style={{ fontSize: 12, color: faint, marginTop: 8 }}>Stop loss is off — stop type and floor don&apos;t apply.</Text>
            )}
            {!isManual && (
              <View style={{ marginTop: 14 }}>
                <Text style={[s.subLabel, { color: faint }]}>VOLUME EXIT</Text>
                <View style={s.chips}>
                  {([false, true] as const).map(v => {
                    const on = volumeExit === v;
                    return (
                      <TouchableOpacity
                        key={String(v)}
                        onPress={() => setVolumeExit(v)}
                        activeOpacity={0.6}
                        style={[s.pill, { backgroundColor: on ? colors.text + '14' : 'transparent', borderColor: on ? colors.text : colors.separator ?? colors.border }]}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '600', color: on ? colors.text : muted }}>{v ? 'On' : 'Off'}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={{ fontSize: 11.5, color: faint, marginTop: 6 }}>Close half on low volume.</Text>
              </View>
            )}
          </Dropdown>

          {/* All profiles — demoted; picking one switches the ladder off */}
          <Dropdown title="All profiles" open={openSection === 'profiles'} onToggle={() => toggleSection('profiles')} colors={colors}>
            <Text style={{ fontSize: 11.5, color: faint, marginVertical: 8 }}>
              The ladder runs on Scalper. Pick another profile to use its exits instead.
            </Text>
            <ProfileDropdown selectedIndex={profileIndex} onSelect={handleProfileSelect} colors={colors} />
          </Dropdown>
        </ScrollView>

        {/* Sticky CTA — the buy button (and any DON'T ENTER blocker)
            never scrolls out of view */}
        <View style={[s.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <GatedBuyButton
            check={entryCheck.data}
            checkLoading={entryCheck.isLoading}
            paperMode={paperMode}
            label={`Buy ${qty} ${contract.option_type} · $${marketValue.toFixed(2)}`}
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
        successHint={backgroundedDuringSuccess.current ? undefined : 'Taking you to your position…'}
        onSuccessDone={finishSuccess}
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

const MAX_QTY = 10;
const LADDER_PROFILE_INDEX = DEFAULT_PROFILE_INDEX; // SCALPER

/** "2026-10-16" → "Oct 16, 2026". */
function fmtExpiration(exp: string): string {
  const d = new Date(`${exp.slice(0, 10)}T12:00:00`);
  return isNaN(d.getTime()) ? exp : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Dropdown({ title, open, onToggle, colors, children }: {
  title: string; open: boolean; onToggle: () => void; colors: any; children: React.ReactNode;
}) {
  return (
    <View style={[s.dd, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.75} style={s.ddHead} accessibilityState={{ expanded: open }}>
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: colors.text }}>{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary ?? colors.tabBarInactive} />
      </TouchableOpacity>
      {open && <View style={s.ddBody}>{children}</View>}
    </View>
  );
}

function KV({ k, v, colors, muted }: { k: string; v: string; colors: any; muted?: boolean }) {
  return (
    <View style={[s.kv, { borderTopColor: colors.separator ?? colors.border }]}>
      <Text style={{ fontSize: 12.5, color: colors.textSecondary ?? colors.tabBarInactive }}>{k}</Text>
      <Text style={[s.tab, { fontSize: 12.5, fontWeight: '700', color: muted ? colors.textTertiary ?? colors.tabBarInactive : colors.text }]} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

function ArmToggle({ label, on, onPress, colors }: { label: string; on: boolean; onPress: () => void; colors: any }) {
  const c = on ? colors.success : colors.textTertiary ?? colors.tabBarInactive;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={[s.arm, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.text }}>{label}</Text>
      <Text style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: '800', letterSpacing: 0.8, color: c }}>{on ? 'ARMED' : 'OFF'}</Text>
    </TouchableOpacity>
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
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title:       { fontSize: 19, fontWeight: '800' },
  subhead:     { fontSize: 12.5, marginTop: 1 },
  closeBtn:    { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  tab:         { fontVariant: ['tabular-nums'] },

  label:       { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  subLabel:    { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },

  alertStopRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  alertStopTitle: { fontSize: 13.5, fontWeight: '700' },
  alertStopSub:   { fontSize: 11, marginTop: 2, lineHeight: 15 },

  accountToggle: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3 },
  accountBtn:    { flex: 1, alignItems: 'center', paddingVertical: 8 },
  accountText:   { fontSize: 13 },

  marketLine:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 14 },

  qtyRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chips:       { flexDirection: 'row', gap: 8 },
  chip:        { width: 46, height: 40, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepper:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 11, borderWidth: 1, height: 40, paddingHorizontal: 6 },
  stepBtn:     { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  qtyValue:    { fontSize: 17, fontWeight: '800', minWidth: 24, textAlign: 'center' },
  pill:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },

  arm:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 9 },

  dd:          { marginTop: 10, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  ddHead:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  ddBody:      { paddingHorizontal: 14, paddingBottom: 12 },
  kv:          { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth },

  footer:      { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20, borderTopWidth: StyleSheet.hairlineWidth },
});
