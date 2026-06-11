"""
Profile-aware ORB trading engine.

Config is loaded from Supabase at startup and hot-reloaded when the frontend
POSTs to /strategy/config. Paper vs live trading is set by paper_mode in config.
"""

import os
import logging
import threading
import pytz
from datetime import datetime, timedelta

from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.data.historical import OptionHistoricalDataClient

from services.strategy.profiles import get_profile
from services.strategy.contract_selector import select_contract
from services.strategy.exit_manager import ExitManager
from services.strategy.sentiment import SentimentFilter
from services.strategy.trade_logger import TradeLogger
from services.strategy.notifier import StrategyNotifier
from services.strategy.debug_log import DebugLogBuffer
from services.utils.orb_data_hub import get_orb_data_hub, OrbBar

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

# Opening-range window is fixed at 09:30–09:45 ET to stay consistent with
# OrbService, which computes the ORB over the same 15-minute window.
ORB_WINDOW_MINUTES = 15

STRATEGY_DEFAULTS = {
    "ticker":                  "IWM",
    "paper_mode":              True,
    "active":                  True,
    "profile":                 "THUNDER_CAT",
    "trade_days":              [0, 2, 4],
    "strategy_name":           "",
    "capital_limit":           None,
    "bypass_breakout_window":  False,
    "custom_thresholds":       None,
    "budget_otm_mode":         False,
    "otm_fib_level":           "1.0",
    "debug_mode":              False,
    "id":                      None,
}

VIX_MIN = 13.0
MIN_ORB_RANGE_PCT = 0.0015

EOD_CLOSE_TIMES = {
    "SPY": "15:25",
    "QQQ": "15:25",
    "IWM": "15:10"
    }


