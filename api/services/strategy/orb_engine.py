"""
Profile-aware ORB trading engine.

Config is loaded from Supabase at startup and hot-reloaded when the frontend
POSTs to /strategy/config. Paper vs live trading is set by paper_mode in config.
"""

import os
import uuid as _uuid
import logging
import threading
import pytz
from datetime import datetime, timedelta
from typing import Optional

from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.data.historical import OptionHistoricalDataClient, StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame

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
    "exit_overrides":          None,
    "budget_otm_mode":         False,
    "otm_fib_level":           "1.0",
    "debug_mode":              False,
    "smart_contracts":         False,
    "flow_gate_enabled":       True,   # False = flow is informational only, never blocks entry
    "id":                      None,
}

VIX_MIN = 13.0
MIN_ORB_RANGE_PCT = 0.0005

EOD_CLOSE_TIMES = {
    # ETF options (SPY, IWM, QQQ) stop trading at 4:00 PM ET.
    # 15:58 gives a 2-minute window to route and fill the EOD market order before close.
    "SPY": "15:58",
    "QQQ": "15:58",
    "IWM": "15:58",
}
# NOTE: The EOD close fires inside evaluate() which only runs when a price tick
# arrives. If the option stream goes quiet near 15:58 (thin late-day liquidity,
# dropped WebSocket), the flatten may not fire. A scheduled hard-flatten job
# at 15:58 independent of the tick loop is the correct long-term fix (TODO).


