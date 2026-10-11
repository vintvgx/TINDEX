"""
Alpaca account trade events (polling audit C1).

One Alpaca TradingStream ("trade_updates") per account — paper and live —
so fills, partial fills, cancels and expiries arrive as events instead of
being discovered by polling get_all_positions(). Events are normalized and
fanned out to in-process subscribers:

  - the /strategy position cache is cleared on every fill/cancel (A5), so
    the next poll sees the change immediately;
  - /ws/app pushes them to phones (C2).

The engines' own fill handling is NOT changed — they still confirm fills
with get_order_by_id(); this is a notification layer on top.

Connected only around market hours (weekdays, 9:20–16:15 ET): options
orders can't fill outside the session, and nights/weekends make no calls.
"""
import asyncio
import logging
import os
import threading
import time
from datetime import datetime, timedelta

import pytz

from services.utils.market_hours import is_market_hours

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

SESSION_BUFFER = timedelta(minutes=10)
GATE_INTERVAL_SEC = 30
BACKOFF_START_SEC = 1.0
BACKOFF_MAX_SEC = 60.0

# Events that change positions/orders the app shows.
POSITION_EVENTS = {"fill", "partial_fill", "canceled", "expired", "rejected", "done_for_day"}

try:
    from alpaca.trading.stream import TradingStream
    HAS_TRADING_STREAM = True
except ImportError:  # pragma: no cover
    HAS_TRADING_STREAM = False


def _in_session(now: "datetime | None" = None) -> bool:
    now = now or datetime.now(ET)
    return (is_market_hours(now) or is_market_hours(now + SESSION_BUFFER)
            or is_market_hours(now - SESSION_BUFFER))


def normalize_update(data, paper: bool) -> dict:
    """TradeUpdate → plain dict (safe to JSON and to hand to any subscriber)."""
    order = getattr(data, "order", None)

    def _f(v):
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    event = getattr(data, "event", None)
    return {
        "type":             "trade_update",
        "account":          "paper" if paper else "live",
        "event":            str(getattr(event, "value", event) or ""),
        "order_id":         str(getattr(order, "id", "") or ""),
        "symbol":           str(getattr(order, "symbol", "") or ""),
        "side":             str(getattr(getattr(order, "side", None), "value", getattr(order, "side", "")) or ""),
        "status":           str(getattr(getattr(order, "status", None), "value", getattr(order, "status", "")) or ""),
        "qty":              _f(getattr(order, "qty", None)),
        "filled_qty":       _f(getattr(order, "filled_qty", None)),
        "filled_avg_price": _f(getattr(order, "filled_avg_price", None)),
        "price":            _f(getattr(data, "price", None)),
        "position_qty":     _f(getattr(data, "position_qty", None)),
        "ts":               time.time(),
    }


class TradeEventHub:
    """Tiny in-process pub/sub. Subscribers must be fast and non-blocking
    (they run on the stream's thread); exceptions are contained."""

    def __init__(self):
        self._subs: list = []
        self._lock = threading.Lock()

    def subscribe(self, fn) -> None:
        with self._lock:
            self._subs.append(fn)

    def unsubscribe(self, fn) -> None:
        with self._lock:
            if fn in self._subs:
                self._subs.remove(fn)

    def publish(self, event: dict) -> None:
        with self._lock:
            subs = list(self._subs)
        for fn in subs:
            try:
                fn(event)
            except Exception as e:
                logger.debug("[TradeEvents] subscriber failed: %s", e)


