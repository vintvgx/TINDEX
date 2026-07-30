"""
Real-time equity last-trade streaming for chart viewing, via Alpaca's
StockDataStream — deliberately using the PAPER account's key pair
(ALPACA_PAPER_API_KEY/SECRET_KEY) rather than the live keys.

Alpaca allows only one live market-data WebSocket connection per account
per feed (see AlpacaStreamingService's incident notes — the ORB engines'
own stock stream already claims that slot on the LIVE account). Paper and
live are distinct Alpaca accounts with independent connection allowances,
so a stream opened under the paper keys is fully isolated from the ORB
engines' feed — it can never contend with, delay, or drop the live trading
engine's own bar-close detection. The paper key pair is otherwise only used
elsewhere in this app for REST TradingClient calls (account/positions/
orders), never for a streaming connection, so this is the sole consumer of
that connection slot.

Read-only / display-only: never places orders or touches the paper
trading client itself, just reuses its market-data entitlement.
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
