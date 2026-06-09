"""
In-process ORB data bus.

`OrbService` (the data/ORB authority) publishes live bars and ORB status here;
`ORBEngine` instances (the trade-decision layer) subscribe per-ticker. This is
the single coupling point between the two modules — neither imports the other.

Design:
- One process-wide singleton (`get_orb_data_hub()`).
- Thread-safe: publishers run on the OrbService asyncio-loop thread while
  subscribers were registered from APScheduler / option-stream threads.
- Fan-out copies the listener list under the lock, then invokes callbacks
  outside the lock so a slow/blocking subscriber can't deadlock a publisher.
- A bounded ring buffer of recent bars per ticker lets a late-starting engine
  backfill its opening-range window (`get_recent_bars`).

This removes the duplicated market-data acquisition: only OrbService streams
bars; engines consume them and still window their own per-strategy ORB.
"""

import logging
import threading
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date, datetime
from typing import Callable, Optional

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OrbBar:
    """Provider-neutral 1-minute bar pushed from OrbService to engines."""
    ticker: str
    ts: datetime              # ET, bar start time (falls back to arrival time)
    open: Optional[float]
    high: Optional[float]
    low: Optional[float]
    close: Optional[float]
    volume: int


@dataclass(frozen=True)
class OrbStatus:
    """Snapshot of an ORB session for a ticker (informational / diagnostics)."""
    ticker: str
    session_date: date
    orh: Optional[float]
    orl: Optional[float]
    orb_range: Optional[float]
    vwap: Optional[float]
    opening_price: Optional[float]
    phase: str                # "pre_open" | "calculating" | "ready"
    breakout: str             # "none" | "above" | "below" | "reversal"
    last_price: Optional[float]
    updated_at: datetime


class OrbDataHub:
    """Process-wide publish/subscribe bus for ORB bars + status."""

    def __init__(self, max_recent_bars: int = 240):
        self._lock = threading.RLock()
        self._bar_subs: dict[str, list[Callable[[OrbBar], None]]] = defaultdict(list)
        self._orb_subs: dict[str, list[Callable[[OrbStatus], None]]] = defaultdict(list)
        self._recent_bars: dict[str, deque] = {}
        self._status: dict[str, OrbStatus] = {}
        self._max_recent = max_recent_bars

    # ── Subscription ─────────────────────────────────────────────────────────

    def subscribe_bar(self, ticker: str, cb: Callable[[OrbBar], None]) -> None:
        with self._lock:
            if cb not in self._bar_subs[ticker]:
                self._bar_subs[ticker].append(cb)
        logger.info("[OrbDataHub] bar subscriber added for %s", ticker)

    def subscribe_orb(self, ticker: str, cb: Callable[[OrbStatus], None]) -> None:
        with self._lock:
            if cb not in self._orb_subs[ticker]:
                self._orb_subs[ticker].append(cb)

    def unsubscribe(self, ticker: str, cb: Callable) -> None:
        """Remove a callback from both bar and ORB subscriptions for a ticker."""
        with self._lock:
            for registry in (self._bar_subs, self._orb_subs):
                if cb in registry.get(ticker, []):
                    registry[ticker].remove(cb)
        logger.info("[OrbDataHub] subscriber removed for %s", ticker)

    # ── Publishing (called by OrbService) ────────────────────────────────────

    def publish_bar(self, bar: OrbBar) -> None:
        with self._lock:
            buf = self._recent_bars.get(bar.ticker)
            if buf is None:
                buf = deque(maxlen=self._max_recent)
                self._recent_bars[bar.ticker] = buf
            buf.append(bar)
            listeners = list(self._bar_subs.get(bar.ticker, ()))
        for cb in listeners:
            try:
                cb(bar)
            except Exception as e:
                logger.error("[OrbDataHub] bar subscriber error for %s: %s",
                             bar.ticker, e, exc_info=True)

    def publish_orb_status(self, status: OrbStatus) -> None:
        with self._lock:
            self._status[status.ticker] = status
            listeners = list(self._orb_subs.get(status.ticker, ()))
        for cb in listeners:
            try:
                cb(status)
            except Exception as e:
                logger.error("[OrbDataHub] ORB subscriber error for %s: %s",
                             status.ticker, e, exc_info=True)

    # ── Queries (called by ORBEngine) ────────────────────────────────────────

    def get_recent_bars(self, ticker: str) -> list[OrbBar]:
        with self._lock:
            buf = self._recent_bars.get(ticker)
            return list(buf) if buf else []

    def get_status(self, ticker: str) -> Optional[OrbStatus]:
        with self._lock:
            return self._status.get(ticker)


_hub_singleton: Optional[OrbDataHub] = None
_hub_lock = threading.Lock()


def get_orb_data_hub() -> OrbDataHub:
    """Return the process-wide OrbDataHub, creating it on first use."""
    global _hub_singleton
    if _hub_singleton is None:
        with _hub_lock:
            if _hub_singleton is None:
                _hub_singleton = OrbDataHub()
    return _hub_singleton