if HAS_TRADING_STREAM:
    class _BackoffTradingStream(TradingStream):
        """TradingStream whose failed connect/auth backs off 1s → 60s.
        alpaca-py 0.43.2 retries immediately (~10ms) forever otherwise —
        the same log-flood class as the 2026-10-05 options stream incident."""

        def __init__(self, *args, label: str = "", **kwargs):
            super().__init__(*args, **kwargs)
            self._backoff = BACKOFF_START_SEC
            self._failures = 0
            self._label = label

        async def _start_ws(self) -> None:
            try:
                await super()._start_ws()
            except Exception as ex:
                self._failures += 1
                delay = self._backoff
                self._backoff = min(self._backoff * 2, BACKOFF_MAX_SEC)
                if self._failures == 1 or self._failures % 10 == 0:
                    logger.warning("[TradeEvents:%s] connect failed (%s) — retrying in %.0fs (attempt %d)",
                                   self._label, ex, delay, self._failures)
                try:
                    await self.close()
                except Exception:
                    pass
                await asyncio.sleep(delay)
                raise
            if self._failures:
                logger.info("[TradeEvents:%s] connected after %d failed attempt(s)", self._label, self._failures)
            self._failures = 0
            self._backoff = BACKOFF_START_SEC


class TradeUpdatesManager:
    """Owns the paper + live trade-update streams and the session gate."""

    def __init__(self, hub: TradeEventHub):
        self.hub = hub
        self._streams: dict = {}   # paper(bool) -> (stream, thread)
        self._lock = threading.Lock()
        self._gate_started = False
        self.last_event_at: "float | None" = None

    # -- lifecycle --------------------------------------------------------

    def start(self) -> None:
        """Begin the session gate (connects now if in session). Idempotent."""
        if not HAS_TRADING_STREAM:
            logger.warning("[TradeEvents] alpaca TradingStream unavailable — trade events disabled")
            return
        with self._lock:
            if self._gate_started:
                return
            self._gate_started = True
        threading.Thread(target=self._gate_loop, daemon=True, name="TradeEvents-gate").start()

    def _gate_loop(self) -> None:
        while True:
            try:
                if _in_session():
                    self._ensure_streams()
                else:
                    self._stop_streams()
            except Exception as e:
                logger.warning("[TradeEvents] gate error: %s", e)
            time.sleep(GATE_INTERVAL_SEC)

    def _ensure_streams(self) -> None:
        for paper in (True, False):
            with self._lock:
                cur = self._streams.get(paper)
                if cur and cur[1].is_alive():
                    continue
            key, secret = _credentials(paper)
            if not key or not secret:
                continue
            label = "paper" if paper else "live"
            stream = _BackoffTradingStream(key, secret, paper=paper, label=label)
            stream.subscribe_trade_updates(self._handler(paper))
            thread = threading.Thread(target=stream.run, daemon=True, name=f"TradeEvents-{label}")
            with self._lock:
                self._streams[paper] = (stream, thread)
            thread.start()
            logger.info("[TradeEvents:%s] stream started", label)

    def _stop_streams(self) -> None:
        with self._lock:
            streams = list(self._streams.items())
            self._streams.clear()
        for paper, (stream, _thread) in streams:
            try:
                stream.stop()
                logger.info("[TradeEvents:%s] stream stopped (out of session)", "paper" if paper else "live")
            except Exception as e:
                logger.debug("[TradeEvents] stop failed: %s", e)

    def _handler(self, paper: bool):
        async def on_update(data):
            try:
                event = normalize_update(data, paper)
            except Exception as e:
                logger.debug("[TradeEvents] normalize failed: %s", e)
                return
            self.last_event_at = event["ts"]
            self.hub.publish(event)
        return on_update

    def status(self) -> dict:
        with self._lock:
            alive = {("paper" if p else "live"): t.is_alive() for p, (_s, t) in self._streams.items()}
        return {"in_session": _in_session(), "streams": alive, "last_event_at": self.last_event_at}


def _credentials(paper: bool) -> tuple:
    if paper:
        return os.getenv("ALPACA_PAPER_API_KEY"), os.getenv("ALPACA_PAPER_SECRET_KEY")
    return os.getenv("ALPACA_LIVE_API_KEY"), os.getenv("ALPACA_LIVE_SECRET_KEY")


_hub = TradeEventHub()
_manager: "TradeUpdatesManager | None" = None


def get_trade_event_hub() -> TradeEventHub:
    return _hub


def start_trade_events() -> TradeUpdatesManager:
    global _manager
    if _manager is None:
        _manager = TradeUpdatesManager(_hub)
    _manager.start()
    return _manager


def get_trade_events_manager() -> "TradeUpdatesManager | None":
    return _manager
