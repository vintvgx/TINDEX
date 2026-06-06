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

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

STRATEGY_DEFAULTS = {
    "ticker":      "SPY",
    "orb_minutes": 5,
    "paper_mode":  True,
    "active":      True,
    "profile":     "THUNDER_CAT",
    "trade_days":  [0, 2, 4],
}

VIX_MIN = 13.0
MIN_ORB_RANGE_PCT = 0.0015

EOD_CLOSE_TIMES = {
    "SPY": "15:25",
    "QQQ": "15:25",
    "IWM": "15:10",
}


class ORBEngine:
    def __init__(self, config: dict = None):
        self.config = config or STRATEGY_DEFAULTS.copy()
        self._apply_config()
        self._reset_session_state()

    def _apply_config(self):
        self.ticker      = self.config["ticker"]
        self.paper       = self.config.get("paper_mode", True)
        self.profile_key = self.config.get("profile", "THUNDER_CAT")
        self.profile     = get_profile(self.profile_key)
        self.trade_days  = set(self.config.get("trade_days", [0, 2, 4]))

        api_key    = os.getenv("ALPACA_API_KEY")
        secret_key = os.getenv("ALPACA_SECRET_KEY")

        self.trading_client = TradingClient(api_key, secret_key, paper=self.paper)
        self.data_client    = StockHistoricalDataClient(api_key, secret_key)
        self.option_client  = OptionHistoricalDataClient(api_key, secret_key)

        self.sentiment = SentimentFilter()
        self.logger    = TradeLogger()
        logger.info("[ORBEngine] Config applied — profile=%s ticker=%s paper=%s days=%s",
                    self.profile_key, self.ticker, self.paper, self.trade_days)

    def reload_config(self, new_config: dict):
        self.config.update(new_config)
        self._apply_config()

    def _reset_session_state(self):
        self.orh           = None
        self.orl           = None
        self.orb_range     = None
        self.fib_levels    = {}
        self.position      = None
        self.contract_symbol = None
        self.exit_manager  = None
        self.trade_taken   = False
        self.session_date  = None
        self.session_skipped = False
        self.skip_reason   = None
        self.active_trade_id = None

    def reset_session(self):
        self._reset_session_state()

    # ── Step 1: Called at 9:35 AM ET ──────────────────────────────────────────

    def calculate_orb(self) -> bool:
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

        self.logger.log_session(
            ticker=self.ticker,
            session_date=self.session_date,
            orh=self.orh, orl=self.orl,
            orb_range=self.orb_range,
            vix=result["vix"],
            sentiment=result["sentiment"],
            profile=self.profile_key,
        )
        logger.info("[ORBEngine] ORB set — orh=%.2f orl=%.2f vix=%s sentiment=%s",
                    self.orh, self.orl, result["vix"], result["sentiment"])
        return True

    # ── Step 2: Called every minute after ORB is set ──────────────────────────

    def on_price_tick(self, current_price: float, current_volume: float = None):
        if self.session_skipped:
            return

        now_et = datetime.now(ET)
        orb_close   = now_et.replace(hour=9, minute=30 + self.config["orb_minutes"], second=0)
        limit_min   = self.profile.get("breakout_time_limit_min", 45)
        deadline    = orb_close + timedelta(minutes=limit_min)

        if not self.trade_taken and now_et > deadline:
            self._skip("BREAKOUT_TIME_LIMIT_EXCEEDED")
            return

        if self.trade_taken and self.exit_manager:
            action = self.exit_manager.evaluate(
                current_option_price=current_price,
                current_underlying_price=current_price,
                current_volume=current_volume,
            )
            self._handle_exit_action(action, current_price)
            return

        if not self.trade_taken and self.orh and self.orl:
            if current_price > self.orh:
                self._enter_trade("CALL", current_price)
            elif current_price < self.orl:
                self._enter_trade("PUT",  current_price)

    # ── Entry ──────────────────────────────────────────────────────────────────

    def _enter_trade(self, direction: str, trigger_price: float):
        uw_key = os.getenv("UNUSUAL_WHALES_KEY")
        if not self.sentiment.confirm_with_flow(self.ticker, direction, uw_key):
            logger.info("[ORBEngine] Flow confirmation failed for %s — skipping entry", direction)
            return

        contract = select_contract(
            ticker=self.ticker,
            direction=direction,
            trigger_price=trigger_price,
            orh=self.orh,
            orl=self.orl,
            fib_levels=self.fib_levels,
            data_client=self.option_client,
            profile=self.profile,
        )

        if not contract:
            logger.warning("[ORBEngine] No suitable contract found — skipping entry")
            return

        qty = self.profile["qty_contracts"]
        try:
            order = MarketOrderRequest(
                symbol=contract["symbol"],
                qty=qty,
                side=OrderSide.BUY,
                time_in_force=TimeInForce.DAY,
            )
            self.trading_client.submit_order(order)

            self.position        = direction
            self.contract_symbol = contract["symbol"]
            self.trade_taken     = True

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
            logger.info("[ORBEngine] Entered %s %s qty=%d @ %.2f",
                        direction, contract["symbol"], qty, contract["ask"])
        except Exception as e:
            logger.error("[ORBEngine] Order failed: %s", e)

    # ── Exit ───────────────────────────────────────────────────────────────────

    def _handle_exit_action(self, action: dict, current_price: float):
        if not action or action["type"] == "HOLD":
            return

        qty_to_close = action.get("qty", self.exit_manager.qty_remaining)
        try:
            if qty_to_close >= self.exit_manager.qty_remaining:
                self.trading_client.close_position(self.contract_symbol)
                self.exit_manager.qty_remaining = 0
                self.trade_taken = False
                self.position    = None
            else:
                order = MarketOrderRequest(
                    symbol=self.contract_symbol,
                    qty=qty_to_close,
                    side=OrderSide.SELL,
                    time_in_force=TimeInForce.DAY,
                )
                self.trading_client.submit_order(order)
                self.exit_manager.qty_remaining -= qty_to_close

            self.logger.log_exit(
                contract_symbol=self.contract_symbol,
                exit_reason=action["type"],
                exit_premium=action.get("current_premium"),
                qty_closed=qty_to_close,
                profile=self.profile_key,
            )
            logger.info("[ORBEngine] Exit %s qty=%d reason=%s",
                        action["type"], qty_to_close, action.get("reason", ""))
        except Exception as e:
            logger.error("[ORBEngine] Exit failed: %s", e)

    def _skip(self, reason: str):
        self.session_skipped = True
        self.skip_reason = reason
        self.logger.log_skip(self.ticker, reason, self.session_date, self.profile_key)
        logger.info("[ORBEngine] Session skipped: %s", reason)

    # ── Data helpers ───────────────────────────────────────────────────────────

    def _fetch_orb_bars(self, n_minutes: int):
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
        try:
            from alpaca.data.requests import StockLatestBarRequest
            req  = StockLatestBarRequest(symbol_or_symbols=self.ticker)
            bars = self.data_client.get_stock_latest_bar(req)
            bar  = bars.get(self.ticker)
            if bar:
                return {"underlying": bar.close, "volume": bar.volume}
            return None
        except Exception as e:
            logger.warning("[ORBEngine] get_latest_price failed: %s", e)
            return None

    def _calculate_fib_levels(self) -> dict:
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
