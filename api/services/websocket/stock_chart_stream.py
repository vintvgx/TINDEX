"""
Real-time equity last-trade streaming for chart viewing, via Alpaca's
StockDataStream, using the ALPACA_PAPER_API_KEY/SECRET_KEY key pair.

Alpaca allows only one live market-data WebSocket connection PER USER — this
is a per-USER cap, not per sub-account. Paper and live are two trading
sub-accounts under the same user, sharing the same market-data connection
allowance, NOT independent slots (confirmed against Alpaca's own docs/forum,
2026-08-24 — see docs/incidents/2026-07-13-orb-stream-connection-limit.md
for the "connection limit exceeded" failure this originally caused: the
ORB engines' own live-key stock stream already held this account's one
slot, so a paper-keyed stream under the SAME Alpaca user collided with it
regardless of using different credentials). ALPACA_PAPER_API_KEY/SECRET_KEY
must point to a genuinely separate Alpaca account (its own signup, not
another paper sub-account spun up under the primary user) for this stream
to actually be isolated from the ORB engines' feed. If those env vars ever
get pointed back at a paper sub-account of the SAME user as the live keys,
this will silently start colliding with OrbService's stream again.

Read-only / display-only: never places orders. Since the credentials now
point to an entirely separate account from the one used for real trading,
this is no longer "reusing the paper trading client's entitlement" — it's
an account that exists solely to hold this stream's connection slot.
"""

import os
import threading
import logging

logger = logging.getLogger(__name__)

try:
    from alpaca.data.live import StockDataStream
    from alpaca.data.enums import DataFeed
    HAS_STREAM = True
except ImportError:
    HAS_STREAM = False
    logger.warning("[ChartStream] alpaca.data.live not available — streaming disabled")


class ChartStreamManager:
    """
    Thread-safe wrapper around a paper-keyed Alpaca StockDataStream, fanning
    out real-time last-trade prices to whichever ticker(s) currently have a
    chart open. Mirrors OptionStreamManager's subscribe/unsubscribe/
    ensure-started lifecycle exactly, for the same reasons (never block the
    caller on alpaca-py's internal calls, restart a dead background thread,
    re-subscribe existing symbols after a restart).
    """

    def __init__(self):
        self._api_key = os.getenv("ALPACA_PAPER_API_KEY", "")
        self._secret  = os.getenv("ALPACA_PAPER_SECRET_KEY", "")
        self._stream: "StockDataStream | None" = None
        self._thread: threading.Thread | None    = None
        self._callbacks: dict[str, list]         = {}   # symbol → [cb, ...]
        self._lock       = threading.Lock()
        self._start_lock = threading.Lock()
        self._started    = False

    # ── Public API ─────────────────────────────────────────────────────────────

    def subscribe(self, symbol: str, callback):
        """Register callback(price: float) for real-time last-trade updates."""
        if not HAS_STREAM:
            return
        self._ensure_started()
        is_new = False
        with self._lock:
            if symbol not in self._callbacks:
                self._callbacks[symbol] = []
                is_new = True
            self._callbacks[symbol].append(callback)

        if is_new:
            # subscribe_trades() can block (websocket not yet connected, or the
            # asyncio bridge stalls) — run off-thread so a hang here can never
            # hold self._lock or the calling request thread hostage.
            threading.Thread(
                target=self._safe_subscribe_trades, args=(symbol,),
                daemon=True, name=f"ChartStream-sub-{symbol}",
            ).start()
        logger.info("[ChartStream] Subscribed %s (total cb=%d)",
                    symbol, len(self._callbacks[symbol]))

    def _safe_subscribe_trades(self, symbol: str):
        try:
            self._stream.subscribe_trades(self._make_handler(symbol), symbol)
        except Exception as ex:
            logger.error("[ChartStream] subscribe_trades failed for %s: %s", symbol, ex)

    def unsubscribe(self, symbol: str, callback=None):
        """Remove a specific callback (or ALL callbacks) for a symbol."""
        should_unsub = False
        with self._lock:
            if callback is None:
                self._callbacks.pop(symbol, None)
                should_unsub = True
            else:
                cbs = self._callbacks.get(symbol, [])
                try:
                    cbs.remove(callback)
                except ValueError:
                    pass
                if not cbs:
                    self._callbacks.pop(symbol, None)
                should_unsub = symbol not in self._callbacks

        if should_unsub and self._stream:
            threading.Thread(
                target=self._safe_unsubscribe_trades, args=(symbol,),
                daemon=True, name=f"ChartStream-unsub-{symbol}",
            ).start()

    def _safe_unsubscribe_trades(self, symbol: str):
        try:
            self._stream.unsubscribe_trades(symbol)
            logger.info("[ChartStream] Unsubscribed %s", symbol)
        except Exception as ex:
            logger.debug("[ChartStream] unsubscribe_trades: %s", ex)

    def stop(self):
        """Shut down the WebSocket connection. Mirrors OptionStreamManager.stop()
        — not currently called anywhere (this manager lives for the process
        lifetime, same as OptionStreamManager), but present so a future
        graceful-shutdown path has something to call rather than abandoning
        the connection for the OS/Alpaca's server-side timeout to notice."""
        if self._stream:
            try:
                self._stream.stop_ws()
            except Exception:
                pass
        self._started = False

    # ── Internal ───────────────────────────────────────────────────────────────

    def _ensure_started(self):
        # Same rationale as OptionStreamManager: check thread liveness (not
        # just the flag) so a dead background thread actually gets restarted
        # instead of every future subscribe() silently calling into a stream
        # that no longer exists.
        if self._started and self._thread and self._thread.is_alive():
            return
        with self._start_lock:
            if self._started and self._thread and self._thread.is_alive():
                return
            was_running = self._started
            if was_running:
                logger.warning("[ChartStream] background thread died — restarting")
            self._started = False
            try:
                self._stream = StockDataStream(self._api_key, self._secret, feed=DataFeed.IEX)
                self._thread = threading.Thread(
                    target=self._stream.run,
                    daemon=True,
                    name="ChartDataStream",
                )
                self._thread.start()
                self._started = True
                logger.info("[ChartStream] WebSocket thread started")
            except Exception as ex:
                logger.error("[ChartStream] Failed to start: %s", ex)
                return

            if was_running:
                with self._lock:
                    symbols = list(self._callbacks.keys())
                for symbol in symbols:
                    threading.Thread(
                        target=self._safe_subscribe_trades, args=(symbol,),
                        daemon=True, name=f"ChartStream-resub-{symbol}",
                    ).start()
                if symbols:
                    logger.info("[ChartStream] Re-subscribing %d symbol(s) after restart: %s",
                                len(symbols), symbols)

    def _make_handler(self, symbol: str):
        """Return an async trade handler that fans out to all registered callbacks."""
        async def _handler(trade):
            price = getattr(trade, "price", None)
            if not price or float(price) <= 0:
                return
            with self._lock:
                targets = list(self._callbacks.get(symbol, []))
            for cb in targets:
                try:
                    cb(float(price))
                except Exception as ex:
                    logger.error("[ChartStream] callback error for %s: %s", symbol, ex)
        return _handler


chart_stream = ChartStreamManager()