class ORBEngine:
    def __init__(self, config: dict = None, stream_manager=None, hub=None):
        self.config = config or STRATEGY_DEFAULTS.copy()
        self._stream_manager_ref = stream_manager
        # ORB data hub — bars + ORB status are pushed here by OrbService.
        self._hub = hub or get_orb_data_hub()
        self._subscribed_ticker = None        # ticker currently subscribed on the hub
        # Serializes on_price_tick across its callers (hub bar thread, option-stream
        # thread, hub breakout thread) so concurrent callers can't interleave a
        # double entry.
        self._tick_lock = threading.Lock()
        # Debug log: emits only while debug_enabled (set from config in _apply_config).
        self.debug_enabled = False
        self.debug = DebugLogBuffer(lambda: self.debug_enabled)
        self._apply_config()
        self._reset_session_state()

    def _apply_config(self):
        self.ticker         = self.config["ticker"]
        self.paper          = self.config.get("paper_mode", True)
        self.profile_key    = self.config.get("profile", "THUNDER_CAT")
        self.trade_days     = set(self.config.get("trade_days", [0, 2, 4]))
        self.strategy_id             = self.config.get("id")
        self.strategy_name           = self.config.get("strategy_name", "")
        self.capital_limit           = self.config.get("capital_limit")
        self.bypass_breakout_window  = self.config.get("bypass_breakout_window", False)
        self.budget_otm_mode         = self.config.get("budget_otm_mode", False)
        self.otm_fib_level           = self.config.get("otm_fib_level", "1.0")
        self.debug_enabled           = self.config.get("debug_mode", False)
        custom_thresholds            = self.config.get("custom_thresholds")
        self.stream_manager          = getattr(self, "_stream_manager_ref", None)

        # For CUSTOM profile, pass stored thresholds to get_profile so it merges them
        # over the CUSTOM_DEFAULTS baseline. Other profiles ignore custom_thresholds.
        self.profile = get_profile(self.profile_key, custom_thresholds)

        trade_key    = os.getenv("ALPACA_PAPER_API_KEY" if self.paper else "ALPACA_LIVE_API_KEY")
        trade_secret = os.getenv("ALPACA_PAPER_SECRET_KEY" if self.paper else "ALPACA_LIVE_SECRET_KEY")
        data_key     = os.getenv("ALPACA_LIVE_API_KEY")
        data_secret  = os.getenv("ALPACA_LIVE_SECRET_KEY")

        self.trading_client = TradingClient(trade_key, trade_secret, paper=self.paper)
        self.option_client  = OptionHistoricalDataClient(data_key, data_secret)

        self.sentiment  = SentimentFilter()
        self.logger     = TradeLogger()
        self.notifier   = StrategyNotifier(self.logger.client)

        # Subscribe to the hub bar feed for this ticker (re-subscribe on ticker change).
        # Underlying bars + opening-range data now come from OrbService via the hub
        # instead of being fetched directly from Alpaca.
        if self._subscribed_ticker != self.ticker:
            if self._subscribed_ticker is not None:
                self._hub.unsubscribe(self._subscribed_ticker, self.on_bar)
                self._hub.unsubscribe(self._subscribed_ticker, self.on_breakout_confirmed)
            self._hub.subscribe_bar(self.ticker, self.on_bar)
            # Confirmed 3-min breakout from OrbService is the entry trigger.
            self._hub.subscribe_breakout(self.ticker, self.on_breakout_confirmed)
            self._subscribed_ticker = self.ticker

        # Tag every persisted debug row with this engine's identity.
        self.debug.set_context(strategy_id=self.strategy_id, ticker=self.ticker,
                               strategy_name=self.strategy_name)

        logger.info("[ORBEngine] Config applied — profile=%s ticker=%s paper=%s days=%s",
                    self.profile_key, self.ticker, self.paper, self.trade_days)
        self.debug.emit("INFO", f"Config applied — {self.ticker} {self.profile_key} "
                                f"paper={self.paper} days={sorted(self.trade_days)}")

    def reload_config(self, new_config: dict):
        self.config.update(new_config)
        self._apply_config()

    def _reset_session_state(self):
        self.orh              = None
        self.orl              = None
        self.orb_range        = None
        self.fib_levels       = {}
        self.position         = None
        self.contract_symbol  = None
        self.exit_manager     = None
        self.trade_taken      = False
        self.session_date     = None
        self.session_skipped  = False
        self.skip_reason      = None
        self.active_trade_id  = None
        self.trade_entry_time        = None   # used by 30-min timer notification
        self.timer_notified          = False  # ensures the 30-min update fires only once
        self.macro_today             = False  # True when a high-impact macro event is scheduled today
        self._current_option_price   = None   # latest mid-price from WebSocket stream
        self._last_underlying_price  = None   # latest underlying price from periodic poll
        self.session_vwap            = None   # intraday VWAP computed at ORB calc time
        # Fan-out queues for /ws/strategy/<id>/live WebSocket clients
        self._live_clients: list     = []
        self._live_clients_lock      = __import__("threading").Lock()

    def reset_session(self):
        if self.stream_manager and self.contract_symbol:
            self.stream_manager.unsubscribe(self.contract_symbol, self._on_stream_quote)
        self._reset_session_state()

    # ── Step 1: Called at 9:35 AM ET ──────────────────────────────────────────

    def calculate_orb(self) -> bool:
        """
        Fetch the opening-range bars, compute ORH/ORL/Fibonacci levels, and run
        all sentiment filters (VIX, macro events, premarket gap).

        NOTE: Called by the APScheduler cron job at 09:35 ET (scheduler.py).
        Returns True when the session is cleared for trading; False when skipped.
        """
        now_et = datetime.now(ET)
        self.session_date = now_et.date()

        # The OrbService bar feed must be running or there is no price data. If it
        # isn't (e.g. right after a redeploy, before the service has started),
        # return WITHOUT skipping or notifying so the session stays armed and
        # re-runs once the service comes up (init_scheduler late-start recovery).
        if not self._hub.is_service_running():
            logger.info("[ORBEngine] calculate_orb deferred — ORB service not running (%s)",
                        self.ticker)
            self.debug.emit("WARN", "calculate_orb deferred — ORB service not running "
                                    "(no price feed); session stays armed")
            return False

        self.debug.emit("INFO", f"calculate_orb start — {self.ticker} "
                                f"window=09:30–09:45 ({ORB_WINDOW_MINUTES}m)")

        if now_et.weekday() not in self.trade_days:
            self._skip("NOT_TRADE_DAY")
            return False

        if not self.config.get("active", True):
            self._skip("STRATEGY_DISABLED")
            return False

        bars = self._collect_orb_window_bars(ORB_WINDOW_MINUTES)
        if not bars:
            self._skip("NO_DATA")
            return False

        self.orh = max(b.high for b in bars)
        self.orl = min(b.low  for b in bars)
        self.orb_range = self.orh - self.orl
        mid = (self.orh + self.orl) / 2
        self.debug.emit("INFO", f"ORB window built from {len(bars)} bars — "
                                f"ORH={self.orh:.2f} ORL={self.orl:.2f} range={self.orb_range:.2f}")

        # Compute intraday VWAP from bars fetched so far.  Uses the same ORB bars
        # as a proxy; a price tick above this level favours CALLs, below favours PUTs.
        self.session_vwap = self._compute_vwap(bars)

        if self.orb_range / mid < MIN_ORB_RANGE_PCT:
            self._skip("ORB_RANGE_TOO_TIGHT")
            return False

        self.fib_levels = self._calculate_fib_levels()

        result = self.sentiment.check_all(
            ticker=self.ticker,
            vix_max=self.profile.get("vix_max_override", 30),
        )

        if not result["trade"]:
            self._skip(result["reason"])
            return False

        self.macro_today = result.get("macro_event", False)
        if self.macro_today:
            logger.info("[ORBEngine] Macro event today — proceeding with caution flag")
            self.debug.emit("WARN", "Macro event today — proceeding with caution flag")

        self.logger.log_session(
            ticker=self.ticker,
            session_date=self.session_date,
            orh=self.orh, orl=self.orl,
            orb_range=self.orb_range,
            vix=result["vix"],
            sentiment=result["sentiment"],
            profile=self.profile_key,
            strategy_id=self.strategy_id,
        )
        logger.info("[ORBEngine] ORB set — orh=%.2f orl=%.2f vix=%s sentiment=%s macro=%s",
                    self.orh, self.orl, result["vix"], result["sentiment"], self.macro_today)
        self.debug.emit("SUCCESS", f"ORB ready — armed for breakout. ORH={self.orh:.2f} "
                                   f"ORL={self.orl:.2f} VWAP={self.session_vwap}",
                        {"vix": result["vix"], "sentiment": result["sentiment"],
                         "fib_levels": {k: round(v, 2) for k, v in self.fib_levels.items()}})
        return True

    # ── Step 2: Called every minute after ORB is set ──────────────────────────

    def on_price_tick(self, current_price: float, current_volume: float = None,
                     current_option_price: float = None):
        """
        Main decision loop: checks breakout conditions before entry or delegates
        to ExitManager once a position is open.

        current_price         — underlying stock price (always available)
        current_option_price  — live option mid-price (bid+ask)/2; None if fetch failed.
                                ExitManager uses this for the premium-based hard stop.

        NOTE: Called from on_bar (hub bar push) and from _on_stream_quote (option
        stream thread). The lock serializes these callers to prevent a double entry.
        """
        with self._tick_lock:
            self._process_tick(current_price, current_volume, current_option_price)

    def _process_tick(self, current_price: float, current_volume: float = None,
                      current_option_price: float = None):
        if self.session_skipped:
            return

        now_et = datetime.now(ET)
        total_min = 9 * 60 + 30 + ORB_WINDOW_MINUTES
        orb_close = now_et.replace(hour=total_min // 60, minute=total_min % 60, second=0,
                                   microsecond=0)
        limit_min = self.profile.get("breakout_time_limit_min", 45)
        deadline  = orb_close + timedelta(minutes=limit_min)

        if not self.trade_taken and not self.bypass_breakout_window and now_et > deadline:
            self._skip("BREAKOUT_TIME_LIMIT_EXCEEDED")
            return

        # NOTE: Breakout *entry* detection no longer lives here. Entries are driven
        # solely by OrbService's confirmed 3-min breakout via on_breakout_confirmed.
        # This loop now only manages exits once a position is open (below) and the
        # pre-entry time-limit skip (above).
        if self.trade_taken and self.exit_manager:
            if current_option_price is None:
                logger.warning(
                    "[ORBEngine] Skipping exit evaluation for %s — option price unavailable",
                    self.ticker,
                )
                return
            action = self.exit_manager.evaluate(
                current_option_price=current_option_price,
                current_underlying_price=current_price,
                current_volume=current_volume,
            )
            self._handle_exit_action(action, current_price, current_option_price)

            # 30-minute P&L notification (fires once per trade)
            if (
                not self.timer_notified
                and self.trade_entry_time is not None
                and (now_et - self.trade_entry_time).total_seconds() >= 1800
            ):
                entry_p = self.exit_manager.entry_premium
                pnl     = (current_option_price - entry_p) * self.exit_manager.qty_remaining * 100
                self.notifier.notify_timer_update(
                    ticker=self.ticker,
                    contract_symbol=self.contract_symbol,
                    current_pnl=pnl,
                    entry_premium=entry_p,
                    current_premium=current_option_price,
                )
                self.timer_notified = True
            return

    # ── Service-driven entry ─────────────────────────────────────────────────────

    def on_breakout_confirmed(self, direction: str, price: float):
        """
        Hub callback: OrbService confirmed a 3-minute breakout for this ticker.
        This is the sole entry trigger. The engine enters using its OWN ORB / fib /
        VWAP (from calculate_orb); the service only supplies the GO + direction +
        confirming price. Guarded so a missed/duplicate signal can't double-enter.

        direction — "CALL" (above ORH) | "PUT" (below ORL)
        price     — the confirming underlying tick from OrbService.

        NOTE: Invoked on the OrbService asyncio-loop thread; serialized with the
        bar/option-stream callers via self._tick_lock.
        """
        with self._tick_lock:
            self.debug.emit("INFO", f"Confirmed {direction} breakout received from "
                                    f"OrbService @ {price:.2f}")

            if self.trade_taken:
                self.debug.emit("WARN", "Ignoring confirmed breakout — trade already taken")
                return
            if self.session_skipped:
                self.debug.emit("WARN", f"Ignoring confirmed breakout — session skipped "
                                        f"({self.skip_reason})")
                return
            if not self.orh or not self.orl:
                self.debug.emit("WARN", "Ignoring confirmed breakout — engine ORB not set "
                                        "(calculate_orb did not run/produce a range)")
                return

            now_et = datetime.now(ET)
            if now_et.weekday() not in self.trade_days:
                self.debug.emit("WARN", "Ignoring confirmed breakout — not a trade day")
                return

            # Honor the post-ORB time limit unless bypassed.
            total_min = 9 * 60 + 30 + ORB_WINDOW_MINUTES
            orb_close = now_et.replace(hour=total_min // 60, minute=total_min % 60,
                                       second=0, microsecond=0)
            limit_min = self.profile.get("breakout_time_limit_min", 45)
            deadline  = orb_close + timedelta(minutes=limit_min)
            if not self.bypass_breakout_window and now_et > deadline:
                self.debug.emit("WARN", "Ignoring confirmed breakout — past breakout time limit")
                self._skip("BREAKOUT_TIME_LIMIT_EXCEEDED")
                return

            logger.info("[ORBEngine] Confirmed %s breakout for %s @ %.2f — entering",
                        direction, self.ticker, price)
            self.debug.emit("INFO", f"Entry conditions clear — running entry pipeline for "
                                    f"{direction}")
            self._enter_trade(direction, price)

    # ── Entry ──────────────────────────────────────────────────────────────────

    def _enter_trade(self, direction: str, trigger_price: float):
        """
        Run flow confirmation, select a contract, validate buying power, and
        submit a market order via Alpaca.  Sets trade state and initialises
        ExitManager on success.

        NOTE: Called by on_price_tick when price closes above ORH (CALL) or
        below ORL (PUT) for the first time in the session.
        """
        uw_key = os.getenv("UNUSUAL_WHALES_KEY")
        if not self.sentiment.confirm_with_flow(self.ticker, direction, uw_key):
            logger.info("[ORBEngine] Flow confirmation failed for %s %s — skipping entry",
                        self.ticker, direction)
            self.debug.emit("ERROR", f"Entry blocked — flow confirmation failed ({direction})")
            self.notifier.notify_flow_blocked(self.ticker, direction)
            return
        self.debug.emit("INFO", f"Flow confirmed for {direction}")

        # VWAP soft confirmation (log only — does not block entry)
        if self.session_vwap is not None:
            vwap_confirmed = (
                (direction == "CALL" and trigger_price > self.session_vwap) or
                (direction == "PUT"  and trigger_price < self.session_vwap)
            )
            if not vwap_confirmed:
                logger.warning(
                    "[ORBEngine] VWAP misalignment: %s %s price=%.2f vwap=%.2f"
                    " — proceeding anyway",
                    self.ticker, direction, trigger_price, self.session_vwap,
                )

        contract = select_contract(
            ticker=self.ticker,
            direction=direction,
            trigger_price=trigger_price,
            orh=self.orh,
            orl=self.orl,
            fib_levels=self.fib_levels,
            data_client=self.option_client,
            profile=self.profile,
            vwap=self.session_vwap,
        )

        if not contract:
            logger.warning("[ORBEngine] No suitable contract found — skipping entry")
            self.debug.emit("ERROR", "Entry blocked — no suitable 0DTE contract found")
            self.notifier.notify_no_contract(self.ticker)
            return
        self.debug.emit("INFO", f"Contract selected — {contract['symbol']} "
                                f"strike={contract['strike']} ask={contract['ask']:.2f}")

        qty = self.profile["qty_contracts"]
        effective_profile = self.profile  # may be replaced by budget OTM override

        # Capital guard: reduce qty if buying power is insufficient, skip if unaffordable
        ask = contract["ask"]
        acct = self.get_account_info()
        if acct:
            required = qty * ask * 100
            buying_power = acct["buying_power"]
            if required > buying_power:
                affordable = int(buying_power / (ask * 100))
                if affordable < 1:
                    if self.budget_otm_mode:
                        # Retry with a cheaper OTM contract anchored to a fib extension
                        import copy
                        budget_max_ask = buying_power / 100  # max premium for 1 contract
                        logger.info(
                            "[ORBEngine] Budget OTM retry — fib=%s max_ask=%.2f",
                            self.otm_fib_level, budget_max_ask,
                        )
                        contract = select_contract(
                            ticker=self.ticker,
                            direction=direction,
                            trigger_price=trigger_price,
                            orh=self.orh,
                            orl=self.orl,
                            fib_levels=self.fib_levels,
                            data_client=self.option_client,
                            profile=self.profile,
                            vwap=self.session_vwap,
                            budget_mode=True,
                            budget_max_ask=budget_max_ask,
                            budget_fib_level=self.otm_fib_level,
                        )
                        if not contract:
                            logger.warning("[ORBEngine] Budget OTM: no affordable contract — skipping")
                            self.debug.emit("ERROR", "Entry blocked — budget OTM: no affordable "
                                                     f"contract (have ${buying_power:.0f})")
                            self.notifier.notify_insufficient_capital(
                                self.ticker, required, buying_power
                            )
                            return
                        ask = contract["ask"]
                        qty = max(1, int(buying_power / (ask * 100)))
                        # Tighter hard stop for deeper OTM — faster premium decay
                        _OTM_STOP = {"1.0": 0.45, "1.618": 0.55, "2.618": 0.65}
                        effective_profile = copy.copy(self.profile)
                        effective_profile["max_loss_pct"] = _OTM_STOP.get(self.otm_fib_level, 0.45)
                        logger.info(
                            "[ORBEngine] Budget OTM — %s ask=%.2f qty=%d stop=%.0f%%",
                            contract["symbol"], ask, qty,
                            effective_profile["max_loss_pct"] * 100,
                        )
                    else:
                        logger.warning(
                            "[ORBEngine] Insufficient capital — need $%.0f, have $%.0f",
                            required, buying_power,
                        )
                        self.debug.emit("ERROR", f"Entry blocked — insufficient capital "
                                                 f"(need ${required:.0f}, have ${buying_power:.0f})")
                        self.notifier.notify_insufficient_capital(
                            self.ticker, required, buying_power
                        )
                        return
                else:
                    logger.info(
                        "[ORBEngine] Reducing qty %d→%d (buying_power=$%.0f, cost/contract=$%.0f)",
                        qty, affordable, buying_power, ask * 100,
                    )
                    qty = affordable

        # Verify real-time stream BEFORE placing the order.
        # If the symbol can't be streamed we refuse to enter — a trade without
        # real-time pricing is effectively blind (stop-losses won't fire promptly).
        if self.stream_manager:
            symbol_to_verify = contract["symbol"]
            logger.info("[ORBEngine] Verifying stream for %s ...", symbol_to_verify)
            if not self.stream_manager.verify_stream(symbol_to_verify, timeout=8.0):
                logger.warning("[ORBEngine] Stream unavailable for %s — trade skipped",
                               symbol_to_verify)
                self.debug.emit("ERROR", f"Entry blocked — stream unavailable for {symbol_to_verify}")
                self.notifier.notify_stream_failed(self.ticker, symbol_to_verify)
                return

        self._execute_entry(direction, contract, qty, effective_profile, self.fib_levels)

    def _execute_entry(self, direction: str, contract: dict, qty: int,
                       effective_profile: dict, fib_levels: dict, manual: bool = False):
        """
        Submit the market order, set trade state, initialise ExitManager, log and
        notify. Shared by the auto path (_enter_trade) and the manual conviction
        path (submit_manual_trade). Assumes capital/stream checks already passed.
        """
        try:
            order = MarketOrderRequest(
                symbol=contract["symbol"],
                qty=qty,
                side=OrderSide.BUY,
                time_in_force=TimeInForce.DAY
            )
            self.trading_client.submit_order(order)

            self.position         = direction
            self.contract_symbol  = contract["symbol"]
            self.trade_taken      = True
            self.trade_entry_time = datetime.now(ET)
            self.timer_notified   = False
            self.session_date     = self.session_date or datetime.now(ET).date()

            eod_time = EOD_CLOSE_TIMES.get(self.ticker, "15:10")
            self.exit_manager = ExitManager(
                entry_premium=contract["ask"],
                qty=qty,
                fib_levels=fib_levels,
                direction=direction,
                eod_close_time=eod_time,
                profile=effective_profile,
            )

            self.active_trade_id = self.logger.log_entry(
                ticker=self.ticker,
                direction=direction,
                contract=contract,
                entry_premium=contract["ask"],
                orh=fib_levels.get("orh"), orl=fib_levels.get("orl"),
                fib_levels=fib_levels,
                session_date=self.session_date,
                profile=self.profile_key,
                qty=qty,
            )
            self.notifier.notify_entry(
                ticker=self.ticker,
                direction=direction,
                contract=contract,
                qty=qty,
                entry_premium=contract["ask"],
                trade_id=self.active_trade_id,
                profile_key=self.profile_key,
                macro_event=self.macro_today,
            )
            # Subscribe to real-time option quotes now that the position is open
            if self.stream_manager:
                self.stream_manager.subscribe(contract["symbol"], self._on_stream_quote)

            logger.info("[ORBEngine] Entered %s %s qty=%d @ %.2f (manual=%s)",
                        direction, contract["symbol"], qty, contract["ask"], manual)
            self.debug.emit("SUCCESS", f"{'MANUAL ' if manual else ''}ENTERED {direction} "
                                       f"{contract['symbol']} qty={qty} @ {contract['ask']:.2f}")
        except Exception as e:
            logger.error("[ORBEngine] Order failed: %s", e)
            self.debug.emit("ERROR", f"Order submission failed: {e}")
            raise

    # ── Manual / conviction entry ───────────────────────────────────────────────

    def submit_manual_trade(self, direction: str, contract_symbol: str,
                            qty: int | None = None, profile_key: str | None = None) -> dict:
        """
        Immediately submit a conviction trade for a user-chosen 0DTE contract,
        skipping the breakout wait / sentiment / flow filters. Exits are managed
        by the chosen profile (premium-based TP/SL), exactly like an auto trade.

        Returns {"status": "ok"|"error", "message": ...}. Called by the
        POST /strategy/configs/<id>/immediate-trade route.
        """
        direction = (direction or "").upper()
        if direction not in ("CALL", "PUT"):
            return {"status": "error", "message": "direction must be CALL or PUT"}
        if self.trade_taken:
            return {"status": "error",
                    "message": "A position is already open for this strategy"}

        effective_profile = self.profile
        if profile_key and profile_key != self.profile_key:
            try:
                effective_profile = get_profile(profile_key, self.config.get("custom_thresholds"))
            except Exception:
                return {"status": "error", "message": f"Unknown profile {profile_key}"}

        qty = int(qty) if qty else effective_profile["qty_contracts"]
        self.debug.emit("INFO", f"Manual trade requested — {direction} {contract_symbol} "
                                f"qty={qty} profile={profile_key or self.profile_key}")

        # Resolve the chosen contract's live quote + metadata.
        contract = self._resolve_contract(contract_symbol, direction)
        if not contract:
            self.debug.emit("ERROR", f"Manual trade blocked — could not price {contract_symbol}")
            return {"status": "error", "message": f"Could not fetch a quote for {contract_symbol}"}

        # Use the engine's ORB/fib if armed, else synthesize from the underlying so
        # ExitManager (premium-based) has the orh/orl + fib targets it expects.
        if self.orh and self.orl and self.fib_levels:
            fib_levels = self.fib_levels
        else:
            anchor = self._last_underlying_price or contract["strike"]
            fib_levels = self._synthetic_fib_levels(anchor)

        # Capital guard (reduce qty / block) — reuse the same affordability math.
        ask = contract["ask"]
        acct = self.get_account_info()
        if acct:
            buying_power = acct["buying_power"]
            required = qty * ask * 100
            if required > buying_power:
                affordable = int(buying_power / (ask * 100))
                if affordable < 1:
                    msg = f"Insufficient capital — need ${required:.0f}, have ${buying_power:.0f}"
                    self.debug.emit("ERROR", f"Manual trade blocked — {msg}")
                    return {"status": "error", "message": msg}
                self.debug.emit("WARN", f"Manual trade — reducing qty {qty}→{affordable} (capital)")
                qty = affordable

        # Verify the option can be streamed (same blind-trade guard as auto entry).
        if self.stream_manager:
            if not self.stream_manager.verify_stream(contract["symbol"], timeout=8.0):
                msg = f"Real-time stream unavailable for {contract['symbol']}"
                self.debug.emit("ERROR", f"Manual trade blocked — {msg}")
                return {"status": "error", "message": msg}

        try:
            self._execute_entry(direction, contract, qty, effective_profile, fib_levels,
                                manual=True)
        except Exception as e:
            return {"status": "error", "message": f"Order submission failed: {e}"}
        return {"status": "ok", "message": f"Entered {direction} {contract['symbol']} qty={qty}",
                "contract": contract["symbol"], "qty": qty, "trade_id": self.active_trade_id}

    def _resolve_contract(self, contract_symbol: str, direction: str) -> dict | None:
        """
        Build a contract dict ({symbol, strike, expiry, ask, bid}) for a chosen
        option symbol by fetching its latest quote. Strike/expiry are parsed from
        the OCC symbol so a trade can be logged without a chain lookup.
        """
        try:
            from alpaca.data.requests import OptionLatestQuoteRequest
            quotes = self.option_client.get_option_latest_quote(
                OptionLatestQuoteRequest(symbol_or_symbols=contract_symbol)
            )
            quote = quotes.get(contract_symbol)
            if not quote or not quote.ask_price:
                return None
            strike, expiry = self._parse_occ_symbol(contract_symbol)
            return {
                "symbol": contract_symbol,
                "strike": strike,
                "expiry": expiry,
                "ask":    float(quote.ask_price),
                "bid":    float(quote.bid_price or 0),
            }
        except Exception as e:
            logger.error("[ORBEngine] _resolve_contract failed for %s: %s", contract_symbol, e)
            return None

    @staticmethod
    def _parse_occ_symbol(symbol: str) -> tuple:
        """Parse strike (float) and expiry (YYYY-MM-DD) from an OCC option symbol.
        Format: <ROOT><YYMMDD><C|P><strike*1000, 8 digits>. Falls back to (0.0, today).
        """
        from datetime import date as _date
        try:
            body = symbol[-15:]                       # YYMMDD + C/P + 8-digit strike
            yy, mm, dd = body[0:2], body[2:4], body[4:6]
            strike = int(body[7:15]) / 1000.0
            expiry = f"20{yy}-{mm}-{dd}"
            return strike, expiry
        except Exception:
            return 0.0, str(_date.today())

    def _synthetic_fib_levels(self, anchor: float) -> dict:
        """
        Build a minimal fib_levels dict for a manual trade with no real ORB. Uses a
        small symmetric band around the underlying so ExitManager (which only reads
        orh/orl) and the trade log have sane values. Exits remain premium-based.
        """
        band = max(anchor * 0.002, 0.05)              # ~0.2% band, floored
        orh, orl = anchor + band, anchor - band
        r = orh - orl
        return {
            "up_1.0": orh + r, "up_1.618": orh + r * 1.618, "up_2.618": orh + r * 2.618,
            "dn_1.0": orl - r, "dn_1.618": orl - r * 1.618, "dn_2.618": orl - r * 2.618,
            "mid": anchor, "orh": orh, "orl": orl,
        }

    # ── Exit ───────────────────────────────────────────────────────────────────

    def _handle_exit_action(self, action: dict, current_price: float,
                            current_option_price: float = None):
        """
        Execute a full or partial close based on the action dict returned by
        ExitManager.evaluate().  Updates qty_remaining and logs the exit.

        current_option_price is used for accurate P&L when available; falls back
        to action["current_premium"] then current_price (underlying) as last resort.

        NOTE: Called by on_price_tick immediately after ExitManager.evaluate().
        """
        if not action or action["type"] == "HOLD":
            return

        qty_to_close = action.get("qty", self.exit_manager.qty_remaining)
        closing_all  = qty_to_close >= self.exit_manager.qty_remaining
        try:
            if closing_all:
                self.trading_client.close_position(self.contract_symbol)
                self.exit_manager.qty_remaining = 0
                self.trade_taken = False
                self.position    = None
                # Unsubscribe from the option stream — position is fully closed
                if self.stream_manager and self.contract_symbol:
                    self.stream_manager.unsubscribe(self.contract_symbol, self._on_stream_quote)
            else:
                order = MarketOrderRequest(
                    symbol=self.contract_symbol,
                    qty=qty_to_close,
                    side=OrderSide.SELL,
                    time_in_force=TimeInForce.DAY,
                )
                self.trading_client.submit_order(order)
                self.exit_manager.qty_remaining -= qty_to_close

            # Prefer the action's own premium (set by ExitManager), then live option
            # price, then underlying as a last fallback for P&L logging accuracy
            exit_premium = (action.get("current_premium")
                            or current_option_price
                            or current_price)
            entry_p = self.exit_manager.entry_premium if self.exit_manager else 0
            pnl = (exit_premium - entry_p) * qty_to_close * 100

            self.logger.log_exit(
                contract_symbol=self.contract_symbol,
                exit_reason=action["reason"],
                exit_premium=exit_premium,
                qty_closed=qty_to_close,
                profile=self.profile_key,
                strategy_id=self.strategy_id,
            )
            self.notifier.notify_exit(
                ticker=self.ticker,
                contract_symbol=self.contract_symbol,
                exit_reason=action["reason"],
                pnl=pnl,
                qty=qty_to_close,
                profile_key=self.profile_key,
            )
            logger.info("[ORBEngine] Exit %s qty=%d reason=%s",
                        action["type"], qty_to_close, action.get("reason", ""))
            self.debug.emit("SUCCESS", f"Exit {action['type']} qty={qty_to_close} "
                                       f"reason={action.get('reason', '')} pnl=${pnl:.2f}")
        except Exception as e:
            logger.error("[ORBEngine] Exit failed: %s", e)
            self.debug.emit("ERROR", f"Exit failed: {e}")

    def submit_manual_exit(self, qty: int | None = None) -> dict:
        """
        Manually sell `qty` contracts of the open position right now (default: all
        remaining). Reuses the same close path as automated exits — partial sells
        submit a SELL order and decrement qty_remaining; a full sell closes the
        position, unsubscribes the option stream, and resets the session.

        Called by POST /strategy/positions/<id>/sell. Returns
        {"status": "ok"|"error", "message", "qty_sold"?, "qty_remaining"?}.
        """
        with self._tick_lock:
            if not self.trade_taken or not self.contract_symbol or not self.exit_manager:
                return {"status": "error", "message": "No active position to sell"}

            remaining_before = self.exit_manager.qty_remaining
            if remaining_before <= 0:
                return {"status": "error", "message": "Position is already closed"}

            want = remaining_before if qty is None else int(qty)
            want = max(1, min(want, remaining_before))
            contract = self.contract_symbol

            self.debug.emit("INFO", f"Manual exit requested — sell {want}/{remaining_before} "
                                    f"of {contract}")
            action = {"type": "MANUAL_SELL", "reason": "MANUAL_EXIT", "qty": want}
            self._handle_exit_action(action, self._last_underlying_price or 0.0,
                                     self._get_option_price())

            still_open    = bool(self.trade_taken and self.exit_manager)
            new_remaining = self.exit_manager.qty_remaining if self.exit_manager else 0
            # _handle_exit_action swallows order errors; detect a no-op as a failure.
            if still_open and new_remaining == remaining_before:
                return {"status": "error", "message": "Sell order failed — check server logs"}

            closed_all = not still_open
            if closed_all:
                self.reset_session()
            return {
                "status":        "ok",
                "message":       f"Sold {want} contract(s) of {contract}",
                "qty_sold":      want,
                "qty_remaining": 0 if closed_all else new_remaining,
            }

    def _on_stream_quote(self, mid: float):
        """
        Callback invoked by OptionStreamManager on every bid/ask update.

        Drives exit logic with the real-time option price and fans out to
        any connected /ws/strategy/<id>/live WebSocket clients.

        NOTE: Called from the OptionDataStream background thread — must be
        thread-safe and non-blocking.
        """
        import json as _json
        self._current_option_price = mid

        # Drive exit logic using the latest cached underlying price
        underlying = self._last_underlying_price or mid
        self.on_price_tick(current_price=underlying, current_option_price=mid)

        # Push live P&L to any connected WebSocket clients
        if not self.trade_taken or not self.exit_manager:
            return
        em = self.exit_manager
        entry_p = em.entry_premium or 0
        pnl     = (mid - entry_p) * em.qty_remaining * 100
        pnl_pct = ((mid - entry_p) / entry_p * 100) if entry_p > 0 else 0
        payload = _json.dumps({
            "type":          "price_update",
            "contract":      self.contract_symbol,
            "mid_price":     round(mid, 4),
            "entry_premium": round(entry_p, 4),
            "pnl":           round(pnl, 2),
            "pnl_pct":       round(pnl_pct, 2),
            "qty_remaining": em.qty_remaining,
            "tp1_hit":       em.tp1_hit,
            "tp2_hit":       em.tp2_hit,
            "hard_stop":     round(em.hard_stop, 4),
            "tp1":           round(em.tp1, 4),
            "tp2":           round(em.tp2, 4),
        })
        with self._live_clients_lock:
            for q in list(self._live_clients):
                try:
                    q.put_nowait(payload)
                except Exception:
                    pass

    # Skip reasons that are data/lifecycle artifacts (no price feed) rather than a
    # real "we had data but chose not to trade" decision. These never notify — they
    # spam the user on every redeploy after the ORB window.
    _SILENT_SKIP_REASONS = frozenset({"NO_DATA"})

    def _skip(self, reason: str):
        """
        Mark the session as skipped with a reason code and persist to Supabase.

        NOTE: Called by calculate_orb and on_price_tick whenever a filter or
        time-limit condition prevents trading for the rest of the session.
        """
        self.session_skipped = True
        self.skip_reason = reason
        self.logger.log_skip(self.ticker, reason, self.session_date, self.profile_key,
                             strategy_id=self.strategy_id)
        # Suppress the push when (a) the bar feed is down — the skip is an artifact of
        # the outage, not a trading decision — or (b) the reason is a data/lifecycle
        # artifact (NO_DATA). Otherwise notify as normal.
        if not self._hub.is_service_running():
            logger.info("[ORBEngine] Suppressing skip notification (%s) — service not running",
                        reason)
        elif reason in self._SILENT_SKIP_REASONS:
            logger.info("[ORBEngine] Suppressing skip notification (%s) — data artifact", reason)
        else:
            self.notifier.notify_skip(self.ticker, reason)
        logger.info("[ORBEngine] Session skipped: %s", reason)
        self.debug.emit("WARN", f"Session skipped: {reason}")

    # ── Data helpers ───────────────────────────────────────────────────────────

    @staticmethod
    def _compute_vwap(bars) -> float | None:
        """
        VWAP = Σ(close × volume) / Σ(volume) over the provided bars.
        Returns None when bars are empty or total volume is zero.
        """
        try:
            total_pv = sum(b.close * b.volume for b in bars if b.volume)
            total_v  = sum(b.volume           for b in bars if b.volume)
            return round(total_pv / total_v, 4) if total_v > 0 else None
        except Exception:
            return None

    def on_bar(self, bar: OrbBar):
        """
        Hub callback: a new underlying bar arrived for this ticker.

        Caches the latest underlying price and, once the opening range is set,
        drives the per-bar decision loop. The option price comes from the live
        stream (_current_option_price) or a REST fallback so exits can evaluate
        even without an active option stream.

        NOTE: Invoked on the OrbService asyncio-loop thread. on_price_tick is
        thread-safe (self._tick_lock).
        """
        if bar.close is None:
            return
        self._last_underlying_price = bar.close

        # Only act once the ORB is established and the session isn't skipped.
        # getattr guards the brief __init__ window before _reset_session_state runs.
        if not getattr(self, "orh", None) or getattr(self, "session_skipped", False):
            return

        self.on_price_tick(
            current_price=bar.close,
            current_volume=bar.volume,
            current_option_price=self._get_option_price(),
        )

    def _collect_orb_window_bars(self, n_minutes: int):
        """
        Build the opening-range bars from the hub's recent-bar buffer: the first
        n_minutes of bars from 09:30 ET. The service streams these bars; the engine
        windows them over the fixed 09:30–09:45 ORB window (no separate data fetch).

        NOTE: Called by calculate_orb. Returns [] when no in-window bars are
        available (e.g. a server restart after the window), yielding NO_DATA.
        """
        now_et = datetime.now(ET)
        start  = now_et.replace(hour=9, minute=30, second=0, microsecond=0)
        end    = start + timedelta(minutes=n_minutes)
        bars = []
        for b in self._hub.get_recent_bars(self.ticker):
            ts = b.ts
            if ts.tzinfo is None:
                ts = ET.localize(ts)
            else:
                ts = ts.astimezone(ET)
            if start <= ts < end and b.high is not None and b.low is not None:
                bars.append(b)
        if not bars:
            logger.warning("[ORBEngine] No hub bars in ORB window for %s (%s–%s)",
                           self.ticker, start.time(), end.time())
        return bars

    def _get_option_price(self) -> float | None:
        """
        Return the current option mid-price: prefer the live stream value, else a
        REST quote fallback when a position is open and the stream is unavailable.
        """
        if self._current_option_price is not None:
            return self._current_option_price
        if not self.contract_symbol:
            return None
        try:
            from alpaca.data.requests import OptionLatestQuoteRequest
            oreq   = OptionLatestQuoteRequest(symbol_or_symbols=self.contract_symbol)
            quotes = self.option_client.get_option_latest_quote(oreq)
            quote  = quotes.get(self.contract_symbol)
            if quote and quote.ask_price and quote.bid_price:
                return (quote.ask_price + quote.bid_price) / 2
        except Exception as oe:
            logger.debug("[ORBEngine] option quote REST fallback failed: %s", oe)
        return None

    def unsubscribe_data(self):
        """
        Detach this engine from the hub bar feed. Called when the strategy is
        deleted so the hub doesn't retain a stale callback (and the engine can
        be garbage-collected).
        """
        if self._subscribed_ticker is not None:
            self._hub.unsubscribe(self._subscribed_ticker, self.on_bar)
            self._hub.unsubscribe(self._subscribed_ticker, self.on_breakout_confirmed)
            self._subscribed_ticker = None

    def _calculate_fib_levels(self) -> dict:
        """
        Compute Fibonacci extension targets from the ORB high/low.

        NOTE: Called once by calculate_orb after ORH and ORL are established.
        Levels are stored on the engine and passed to ExitManager and the trade log.
        """
        r = self.orb_range
        return {
            "up_1.0":   self.orh + r * 1.0,
            "up_1.618": self.orh + r * 1.618,
            "up_2.618": self.orh + r * 2.618,
            "dn_1.0":   self.orl - r * 1.0,
            "dn_1.618": self.orl - r * 1.618,
            "dn_2.618": self.orl - r * 2.618,
            "mid":      (self.orh + self.orl) / 2,
            "orh":      self.orh,
            "orl":      self.orl,
        }

    def get_account_info(self) -> dict | None:
        """
        Return a snapshot of the active Alpaca account (equity, cash, buying
        power, day-trade count, today's P&L).

        NOTE: Called by strategy_routes.py /account endpoint and by _enter_trade
        to validate buying power before order submission.
        """
        try:
            acct = self.trading_client.get_account()
            return {
                "equity":             float(acct.equity),
                "cash":               float(acct.cash),
                "buying_power":       float(acct.buying_power),
                "day_trade_count":    acct.daytrade_count,
                "pnl_today":          float(acct.equity) - float(acct.last_equity),
                "pnl_today_pct":      ((float(acct.equity) - float(acct.last_equity))
                                       / float(acct.last_equity) * 100)
                                      if float(acct.last_equity) > 0 else 0,
                "paper_mode":         self.paper,
            }
        except Exception as e:
            logger.error("[ORBEngine] get_account_info failed: %s", e)
            return None

    def session_state(self) -> dict:
        """
        Serialise the full in-memory session state for the /session API endpoint.

        NOTE: Called by strategy_routes.py GET /strategy/session on demand.
        """
        em = self.exit_manager
        return {
            "date":                       str(self.session_date),
            "ticker":                     self.ticker,
            "profile":                    self.profile_key,
            "trade_days":                 list(self.trade_days),
            "paper_mode":                 self.paper,
            "debug_mode":                 self.debug_enabled,
            "orh":                        self.orh,
            "orl":                        self.orl,
            "orb_range":                  self.orb_range,
            "fib_levels":                 self.fib_levels,
            "trade_taken":                self.trade_taken,
            "session_skipped":            self.session_skipped,
            "skip_reason":                self.skip_reason,
            "position":                   self.position,
            "contract":                   self.contract_symbol,
            "exit_state":                 em.to_dict() if em else None,
        }
