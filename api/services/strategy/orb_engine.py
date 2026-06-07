"""
Profile-aware ORB trading engine.

Config is loaded from Supabase at startup and hot-reloaded when the frontend
POSTs to /strategy/config. Paper vs live trading is set by paper_mode in config.
"""

import os
import logging
import pytz
from datetime import datetime, timedelta

from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.data.historical import StockHistoricalDataClient, OptionHistoricalDataClient
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame

from services.strategy.profiles import get_profile
from services.strategy.contract_selector import select_contract
from services.strategy.exit_manager import ExitManager
from services.strategy.sentiment import SentimentFilter
from services.strategy.trade_logger import TradeLogger
from services.strategy.notifier import StrategyNotifier

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

STRATEGY_DEFAULTS = {
    "ticker":                  "IWM",
    "orb_minutes":             10,
    "paper_mode":              True,
    "active":                  True,
    "profile":                 "THUNDER_CAT",
    "trade_days":              [0, 2, 4],
    "strategy_name":           "",
    "capital_limit":           None,
    "bypass_breakout_window":  False,
    "custom_thresholds":       None,
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
    def __init__(self, config: dict = None, stream_manager=None):
        self.config = config or STRATEGY_DEFAULTS.copy()
        self._stream_manager_ref = stream_manager
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
        self.data_client    = StockHistoricalDataClient(data_key, data_secret)
        self.option_client  = OptionHistoricalDataClient(data_key, data_secret)

        self.sentiment  = SentimentFilter()
        self.logger     = TradeLogger()
        self.notifier   = StrategyNotifier(self.logger.client)
        logger.info("[ORBEngine] Config applied — profile=%s ticker=%s paper=%s days=%s",
                    self.profile_key, self.ticker, self.paper, self.trade_days)

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

        if now_et.weekday() not in self.trade_days:
            self._skip("NOT_TRADE_DAY")
            return False

        if not self.config.get("active", True):
            self._skip("STRATEGY_DISABLED")
            return False

        bars = self._fetch_orb_bars(self.config["orb_minutes"])
        if not bars:
            self._skip("NO_DATA")
            return False

        self.orh = max(b.high for b in bars)
        self.orl = min(b.low  for b in bars)
        self.orb_range = self.orh - self.orl
        mid = (self.orh + self.orl) / 2

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
        return True

    # ── Step 2: Called every minute after ORB is set ──────────────────────────

    def on_price_tick(self, current_price: float, current_volume: float = None,
                     current_option_price: float = None):
        """
        Main per-minute decision loop: checks breakout conditions before entry
        or delegates to ExitManager once a position is open.

        current_price         — underlying stock price (always available)
        current_option_price  — live option mid-price (bid+ask)/2; None if fetch failed.
                                ExitManager uses this for the premium-based hard stop.

        NOTE: Called by scheduler._poll every minute.
        """
        if self.session_skipped:
            return

        now_et = datetime.now(ET)
        orb_close = now_et.replace(hour=9, minute=30 + self.config["orb_minutes"], second=0)
        limit_min = self.profile.get("breakout_time_limit_min", 45)
        deadline  = orb_close + timedelta(minutes=limit_min)

        if not self.trade_taken and not self.bypass_breakout_window and now_et > deadline:
            self._skip("BREAKOUT_TIME_LIMIT_EXCEEDED")
            return

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

        if not self.trade_taken and self.orh and self.orl:
            if current_price > self.orh:
                self._enter_trade("CALL", current_price)
            elif current_price < self.orl:
                self._enter_trade("PUT",  current_price)

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
            logger.info("[ORBEngine] Flow confirmation failed for %s — skipping entry", direction)
            return

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
            self.notifier.notify_no_contract(self.ticker)
            return

        qty = self.profile["qty_contracts"]

        # Capital guard: reduce qty if buying power is insufficient, skip if unaffordable
        ask = contract["ask"]
        acct = self.get_account_info()
        if acct:
            required = qty * ask * 100
            buying_power = acct["buying_power"]
            if required > buying_power:
                affordable = int(buying_power / (ask * 100))
                if affordable < 1:
                    logger.warning(
                        "[ORBEngine] Insufficient capital — need $%.0f, have $%.0f",
                        required, buying_power,
                    )
                    self.notifier.notify_insufficient_capital(
                        self.ticker, required, buying_power
                    )
                    return
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
                self.notifier.notify_stream_failed(self.ticker, symbol_to_verify)
                return

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

            eod_time = EOD_CLOSE_TIMES.get(self.ticker, "15:10")
            self.exit_manager = ExitManager(
                entry_premium=contract["ask"],
                qty=qty,
                fib_levels=self.fib_levels,
                direction=direction,
                eod_close_time=eod_time,
                profile=self.profile,
            )

            self.active_trade_id = self.logger.log_entry(
                ticker=self.ticker,
                direction=direction,
                contract=contract,
                entry_premium=contract["ask"],
                orh=self.orh, orl=self.orl,
                fib_levels=self.fib_levels,
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

            logger.info("[ORBEngine] Entered %s %s qty=%d @ %.2f",
                        direction, contract["symbol"], qty, contract["ask"])
        except Exception as e:
            logger.error("[ORBEngine] Order failed: %s", e)

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
                exit_reason=action["type"],
                exit_premium=exit_premium,
                qty_closed=qty_to_close,
                profile=self.profile_key,
                strategy_id=self.strategy_id,
            )
            self.notifier.notify_exit(
                ticker=self.ticker,
                contract_symbol=self.contract_symbol,
                exit_reason=action["type"],
                pnl=pnl,
                qty=qty_to_close,
                profile_key=self.profile_key,
            )
            logger.info("[ORBEngine] Exit %s qty=%d reason=%s",
                        action["type"], qty_to_close, action.get("reason", ""))
        except Exception as e:
            logger.error("[ORBEngine] Exit failed: %s", e)

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
        self.notifier.notify_skip(self.ticker, reason)
        logger.info("[ORBEngine] Session skipped: %s", reason)

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

    def _fetch_orb_bars(self, n_minutes: int):
        """
        Pull the first n_minutes of 1-minute bars starting at 09:30 ET.

        NOTE: Called by calculate_orb to establish the opening range.
        """
        now_et = datetime.now(ET)
        start  = now_et.replace(hour=9, minute=30, second=0, microsecond=0)
        end    = start + timedelta(minutes=n_minutes)
        try:
            req  = StockBarsRequest(
                symbol_or_symbols=self.ticker,
                timeframe=TimeFrame.Minute,
                start=start, end=end,
            )
            bars = self.data_client.get_stock_bars(req)
            return bars[self.ticker]
        except Exception as e:
            logger.error("[ORBEngine] Bar fetch failed: %s", e)
            return []

    def get_latest_price(self) -> dict | None:
        """
        Fetch the most recent underlying bar to update _last_underlying_price.
        When streaming is active, the option price comes from the WebSocket
        stream (_current_option_price); otherwise it is fetched here as a fallback.

        NOTE: Called by scheduler._poll every minute. With active streaming the
        option price from this method is ignored in favour of the stream value.
        Returns {"underlying": float, "volume": float, "option_price": float|None}.
        """
        try:
            from alpaca.data.requests import StockLatestBarRequest
            req  = StockLatestBarRequest(symbol_or_symbols=self.ticker)
            bars = self.data_client.get_stock_latest_bar(req)
            bar  = bars.get(self.ticker)
            if not bar:
                return None

            self._last_underlying_price = bar.close
            result: dict = {
                "underlying":   bar.close,
                "volume":       bar.volume,
                "option_price": self._current_option_price,  # from stream if active
            }

            # Fallback REST fetch for option price when stream is unavailable
            if self.contract_symbol and self._current_option_price is None:
                try:
                    from alpaca.data.requests import OptionLatestQuoteRequest
                    oreq   = OptionLatestQuoteRequest(symbol_or_symbols=self.contract_symbol)
                    quotes = self.option_client.get_option_latest_quote(oreq)
                    quote  = quotes.get(self.contract_symbol)
                    if quote and quote.ask_price and quote.bid_price:
                        result["option_price"] = (quote.ask_price + quote.bid_price) / 2
                except Exception as oe:
                    logger.debug("[ORBEngine] option quote REST fallback failed: %s", oe)

            return result
        except Exception as e:
            logger.warning("[ORBEngine] get_latest_price failed: %s", e)
            return None

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
            "date":          str(self.session_date),
            "ticker":        self.ticker,
            "profile":       self.profile_key,
            "trade_days":    list(self.trade_days),
            "paper_mode":    self.paper,
            "orh":           self.orh,
            "orl":           self.orl,
            "orb_range":     self.orb_range,
            "fib_levels":    self.fib_levels,
            "trade_taken":   self.trade_taken,
            "skip_reason":   self.skip_reason,
            "position":      self.position,
            "contract":      self.contract_symbol,
            "exit_state":    em.to_dict() if em else None,
        }
