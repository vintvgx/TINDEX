"""
Real-time option quote streaming via Alpaca's OptionDataStream WebSocket.

One shared connection per process; multiple ORBEngines subscribe their
active contract symbols and receive mid-price callbacks.

Lifecycle per trade:
  1. ORBEngine._enter_trade → verify_stream(symbol, timeout=8)
       → True:  subscribe(symbol, engine._on_stream_quote), place order
       → False: notify user, skip trade
  2. While position open: _on_stream_quote fires on every bid/ask update
  3. ORBEngine._handle_exit_action (full close) → unsubscribe(symbol, cb)
"""

import os
import queue
import threading
import logging

logger = logging.getLogger(__name__)

try:
    from alpaca.data.live.option import OptionDataStream
    HAS_STREAM = True
except ImportError:
    HAS_STREAM = False
    logger.warning("[OptionStream] alpaca.data.live.option not available — streaming disabled")


class OptionStreamManager:
    """
    Thread-safe wrapper around Alpaca's OptionDataStream.

    Usage
    -----
    manager = OptionStreamManager()

    # Before trade entry — confirms the symbol is actively quoted
    ok = manager.verify_stream("SPY240101C00500000", timeout=8)

    # After order placed — subscribe for ongoing price updates
    manager.subscribe("SPY240101C00500000", callback)

    # On full exit — unsubscribe
    manager.unsubscribe("SPY240101C00500000", callback)
    """

    def __init__(self):
        self._api_key = os.getenv("ALPACA_API_KEY", "")
        self._secret  = os.getenv("ALPACA_SECRET_KEY", "")
        self._stream: "OptionDataStream | None" = None
        self._thread: threading.Thread | None    = None
        self._callbacks: dict[str, list]         = {}   # symbol → [cb, ...]
        self._lock    = threading.Lock()
        self._started = False

    # ── Public API ─────────────────────────────────────────────────────────────

    def subscribe(self, symbol: str, callback):
        """
        Register callback(mid_price: float) for real-time mid-price updates.
        Starts the WebSocket thread on first call.
        """
        if not HAS_STREAM:
            return
        self._ensure_started()
        with self._lock:
            if symbol not in self._callbacks:
                self._callbacks[symbol] = []
                self._stream.subscribe_quotes(self._make_handler(symbol), symbol)
            self._callbacks[symbol].append(callback)
        logger.info("[OptionStream] Subscribed %s (total cb=%d)",
                    symbol, len(self._callbacks[symbol]))

    def unsubscribe(self, symbol: str, callback=None):
        """
        Remove a specific callback (or ALL callbacks) for a symbol.
        When no callbacks remain the server subscription is cancelled.
        """
        with self._lock:
            if callback is None:
                self._callbacks.pop(symbol, None)
            else:
                cbs = self._callbacks.get(symbol, [])
                try:
                    cbs.remove(callback)
                except ValueError:
                    pass
                if not cbs:
                    self._callbacks.pop(symbol, None)

        if symbol not in self._callbacks and self._stream:
            try:
                self._stream.unsubscribe_quotes(symbol)
                logger.info("[OptionStream] Unsubscribed %s", symbol)
            except Exception as ex:
                logger.debug("[OptionStream] unsubscribe_quotes: %s", ex)

    def verify_stream(self, symbol: str, timeout: float = 8.0) -> bool:
        """
        Subscribe and wait for the first valid quote within `timeout` seconds.

        Returns True if a quote arrives (symbol is actively quoted).
        Returns False on timeout (do NOT enter the trade).

        NOTE: Called by ORBEngine._enter_trade before placing the order.
        """
        if not HAS_STREAM:
            logger.warning("[OptionStream] Streaming not available — skipping verify")
            return False

        result_q: queue.Queue = queue.Queue()

        def _probe(mid: float):
            if result_q.empty():
                result_q.put(mid)

        self.subscribe(symbol, _probe)
        try:
            result_q.get(timeout=timeout)
            logger.info("[OptionStream] Stream verified for %s", symbol)
            return True
        except queue.Empty:
            logger.warning("[OptionStream] No quote for %s in %.0fs — not streamable",
                           symbol, timeout)
            return False
        finally:
            self.unsubscribe(symbol, _probe)

    def stop(self):
        """Shut down the WebSocket connection."""
        if self._stream:
            try:
                self._stream.stop_ws()
            except Exception:
                pass
        self._started = False

    # ── Internal ───────────────────────────────────────────────────────────────

    def _ensure_started(self):
        if self._started:
            return
        try:
            self._stream = OptionDataStream(self._api_key, self._secret)
            self._thread = threading.Thread(
                target=self._stream.run,
                daemon=True,
                name="OptionDataStream",
            )
            self._thread.start()
            self._started = True
            logger.info("[OptionStream] WebSocket thread started")
        except Exception as ex:
            logger.error("[OptionStream] Failed to start: %s", ex)

    def _make_handler(self, symbol: str):
        """Return an async quote handler that fans out to all registered callbacks."""
        async def _handler(quote):
            ask = getattr(quote, "ask_price", None)
            bid = getattr(quote, "bid_price", None)
            if not ask or not bid or float(ask) <= 0 or float(bid) <= 0:
                return
            mid = (float(ask) + float(bid)) / 2
            with self._lock:
                targets = list(self._callbacks.get(symbol, []))
            for cb in targets:
                try:
                    cb(mid)
                except Exception as ex:
                    logger.error("[OptionStream] callback error for %s: %s", symbol, ex)
        return _handler
