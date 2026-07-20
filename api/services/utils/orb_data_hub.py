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
        # Confirmed-breakout subscribers: OrbService publishes here once a breakout
        # survives its 3-minute confirmation, and the engine enters the trade.
        self._breakout_subs: dict[str, list[Callable[[str, float], None]]] = defaultdict(list)
        self._recent_bars: dict[str, deque] = {}
        self._status: dict[str, OrbStatus] = {}
        self._max_recent = max_recent_bars
        # Reversal-confirmed subscribers: OrbService publishes here once its
        # multi-bar reversal scorer crosses the fire threshold. Only engines
        # configured with the REVERSAL profile listen on this channel — regular
        # breakout engines are unaffected.
        self._reversal_subs: dict[str, list[Callable[[str, float], None]]] = defaultdict(list)
        # Retest-event subscribers: OrbService publishes here on every retest
        # state transition (break detected, invalidated/re-armed, exhausted,
        # confirmed) so engines can surface it to their own Debug tab — this
        # pipeline previously only logged server-side, so a session that got
        # capped out had zero visibility from the app. cb(level, message).
        self._retest_event_subs: dict[str, list[Callable[[str, str], None]]] = defaultdict(list)
        # Per-ticker max retest attempts, registered by whichever strategy
        # engines are currently watching that ticker (the highest value among
        # them wins) and read by OrbService's breakout-confirmation state
        # machine. Previously this was a single hardcoded value (1) shared by
        # every ticker and every profile, with no way for a patient strategy
        # (e.g. Trend Rider) to tolerate more pre-breakout chop than a
        # scalping profile on the same ticker would want. Defaults to 1 for
        # any ticker no engine has registered a preference for.
        self._max_retest_attempts: dict[str, int] = {}
        # Whether OrbService (the bar feed) is currently running. Engines depend on
        # it for price data, so they stay silent / keep the session armed when it
        # is False (e.g. right after a redeploy, before the service has started).
        self._service_running = False
        # Wall-clock time of the last bar actually received, across any ticker.
        # is_service_running() alone proved insufficient on 2026-07-09: the flag
        # can read True (OrbService started and reported itself as running) while
        # the underlying stream is silently dead — this is a stronger liveness
        # signal (a bar arriving proves data is truly flowing) used by the
        # /tindex/orb/status health check and the watchdog's stale-feed restart.
        self._last_bar_at: Optional[datetime] = None

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

    def subscribe_breakout(self, ticker: str, cb: Callable[[str, float], None]) -> None:
        """Register a confirmed-breakout callback: cb(direction, price)."""
        with self._lock:
            if cb not in self._breakout_subs[ticker]:
                self._breakout_subs[ticker].append(cb)
        logger.info("[OrbDataHub] breakout subscriber added for %s", ticker)

    def subscribe_reversal(self, ticker: str, cb: Callable[[str, float], None]) -> None:
        """Register a reversal-confirmed callback: cb(direction, price).
        Only REVERSAL-profile engines subscribe here."""
        with self._lock:
            if cb not in self._reversal_subs[ticker]:
                self._reversal_subs[ticker].append(cb)
        logger.info("[OrbDataHub] reversal subscriber added for %s", ticker)

    def subscribe_retest_events(self, ticker: str, cb: Callable[[str, str], None]) -> None:
        """Register a retest-event callback: cb(level, message) — level is a
        debug-log level string ("INFO"/"WARN"/"SUCCESS"), message is
        human-readable, meant to be passed straight to engine.debug.emit()."""
        with self._lock:
            if cb not in self._retest_event_subs[ticker]:
                self._retest_event_subs[ticker].append(cb)

    def unsubscribe(self, ticker: str, cb: Callable) -> None:
        """Remove a callback from bar, ORB, breakout, reversal, and retest-event subscriptions."""
        with self._lock:
            for registry in (self._bar_subs, self._orb_subs, self._breakout_subs,
                             self._reversal_subs, self._retest_event_subs):
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
            # Wall-clock receipt time (not bar.ts, which is the bar's own start
            # time) — this is a "how long since we last heard anything" check,
            # so it must reflect when we actually got it.
            self._last_bar_at = datetime.utcnow()
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

    def publish_breakout_confirmed(self, ticker: str, direction: str, price: float) -> None:
        """
        Announce a confirmed (3-min-survived) breakout to engines listening on
        this ticker. direction is "CALL" | "PUT"; price is the confirming tick.
        """
        with self._lock:
            listeners = list(self._breakout_subs.get(ticker, ()))
        logger.info("[OrbDataHub] breakout confirmed %s %s @ %.2f → %d listener(s)",
                    ticker, direction, price, len(listeners))
        for cb in listeners:
            try:
                cb(direction, price)
            except Exception as e:
                logger.error("[OrbDataHub] breakout subscriber error for %s: %s",
                             ticker, e, exc_info=True)

    def publish_reversal_confirmed(self, ticker: str, direction: str,
                                   price: float, score: int) -> None:
        """
        Announce a scored reversal to REVERSAL-profile engines on this ticker.
        direction is the OPPOSITE of the original breakout ("CALL" if original
        was PUT, "PUT" if original was CALL). score is the reversal confidence
        (out of 5) for logging / debug visibility.
        """
        with self._lock:
            listeners = list(self._reversal_subs.get(ticker, ()))
        logger.info(
            "[OrbDataHub] reversal confirmed %s %s @ %.2f score=%d/5 → %d listener(s)",
            ticker, direction, price, score, len(listeners),
        )
        for cb in listeners:
            try:
                cb(direction, price)
            except Exception as e:
                logger.error("[OrbDataHub] reversal subscriber error for %s: %s",
                             ticker, e, exc_info=True)

    def publish_retest_event(self, ticker: str, level: str, message: str) -> None:
        """Fan out one retest-state-machine transition to every engine watching
        this ticker's Debug tab. Best-effort — a subscriber error here must
        never break the breakout pipeline itself."""
        with self._lock:
            listeners = list(self._retest_event_subs.get(ticker, ()))
        for cb in listeners:
            try:
                cb(level, message)
            except Exception as e:
                logger.error("[OrbDataHub] retest-event subscriber error for %s: %s",
                             ticker, e, exc_info=True)

    # ── Per-ticker retest-attempt cap ─────────────────────────────────────────

    def set_max_retest_attempts(self, ticker: str, attempts: int) -> None:
        """Register the highest max_retest_attempts among strategies currently
        watching `ticker` — called by ORBEngine whenever its config is applied.
        Monotonic (only raises, never lowers) within a session; the daily
        clear_max_retest_attempts() call bounds how stale a lowered/removed
        strategy's registration can get to at most one trading day."""
        with self._lock:
            current = self._max_retest_attempts.get(ticker, 0)
            if attempts > current:
                self._max_retest_attempts[ticker] = attempts

    def get_max_retest_attempts(self, ticker: str, default: int = 1) -> int:
        with self._lock:
            return self._max_retest_attempts.get(ticker, default)

    def clear_max_retest_attempts(self) -> None:
        """Called once daily (alongside the retest-state reset) so a strategy
        that's since been deleted or turned down can't keep a ticker's cap
        artificially high forever."""
        with self._lock:
            self._max_retest_attempts.clear()

    # ── Queries (called by ORBEngine) ────────────────────────────────────────

    def get_recent_bars(self, ticker: str) -> list[OrbBar]:
        with self._lock:
            buf = self._recent_bars.get(ticker)
            return list(buf) if buf else []

    def get_status(self, ticker: str) -> Optional[OrbStatus]:
        with self._lock:
            return self._status.get(ticker)

    # ── Service liveness ──────────────────────────────────────────────────────

    def set_service_running(self, running: bool) -> None:
        """OrbService reports its run state here so engines can gate on it."""
        with self._lock:
            self._service_running = running
        logger.info("[OrbDataHub] service_running set to %s", running)

    def is_service_running(self) -> bool:
        with self._lock:
            return self._service_running

    def seconds_since_last_bar(self) -> Optional[float]:
        """
        Seconds since any bar was received, or None if none has ever arrived
        this process lifetime. A large value while is_service_running() is
        True is the stale-feed signature the 2026-07-09 outage was not caught
        by — "running" was true, but nothing was actually flowing.
        """
        with self._lock:
            if self._last_bar_at is None:
                return None
            return (datetime.utcnow() - self._last_bar_at).total_seconds()


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