class ORBEngine:
    def __init__(self, config: dict = None, stream_manager=None, hub=None):
        self.config = config or STRATEGY_DEFAULTS.copy()
        self._stream_manager_ref = stream_manager
        # ORB data hub — bars + ORB status are pushed here by OrbService.
        self._hub = hub or get_orb_data_hub()
        self._subscribed_ticker = None        # ticker currently subscribed on the hub
        self._subscription_type = None        # "breakout" | "reversal" — tracks active channel
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
        self.smart_contracts         = self.config.get("smart_contracts", False)
        self.debug_enabled           = self.config.get("debug_mode", False)
        self.flow_gate_enabled       = self.config.get("flow_gate_enabled", True)
        custom_thresholds            = self.config.get("custom_thresholds")
        exit_overrides               = self.config.get("exit_overrides")
        self.stream_manager          = getattr(self, "_stream_manager_ref", None)

        # CUSTOM profile: merge stored thresholds over CUSTOM_DEFAULTS.
        # All other profiles: apply only the consol_exit/volume_exit keys from
        # exit_overrides (a sparse {consol_exit, volume_exit} dict) — custom_thresholds
        # is left null so it doesn't pollute the Supabase JSONB column.
        if self.profile_key == "CUSTOM":
            self.profile = get_profile(self.profile_key, custom_thresholds)
        else:
            self.profile = get_profile(self.profile_key, exit_overrides)

        trade_key    = os.getenv("ALPACA_PAPER_API_KEY" if self.paper else "ALPACA_LIVE_API_KEY")
        trade_secret = os.getenv("ALPACA_PAPER_SECRET_KEY" if self.paper else "ALPACA_LIVE_SECRET_KEY")
        data_key     = os.getenv("ALPACA_LIVE_API_KEY")
        data_secret  = os.getenv("ALPACA_LIVE_SECRET_KEY")

        self.trading_client = TradingClient(trade_key, trade_secret, paper=self.paper)
        self.option_client  = OptionHistoricalDataClient(data_key, data_secret)
        self.stock_client   = StockHistoricalDataClient(data_key, data_secret)

        self.sentiment  = SentimentFilter()
        self.logger     = TradeLogger()
        self.notifier   = StrategyNotifier(self.logger.client)

        # Subscribe to the hub bar feed for this ticker (re-subscribe on ticker or
        # profile-type change). REVERSAL-profile engines listen on the reversal
        # channel; all others listen on the regular breakout channel.
        is_reversal_profile = self.profile_key == "REVERSAL"
        new_sub_type = "reversal" if is_reversal_profile else "breakout"
        if self._subscribed_ticker != self.ticker or self._subscription_type != new_sub_type:
            if self._subscribed_ticker is not None:
                self._hub.unsubscribe(self._subscribed_ticker, self.on_bar)
                if self._subscription_type == "reversal":
                    self._hub.unsubscribe(self._subscribed_ticker, self.on_reversal_confirmed)
                else:
                    self._hub.unsubscribe(self._subscribed_ticker, self.on_breakout_confirmed)
            self._hub.subscribe_bar(self.ticker, self.on_bar)
            if is_reversal_profile:
                self._hub.subscribe_reversal(self.ticker, self.on_reversal_confirmed)
            else:
                self._hub.subscribe_breakout(self.ticker, self.on_breakout_confirmed)
            self._subscribed_ticker = self.ticker
            self._subscription_type = new_sub_type

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
        self.trade_taken           = False
        self._trade_was_taken_today = False  # stays True all day once any entry executes
        self.session_date          = None
        self.session_skipped       = False
        self.skip_reason           = None
        self.active_trade_id  = None
        self.trade_entry_time        = None   # used by 30-min timer notification
        self.timer_notified          = False  # ensures the 30-min update fires only once
        self.macro_today             = False  # True when a high-impact macro event is scheduled today
        self._current_option_price   = None   # latest mid-price from WebSocket stream
        self._last_underlying_price  = None   # latest underlying price from periodic poll
        self.session_vwap            = None   # intraday VWAP computed at ORB calc time
        self.vix                     = None   # VIX at session open, set in calculate_orb
        # Retest-entry state (used when profile entry_mode == "RETEST")
        self._awaiting_retest      = False
        self._retest_direction     = None
        self._retest_level         = None   # ORH for CALL, ORL for PUT
        self._retest_max_dist      = 0.0    # max extension past level (confirms real breakout)
        self._retest_trigger_price = None
        self._retest_deadline      = None
        # Bar-close confirmation pending (used when profile bar_close_confirm == True).
        # After the 3-minute OrbService confirmation fires, entry is deferred until the
        # next 1-minute bar CLOSES above ORH (CALL) or below ORL (PUT).  A single tick
        # or wick above the level cannot trigger entry — the bar body must close outside.
        self._bar_confirm_pending   = False
        self._bar_confirm_direction = None   # "CALL" | "PUT"
        self._bar_confirm_price     = None   # underlying price at the time of the signal
        # Fan-out queues for /ws/strategy/<id>/live WebSocket clients
        self._live_clients: list     = []
        self._live_clients_lock      = __import__("threading").Lock()
        # ── Session-level risk management ─────────────────────────────────────────
        # Cumulative realized P&L for this trading day across all trades.
        self._session_realized_pnl:   float = 0.0
        # Set to True when daily_loss_limit is breached — blocks all further entries.
        self._session_halted:         bool  = False
        # Tracks the last losing exit per direction so re-entry cooldowns can fire.
        # Key: "CALL" | "PUT" — Value: {"time": datetime, "pnl": float}
        self._last_loss_by_direction: dict  = {}
        # Accumulates P&L across partial exits for the current open trade.
        self._active_trade_pnl:       float = 0.0
        # REVERSAL-profile: timestamp when the trade first dropped below the -15%
        # bleed threshold. Cleared when price recovers above -15%.
        self._reversal_down_since:    Optional[datetime] = None

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
        # Clear any state left over from a prior session (trade_taken, position,
        # exit_manager, etc). calculate_orb only runs once daily at 09:35 ET before
        # any entry can happen today, so a True trade_taken here is always stale —
        # e.g. a contract from a previous day that expired without the engine
        # observing the close. Unsubscribes any leftover stream callback too.
        self.reset_session()
        self.session_date = now_et.date()

        # Close any open trades from prior expired sessions (crash/redeploy guard).
        self.logger.reconcile_orphaned_trades()

        # Log whether OrbService is live — but do NOT abort here. Even when the
        # hub isn't marked running yet (e.g. race condition right after a restart
        # where OrbService thread hasn't called set_service_running(True) yet),
        # _collect_orb_window_bars() will fall back to Alpaca REST to get the
        # 09:30–09:45 bars so ORH/ORL can still be set.  OrbService is still
        # needed to *detect* breakouts; this just ensures the engine is ready
        # when those signals arrive.
        if not self._hub.is_service_running():
            logger.info("[ORBEngine] calculate_orb running without live hub for %s "
                        "(OrbService not yet running — will use Alpaca REST bar fallback)",
                        self.ticker)
            self.debug.emit("WARN", "calculate_orb: hub not running — using Alpaca REST "
                                    "bar fallback to set ORH/ORL")

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

        self.vix = result.get("vix")
        self.logger.log_session(
            ticker=self.ticker,
            session_date=self.session_date,
            orh=self.orh, orl=self.orl,
            orb_range=self.orb_range,
            vix=self.vix,
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
        self.notifier.notify_session_armed(
            ticker=self.ticker,
            orh=self.orh,
            orl=self.orl,
            profile_key=self.profile_key,
        )
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

        # Service-driven retest watch — only active when entry_mode == "RETEST"
        if self._awaiting_retest:
            if current_price is not None:
                self._check_retest(current_price, now_et)
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

            # REVERSAL time-weighted patience stop — if the trade has bled past
            # -15% for 20+ continuous minutes without recovering, close half to
            # limit exposure. A failed reversal rarely turns around same day.
            if action["type"] == "HOLD" and self.profile_key == "REVERSAL":
                em = self.exit_manager
                pnl_pct = ((current_option_price - em.entry_premium) / em.entry_premium
                           if em.entry_premium > 0 else 0)
                if pnl_pct < -0.15:
                    if self._reversal_down_since is None:
                        self._reversal_down_since = now_et
                    elif (now_et - self._reversal_down_since).total_seconds() >= 1200:  # 20 min
                        qty_cut = max(1, em.qty_remaining // 2)
                        self.debug.emit("WARN",
                            f"REVERSAL bleed stop — down {pnl_pct*100:.1f}% for "
                            f"{(now_et - self._reversal_down_since).total_seconds()/60:.0f}m "
                            f"— closing {qty_cut} contract(s)")
                        action = {"type": "CLOSE_PARTIAL", "qty": qty_cut,
                                  "reason": "REVERSAL_TIME_CUT"}
                        self._reversal_down_since = None
                else:
                    self._reversal_down_since = None

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

            entry_mode = self.profile.get("entry_mode", "BREAK")
            if entry_mode == "RETEST":
                self._start_retest_watch(direction, price, now_et, deadline)
            elif self.profile.get("bar_close_confirm", False):
                # Bar-close confirmation: defer entry until the next 1-minute bar
                # closes on the correct side of the ORH/ORL.  A single tick or wick
                # that momentarily crosses the level cannot trigger entry.
                self._bar_confirm_pending   = True
                self._bar_confirm_direction = direction
                self._bar_confirm_price     = price
                self.debug.emit("INFO",
                    f"3-min breakout confirmed ({direction} @ {price:.2f}) — "
                    f"waiting for bar close above ORH to enter [{self.profile_key}]")
            else:
                logger.info("[ORBEngine] Confirmed %s breakout for %s @ %.2f — entering",
                            direction, self.ticker, price)
                self.debug.emit("INFO", f"Entry conditions clear — running entry pipeline for "
                                        f"{direction}")
                self._enter_trade(direction, price)

    def on_reversal_confirmed(self, direction: str, price: float):
        """
        Hub callback: OrbService's multi-bar reversal scorer crossed the fire
        threshold for this ticker. Only called for REVERSAL-profile engines.

        direction — opposite of the original breakout ("PUT" if breakout was CALL)
        price     — underlying price at the time the reversal was confirmed.

        Unlike on_breakout_confirmed, we skip the time-limit guard (OrbService
        already validated that the original breakout was within window) and skip
        the RETEST entry mode (the score itself is the confirmation).
        """
        with self._tick_lock:
            self.debug.emit("INFO",
                f"Reversal confirmed for {self.ticker} — direction={direction} @ {price:.2f}")

            if self.trade_taken:
                self.debug.emit("WARN", "Ignoring reversal — trade already open")
                return
            if self.session_skipped:
                self.debug.emit("WARN",
                    f"Ignoring reversal — session skipped ({self.skip_reason})")
                return
            if not self.orh or not self.orl:
                self.debug.emit("WARN",
                    "Ignoring reversal — engine ORB not set (calculate_orb did not run)")
                return
            if datetime.now(ET).weekday() not in self.trade_days:
                self.debug.emit("WARN", "Ignoring reversal — not a trade day")
                return

            logger.info("[ORBEngine] Reversal confirmed %s %s @ %.2f — entering",
                        direction, self.ticker, price)
            self.debug.emit("INFO",
                f"Entering reversal trade — {direction} @ {price:.2f}")
            self._enter_trade(direction, price)

    def _start_retest_watch(self, direction: str, breakout_price: float,
                             now_et, deadline):
        """
        Called instead of _enter_trade when entry_mode == "RETEST".
        Arms the retest watcher: we wait for price to return to the ORB
        level (ORH for CALLs, ORL for PUTs) after extending past it.
        """
        level             = self.orh if direction == "CALL" else self.orl
        window_min        = self.profile.get("retest_window_min", 60)
        retest_deadline   = min(deadline, now_et + timedelta(minutes=window_min))

        self._awaiting_retest      = True
        self._retest_direction     = direction
        self._retest_level         = level
        self._retest_max_dist      = 0.0
        self._retest_trigger_price = breakout_price
        self._retest_deadline      = retest_deadline

        self.debug.emit("INFO",
            f"RETEST armed: watching for {direction} retest of {level:.2f} "
            f"(breakout @ {breakout_price:.2f}) "
            f"until {retest_deadline.strftime('%H:%M ET')}")
        self.notifier.notify_retest_watching(
            ticker=self.ticker,
            direction=direction,
            level=level,
            breakout_price=breakout_price,
            profile_key=self.profile_key,
        )

    def _check_retest(self, current_price: float, now_et):
        """
        Called each tick while _awaiting_retest is True.
        Cancels on timeout or invalidation; enters on confirmed retest hold.
        """
        direction = self._retest_direction
        level     = self._retest_level

        # Track max extension past the level
        dist = (current_price - level) if direction == "CALL" else (level - current_price)
        if dist > self._retest_max_dist:
            self._retest_max_dist = dist

        # Invalidation: price closed significantly through the level the wrong way
        INVALID_PCT = 0.0015   # 0.15%
        if direction == "CALL" and current_price < level * (1 - INVALID_PCT):
            self.debug.emit("WARN",
                f"RETEST invalidated — price {current_price:.2f} fell through ORH {level:.2f}")
            self._cancel_retest("RETEST_INVALIDATED")
            return
        if direction == "PUT" and current_price > level * (1 + INVALID_PCT):
            self.debug.emit("WARN",
                f"RETEST invalidated — price {current_price:.2f} rose through ORL {level:.2f}")
            self._cancel_retest("RETEST_INVALIDATED")
            return

        # Timeout
        if now_et > self._retest_deadline:
            self.debug.emit("WARN", "RETEST timed out — no retest within window")
            self._cancel_retest("RETEST_TIMEOUT")
            return

        # Need enough extension to confirm it was a real breakout (not just a tick)
        MIN_EXT_PCT = 0.0008   # 0.08% past the level
        if self._retest_max_dist < level * MIN_EXT_PCT:
            return  # not extended far enough yet

        # Check if price has pulled back to the retest zone
        ZONE_PCT = 0.0012      # within 0.12% of the level
        near_level = abs(current_price - level) / level <= ZONE_PCT

        # Still must be on the correct side (don't enter if it has crossed through)
        correct_side = (
            (direction == "CALL" and current_price >= level * (1 - 0.0005)) or
            (direction == "PUT"  and current_price <= level * (1 + 0.0005))
        )

        if near_level and correct_side:
            self.debug.emit("SUCCESS",
                f"RETEST confirmed: {direction} price {current_price:.2f} "
                f"held level {level:.2f} after extending {self._retest_max_dist:.3f}")
            self._awaiting_retest = False
            self._enter_trade(direction, current_price)

    def _cancel_retest(self, reason: str):
        """Reset retest watch state and skip the session."""
        self._awaiting_retest  = False
        self._retest_direction = None
        self._retest_level     = None
        self._retest_max_dist  = 0.0
        self._retest_deadline  = None
        self._skip(reason)

    # ── Entry ──────────────────────────────────────────────────────────────────

    def _check_daily_loss_limit(self) -> bool:
        """Returns True if the daily loss limit is active and entry should be blocked."""
        return self._session_halted

    def _check_reentry_cooldown(self, direction: str) -> bool:
        """
        Returns True if a same-direction loss is recent enough to block re-entry.
        Cooldown window comes from profile['re_entry_cooldown_min'] (default 45 min).
        Only fires on LOSSES — a winning exit never blocks re-entry.
        """
        cooldown_min = self.profile.get("re_entry_cooldown_min", 45)
        last = self._last_loss_by_direction.get(direction)
        if not last:
            return False
        elapsed = (datetime.now(ET) - last["time"]).total_seconds() / 60
        if elapsed < cooldown_min:
            remaining = cooldown_min - elapsed
            self.debug.emit(
                "WARN",
                f"Re-entry blocked — {direction} lost ${abs(last['pnl']):.0f} "
                f"{elapsed:.0f}m ago. Cooldown: {remaining:.0f}m remaining.",
            )
            return True
        return False

    def _enter_trade(self, direction: str, trigger_price: float):
        """
        Run flow confirmation, select a contract, validate buying power, and
        submit a market order via Alpaca.  Sets trade state and initialises
        ExitManager on success.

        NOTE: Called by on_price_tick when price closes above ORH (CALL) or
        below ORL (PUT) for the first time in the session.
        """
        # ── Risk guards — checked before any API / broker call ───────────────────
        if self._check_daily_loss_limit():
            self.debug.emit(
                "WARN",
                f"Entry blocked — daily loss limit reached "
                f"(session P&L: ${self._session_realized_pnl:.0f}). "
                f"Strategy paused for today.",
            )
            self.notifier.notify_skip(
                self.ticker,
                f"DAILY_LOSS_LIMIT (session P&L: ${self._session_realized_pnl:.0f})",
            )
            return

        if self._check_reentry_cooldown(direction):
            cooldown_min = self.profile.get("re_entry_cooldown_min", 45)
            last = self._last_loss_by_direction.get(direction, {})
            elapsed = int(
                (datetime.now(ET) - last["time"]).total_seconds() / 60
            ) if last.get("time") else 0
            self.notifier.notify_skip(
                self.ticker,
                f"RE_ENTRY_COOLDOWN ({direction} — {cooldown_min - elapsed}m remaining)",
            )
            return

        uw_key = os.getenv("UNUSUAL_WHALES_KEY")
        flow_agrees = self.sentiment.confirm_with_flow(self.ticker, direction, uw_key)
        if not flow_agrees:
            if self.flow_gate_enabled:
                logger.info("[ORBEngine] Flow gate blocked %s %s entry", self.ticker, direction)
                self.debug.emit("ERROR", f"Entry blocked — flow gate ({direction})")
                self.notifier.notify_flow_blocked(self.ticker, direction)
                return
            else:
                # Gate disabled — notify for awareness but don't block the trade.
                logger.info("[ORBEngine] Flow mismatch for %s %s — gate disabled, proceeding",
                            self.ticker, direction)
                self.debug.emit("WARN",
                    f"Flow disagrees with {direction} but flow_gate_enabled=False — entering anyway")
                self.notifier.notify_flow_blocked(self.ticker, direction)
        else:
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

        # Smart contracts: override profile qty with a tier based on the ask price.
        # Cheaper options buy more contracts; expensive ones buy fewer. This adapts
        # position sizing to available capital without a fixed profile qty.
        # force_smart_qty (profile key) enables this regardless of the user config flag.
        # min_smart_qty (profile key) floors the result — used by REVERSAL to ensure
        # at least 2 contracts so the TP1+runner structure is always funded.
        # The capital_limit and buying_power checks below still apply after.
        if self.smart_contracts or self.profile.get("force_smart_qty", False):
            from services.strategy.profiles import smart_qty
            smart = smart_qty(ask)
            min_sq = self.profile.get("min_smart_qty", 1)
            if smart < min_sq:
                smart = min_sq
            self.debug.emit("INFO",
                f"[{self.strategy_name} | {self.profile_key}] Smart contracts: "
                f"ask=${ask:.2f} → qty={smart} (min={min_sq}, profile default was {qty})")
            qty = smart

        # Enforce user-configured capital_limit — cap qty to what the limit allows.
        # This is independent of account buying power; it lets the user ring-fence
        # a fixed dollar amount per strategy regardless of total account size.
        if self.capital_limit is not None and ask > 0:
            cap_qty = int(self.capital_limit / (ask * 100))
            if cap_qty < 1:
                self.debug.emit("ERROR",
                    f"Entry blocked — capital_limit=${self.capital_limit} too low for "
                    f"1 contract at ask=${ask:.2f} (need ${ask*100:.0f})")
                self.notifier.notify_insufficient_capital(
                    self.ticker,
                    ask * 100,          # cost for 1 contract
                    self.capital_limit,
                )
                return
            if cap_qty < qty:
                self.debug.emit("INFO",
                    f"Qty capped by capital_limit: {qty}→{cap_qty} "
                    f"(limit=${self.capital_limit}, ask=${ask:.2f})")
                qty = cap_qty

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
                       effective_profile: dict, fib_levels: dict, manual: bool = False,
                       profile_key_override: str | None = None):
        """
        Submit the market order, set trade state, initialise ExitManager, log and
        notify. Shared by the auto path (_enter_trade) and the manual conviction
        path (submit_manual_trade). Assumes capital/stream checks already passed.

        profile_key_override: the profile key actually used for this trade (differs
        from self.profile_key when the user selects a profile at trade submission time).
        Always pass this from submit_manual_trade so immediate trades log correctly.
        """
        try:
            order_req = MarketOrderRequest(
                symbol=contract["symbol"],
                qty=qty,
                side=OrderSide.BUY,
                time_in_force=TimeInForce.DAY
            )
            submitted = self.trading_client.submit_order(order_req)

            # Prefer the actual fill price over the pre-order ask so that all
            # TP/SL levels are anchored to what was actually paid.
            entry_premium = self._resolve_entry_premium(submitted, contract["ask"])

            self.position               = direction
            self.contract_symbol        = contract["symbol"]
            self.trade_taken            = True
            self._trade_was_taken_today = True  # survives the position close
            self.trade_entry_time = datetime.now(ET)
            self.timer_notified   = False
            self._active_trade_pnl = 0.0  # reset accumulator for this trade
            self.session_date     = self.session_date or datetime.now(ET).date()

            eod_time = EOD_CLOSE_TIMES.get(self.ticker, "15:58")
            self.exit_manager = ExitManager(
                entry_premium=entry_premium,
                qty=qty,
                fib_levels=fib_levels,
                direction=direction,
                eod_close_time=eod_time,
                profile=effective_profile,
            )

            # Use the override key when the user selected a profile at trade time
            # (immediate trades). This fixes the bug where all immediate trades were
            # logged as THUNDER_CAT regardless of the profile the user picked.
            logged_profile_key = profile_key_override or self.profile_key
            trade_type = "IMMEDIATE" if manual else "STRATEGY"

            # Update engine's profile_key so /immediate-positions reflects it correctly.
            if profile_key_override:
                self.profile_key = profile_key_override

            # Only pass strategy_id if it is a valid UUID — synthetic immediate-engine
            # ids (e.g. "immediate-QQQ-paper") are not UUIDs and cause Supabase to
            # reject the insert with a type error that is otherwise silently swallowed.
            try:
                _uuid.UUID(str(self.strategy_id))
                log_strategy_id = self.strategy_id
            except (ValueError, AttributeError, TypeError):
                log_strategy_id = None

            self.active_trade_id = self.logger.log_entry(
                ticker=self.ticker,
                direction=direction,
                contract=contract,
                entry_premium=entry_premium,
                orh=fib_levels.get("orh"), orl=fib_levels.get("orl"),
                fib_levels=fib_levels,
                session_date=self.session_date,
                profile=logged_profile_key,
                qty=qty,
                underlying_price_entry=self._get_underlying_price(),
                vix_at_entry=self.vix,
                strategy_id=log_strategy_id,
                paper_mode=self.paper,
                trade_type=trade_type,
            )
            if self.active_trade_id is None:
                self.debug.emit("ERROR",
                    f"Supabase log_entry failed — {contract['symbol']} trade not recorded in DB. "
                    "Check Railway logs or Supabase connectivity.")
            self.notifier.notify_entry(
                ticker=self.ticker,
                direction=direction,
                contract=contract,
                qty=qty,
                entry_premium=entry_premium,
                trade_id=self.active_trade_id,
                profile_key=logged_profile_key,
                macro_event=self.macro_today,
            )
            # Subscribe to real-time option quotes now that the position is open
            if self.stream_manager:
                self.stream_manager.subscribe(contract["symbol"], self._on_stream_quote)

            logger.info("[ORBEngine] Entered %s %s qty=%d @ %.2f (manual=%s)",
                        direction, contract["symbol"], qty, entry_premium, manual)
            _tag = f"[{self.strategy_name} | {logged_profile_key}]"
            self.debug.emit("SUCCESS", f"{_tag} {'MANUAL ' if manual else ''}ENTERED {direction} "
                                       f"{contract['symbol']} qty={qty} @ {entry_premium:.2f}")
        except Exception as e:
            logger.error("[ORBEngine] Order failed: %s", e)
            self.debug.emit("ERROR", f"Order submission failed: {e}")
            raise

    # ── Manual / conviction entry ───────────────────────────────────────────────

    def submit_manual_trade(self, direction: str, contract_symbol: str,
                            qty: int | None = None, profile_key: str | None = None,
                            exit_overrides: dict | None = None) -> dict:
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

        # Check the market clock before doing any quote/stream work — outside
        # regular trading hours, Alpaca will reject the order anyway, but only
        # after the (up to 8s) stream-verify wait and with a raw, unfriendly
        # error message. Failing this check open (continue on error) since
        # it's a UX nicety, not a safety guard — verify_stream still gates entry.
        try:
            clock = self.trading_client.get_clock()
            if not clock.is_open:
                msg = "Market is closed — immediate trades are only available during regular trading hours (9:30 AM–4:00 PM ET)"
                self.debug.emit("WARN", f"Manual trade blocked — {msg}")
                return {"status": "error", "message": msg}
        except Exception as e:
            logger.debug("[ORBEngine] market clock check failed, continuing: %s", e)

        # No new manual entries in the final 30 minutes of the session — 0DTE
        # theta/gamma in this window punishes discretionary entries too
        # consistently to allow them (2026-07-06 daily review recommendation #4).
        now_et = datetime.now(ET)
        cutoff = now_et.replace(hour=15, minute=0, second=0, microsecond=0)
        if now_et >= cutoff:
            msg = "Manual trades are disabled in the final 30 minutes of the session (after 3:00 PM ET)"
            self.debug.emit("WARN", f"Manual trade blocked — {msg}")
            return {"status": "error", "message": msg}

        effective_profile = self.profile
        effective_profile_key = self.profile_key
        if profile_key and profile_key != self.profile_key:
            try:
                effective_profile = get_profile(profile_key, exit_overrides)
                effective_profile_key = profile_key
            except Exception:
                return {"status": "error", "message": f"Unknown profile {profile_key}"}
        elif exit_overrides:
            effective_profile = get_profile(self.profile_key, exit_overrides)

        qty = int(qty) if qty else effective_profile["qty_contracts"]
        self.debug.emit("INFO", f"Manual trade requested — {direction} {contract_symbol} "
                                f"qty={qty} profile={profile_key or self.profile_key}")

        # Resolve the chosen contract's live quote + metadata.
        self.debug.emit("INFO", f"Fetching live quote for {contract_symbol} ...")
        contract = self._resolve_contract(contract_symbol, direction)
        if not contract:
            self.debug.emit("ERROR", f"Manual trade blocked — could not price {contract_symbol}")
            return {"status": "error", "message": f"Could not fetch a quote for {contract_symbol}"}
        self.debug.emit("INFO", f"Contract priced — {contract['symbol']} "
                                f"ask=${contract['ask']:.2f} bid=${contract['bid']:.2f}")

        # Use the engine's ORB/fib if armed, else synthesize from the underlying so
        # ExitManager (premium-based) has the orh/orl + fib targets it expects.
        if self.orh and self.orl and self.fib_levels:
            fib_levels = self.fib_levels
        else:
            anchor = self._get_underlying_price() or contract["strike"]
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
            else:
                self.debug.emit("INFO",
                    f"Capital OK — ask=${ask:.2f} qty={qty} cost=${required:.0f} "
                    f"buying_power=${buying_power:.0f}")

        # Verify the option can be streamed (same blind-trade guard as auto entry).
        if self.stream_manager:
            self.debug.emit("INFO",
                f"Verifying stream for {contract['symbol']} (timeout=8s) ...")
            if not self.stream_manager.verify_stream(contract["symbol"], timeout=8.0):
                msg = f"Real-time stream unavailable for {contract['symbol']}"
                self.debug.emit("ERROR", f"Manual trade blocked — {msg}")
                return {"status": "error", "message": msg}
            self.debug.emit("INFO", f"Stream verified for {contract['symbol']}")

        try:
            self._execute_entry(direction, contract, qty, effective_profile, fib_levels,
                                manual=True, profile_key_override=effective_profile_key)
        except Exception as e:
            self.debug.emit("ERROR", f"Manual trade blocked — order submission failed: {e}")
            return {"status": "error", "message": f"Order submission failed: {e}"}
        return {"status": "ok", "message": f"Entered {direction} {contract['symbol']} qty={qty}",
                "contract": contract["symbol"], "qty": qty, "trade_id": self.active_trade_id}

    def _resolve_exit_premium(self, order, mid_fallback: float) -> float:
        """Return the actual Alpaca fill price for a sell order, falling back to stream mid."""
        import time as _time
        try:
            fp = getattr(order, "filled_avg_price", None)
            if fp and float(fp) > 0:
                return float(fp)
            _time.sleep(0.5)
            refreshed = self.trading_client.get_order_by_id(str(order.id))
            fp = getattr(refreshed, "filled_avg_price", None)
            if fp and float(fp) > 0:
                return float(fp)
        except Exception as e:
            logger.debug("[ORBEngine] _resolve_exit_premium fallback: %s", e)
        return mid_fallback

    def _resolve_entry_premium(self, order, ask_fallback: float) -> float:
        """
        Return the best entry premium to anchor TP/SL to.

        Alpaca fills market options orders immediately (paper + live). The
        submitted Order object often already has `filled_avg_price`. If not (the
        order is still pending at API-return time), we poll once with a short
        delay, then fall back to the pre-order ask so the trade is never blocked.
        """
        import time as _time
        try:
            fp = getattr(order, "filled_avg_price", None)
            if fp and float(fp) > 0:
                return float(fp)
            # Give Alpaca up to ~1 s to fill (options market orders are near-instant).
            _time.sleep(0.5)
            refreshed = self.trading_client.get_order_by_id(str(order.id))
            fp = getattr(refreshed, "filled_avg_price", None)
            if fp and float(fp) > 0:
                return float(fp)
        except Exception as e:
            logger.debug("[ORBEngine] _resolve_entry_premium fallback: %s", e)
        return ask_fallback

    def _get_underlying_price(self) -> float | None:
        """
        Best-effort underlying price for logging/fib-anchor purposes.

        `_last_underlying_price` is only populated once the hub has pushed at
        least one bar for this ticker; a manual trade fired before that first
        bar arrives would otherwise log `underlying_price_entry=None` and fall
        back to the contract strike as the fib anchor (2026-07-06 daily review
        recommendation #5). Falls back to a live REST quote in that case.
        """
        if self._last_underlying_price is not None:
            return self._last_underlying_price
        try:
            from alpaca.data.requests import StockLatestTradeRequest
            trades = self.stock_client.get_stock_latest_trade(
                StockLatestTradeRequest(symbol_or_symbols=self.ticker)
            )
            trade = trades.get(self.ticker)
            return float(trade.price) if trade and trade.price else None
        except Exception as e:
            logger.warning("[ORBEngine] Live underlying price fallback failed for %s: %s", self.ticker, e)
            return None

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
        em       = self.exit_manager
        opt_str  = f"${current_option_price:.2f}" if current_option_price is not None else "N/A"
        _tag = f"[{self.strategy_name} | {self.profile_key}]"
        self.debug.emit("INFO",
            f"{_tag} Exit triggered — {action['type']} reason={action.get('reason','')} "
            f"qty={qty_to_close} option_price={opt_str} "
            f"entry=${em.entry_premium:.2f} hard_stop=${em.hard_stop:.2f} "
            f"tp1=${em.tp1:.2f} tp2=${em.tp2:.2f}",
            {"action": action})
        # ── Step 1: Submit the Alpaca order ──────────────────────────────────────
        # Keep separate from logging so a close_position failure (e.g. option
        # already expired) does NOT suppress the exit record in Supabase.
        contract_snapshot  = self.contract_symbol  # capture before any reset
        direction_snapshot = self.position          # capture before closing_all resets it
        order_ok   = False
        fill_order = None
        try:
            # Always submit an exact-qty SELL order rather than close_position().
            # close_position() would close the entire Alpaca position for the symbol,
            # which stomps on contracts owned by sibling engines on the same account
            # (e.g. two IWM strategies that both entered the same contract).
            order = MarketOrderRequest(
                symbol=contract_snapshot,
                qty=qty_to_close,
                side=OrderSide.SELL,
                time_in_force=TimeInForce.DAY,
            )
            fill_order = self.trading_client.submit_order(order)
            if closing_all:
                self.exit_manager.update_qty(self.exit_manager.qty_remaining)
                self.trade_taken = False
                self.position    = None
                if self.stream_manager and contract_snapshot:
                    self.stream_manager.unsubscribe(contract_snapshot, self._on_stream_quote)
                import json as _json
                _closed_msg = _json.dumps({"type": "position_closed"})
                with self._live_clients_lock:
                    for _q in list(self._live_clients):
                        try:
                            _q.put_nowait(_closed_msg)
                        except Exception:
                            pass
            else:
                self.exit_manager.update_qty(qty_to_close)
            order_ok = True
        except Exception as e:
            logger.error("[ORBEngine] Exit order failed: %s", e)
            self.debug.emit("ERROR", f"Exit order failed: {e}")

        if not order_ok:
            return

        # ── Step 2: Log and notify — always runs when the order succeeded ────────
        mid_price    = (action.get("current_premium") or current_option_price or current_price)
        exit_premium = self._resolve_exit_premium(fill_order, mid_price) if fill_order else mid_price
        entry_p = em.entry_premium if em else 0
        pnl = (exit_premium - entry_p) * qty_to_close * 100

        # ── Step 3: Update session-level risk tracking ────────────────────────────
        self._active_trade_pnl     += pnl
        self._session_realized_pnl += pnl

        if closing_all:
            # Full close: record a direction-specific loss for re-entry cooldown,
            # then check whether the daily loss limit has now been breached.
            if self._active_trade_pnl < 0 and direction_snapshot:
                self._last_loss_by_direction[direction_snapshot] = {
                    "time": datetime.now(ET),
                    "pnl":  self._active_trade_pnl,
                }
                self.debug.emit(
                    "WARN",
                    f"Loss recorded for {direction_snapshot} "
                    f"(${self._active_trade_pnl:.0f}). "
                    f"Re-entry cooldown active for "
                    f"{self.profile.get('re_entry_cooldown_min', 45)} min.",
                )

            limit = self.profile.get("daily_loss_limit", 0)
            if limit > 0 and not self._session_halted and self._session_realized_pnl < -limit:
                self._session_halted = True
                self.debug.emit(
                    "ERROR",
                    f"Daily loss limit reached — session P&L: "
                    f"${self._session_realized_pnl:.0f} "
                    f"(limit: -${limit:.0f}). No more entries today.",
                )

            self._active_trade_pnl = 0.0  # reset for next trade

        try:
            self.logger.log_exit(
                contract_symbol=contract_snapshot,
                exit_reason=action["reason"],
                exit_premium=exit_premium,
                qty_closed=qty_to_close,
                profile=self.profile_key,
                strategy_id=self.strategy_id,
                underlying_price_exit=current_price,
            )
            self.notifier.notify_exit(
                ticker=self.ticker,
                contract_symbol=contract_snapshot,
                exit_reason=action["reason"],
                pnl=pnl,
                qty=qty_to_close,
                profile_key=self.profile_key,
            )
            logger.info("[ORBEngine] Exit %s qty=%d reason=%s",
                        action["type"], qty_to_close, action.get("reason", ""))
            self.debug.emit("SUCCESS", f"{_tag} Exit {action['type']} qty={qty_to_close} "
                                       f"reason={action.get('reason', '')} pnl=${pnl:.2f} "
                                       f"session_pnl=${self._session_realized_pnl:.0f}")
        except Exception as e:
            logger.error("[ORBEngine] Exit log/notify failed: %s", e)
            self.debug.emit("ERROR", f"Exit log/notify failed: {e}")

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

        # Drive exit logic — pass None for underlying if not yet polled.
        # ExitManager skips the consolidation buffer on None, preventing false
        # consolidation exits caused by stable option prices right after entry.
        self.on_price_tick(current_price=self._last_underlying_price, current_option_price=mid)

        # Push live P&L to any connected WebSocket clients
        if not self.trade_taken or not self.exit_manager:
            return
        em = self.exit_manager
        entry_p = em.entry_premium or 0
        pnl          = (mid - entry_p) * em.qty_remaining * 100
        pnl_pct      = ((mid - entry_p) / entry_p * 100) if entry_p > 0 else 0
        market_value = mid * em.qty_remaining * 100
        payload = _json.dumps({
            "type":          "price_update",
            "contract":      self.contract_symbol,
            "mid_price":     round(mid, 4),
            "entry_premium": round(entry_p, 4),
            "pnl":           round(pnl, 2),
            "pnl_pct":       round(pnl_pct, 2),
            "qty_remaining": em.qty_remaining,
            "market_value":  round(market_value, 2),
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

        # Feed the cascade tracker at bar cadence (not quote cadence — inter-bar
        # quotes repeat the same underlying price and would reset the counter).
        if self.trade_taken and self.exit_manager:
            self.exit_manager.on_underlying_bar(bar.close)

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
        Build the opening-range bars for the 09:30–(09:30+n_minutes) ET window.

        Primary:  the hub's in-memory bar buffer (populated by OrbService while it
                  is running).
        Fallback: Alpaca StockHistoricalDataClient REST fetch — used when the server
                  has restarted and OrbService's buffer is empty (bars were streamed
                  before the restart and are no longer in memory).  This ensures
                  calculate_orb() can still set ORH/ORL even on a late-start deploy.
        """
        now_et = datetime.now(ET)
        start  = now_et.replace(hour=9, minute=30, second=0, microsecond=0)
        end    = start + timedelta(minutes=n_minutes)

        # ── Primary: hub buffer ──────────────────────────────────────────────────
        bars = []
        for b in self._hub.get_recent_bars(self.ticker):
            ts = b.ts
            if ts.tzinfo is None:
                ts = ET.localize(ts)
            else:
                ts = ts.astimezone(ET)
            if start <= ts < end and b.high is not None and b.low is not None:
                bars.append(b)

        if bars:
            return bars

        # ── Fallback: Alpaca historical bars ────────────────────────────────────
        # Only attempt when the ORB window has already closed (after 09:30+n_min).
        if now_et < end:
            logger.warning("[ORBEngine] No hub bars for %s yet — window still open", self.ticker)
            return []

        logger.info("[ORBEngine] Hub buffer empty for %s — fetching ORB bars from Alpaca REST",
                    self.ticker)
        try:
            req = StockBarsRequest(
                symbol_or_symbols=self.ticker,
                timeframe=TimeFrame.Minute,
                start=start,
                end=end,
                feed="iex",
            )
            resp = self.stock_client.get_stock_bars(req)
            raw_bars = resp.get(self.ticker, [])
            for rb in raw_bars:
                ts = rb.timestamp
                if ts.tzinfo is None:
                    ts = ET.localize(ts)
                else:
                    ts = ts.astimezone(ET)
                if start <= ts < end and rb.high is not None and rb.low is not None:
                    bars.append(OrbBar(ticker=self.ticker, ts=ts,
                                       open=rb.open, high=rb.high,
                                       low=rb.low, close=rb.close,
                                       volume=rb.volume or 0))
            if bars:
                logger.info("[ORBEngine] Alpaca REST returned %d bars for %s ORB window",
                            len(bars), self.ticker)
            else:
                logger.warning("[ORBEngine] No bars in ORB window for %s (%s–%s) from Alpaca REST",
                               self.ticker, start.time(), end.time())
        except Exception as e:
            logger.error("[ORBEngine] Alpaca REST bar fallback failed for %s: %s", self.ticker, e)

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
            if self._subscription_type == "reversal":
                self._hub.unsubscribe(self._subscribed_ticker, self.on_reversal_confirmed)
            else:
                self._hub.unsubscribe(self._subscribed_ticker, self.on_breakout_confirmed)
            self._subscribed_ticker = None
            self._subscription_type = None

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
            "flow_gate_enabled":          self.flow_gate_enabled,
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
            "session_pnl":                round(self._session_realized_pnl, 2),
            "session_halted":             self._session_halted,
            "daily_loss_limit":           self.profile.get("daily_loss_limit", 0),
            "re_entry_cooldown_min":      self.profile.get("re_entry_cooldown_min", 45),
            "last_loss_by_direction":     {
                k: {"pnl": round(v["pnl"], 2), "time": v["time"].isoformat()}
                for k, v in self._last_loss_by_direction.items()
            },
        }
