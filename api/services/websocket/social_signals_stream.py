"""
Live price broadcast for tracked social-signal contracts.

Mirrors price_stream_service.py's shape deliberately: ONE shared background
thread + one shared OptionStreamManager subscription set for the whole
process, fanning out to every connected client via a per-client queue —
NOT one background thread per WebSocket connection.

This replaced an earlier version that spawned a dedicated resync thread
(and its own OptionStreamManager subscribe/unsubscribe calls) per
connection. That meant every reconnect left another thread running until
its 30s poll noticed the disconnect, and if the client was reconnecting
repeatedly (e.g. the connection was already unstable for some other
reason), each retry added more background Supabase/Alpaca load right when
the system was already struggling — a pile-on that could plausibly turn a
minor connection hiccup into the sustained connect/disconnect "flicker"
this was built to fix. One shared loop can't compound that way: N clients
connecting or reconnecting never changes how many background threads exist.

Shares app.py's single OptionStreamManager (injected via set_stream_manager()
before start() is called) rather than owning a second one — this account's
Alpaca plan allows only ONE live option-stream connection per API key. An
earlier version opened its own manager for isolation from ORB-engine init
failures, but two managers meant two competing connections: Alpaca rejected
the second with "connection limit exceeded", and alpaca-py's reconnect loop
then retried in a tight, backoff-free spin that ran up real Railway
compute/network cost. Isolation from ORB engine init is preserved a
different way: the shared manager is constructed at module scope in app.py,
before the ORB engine's try/except block, so its construction can't be taken
down by an ORB-side failure — only injection into this service needs to
happen before start(), which app.py does unconditionally.
"""

import json
import queue
import threading
import time
from typing import Optional

from log.logging_config import get_logger

logger = get_logger(__name__)

POLL_INTERVAL_SECONDS = 30


class SocialSignalsStreamService:
    def __init__(self):
        self._subscribed: dict[str, "callable"] = {}  # contract_symbol -> callback
        self._queues: list[queue.Queue] = []
        self._queues_lock = threading.Lock()
        self._running = False
        self._stream_manager = None  # injected — see set_stream_manager

    def set_stream_manager(self, manager):
        """Inject the shared OptionStreamManager. Must be called before start()."""
        self._stream_manager = manager

    def start(self):
        if self._running:
            return
        self._running = True
        threading.Thread(target=self._loop, daemon=True, name="social-signals-stream").start()
        logger.info("[SocialSignalsStream] background loop started (interval=%ds)", POLL_INTERVAL_SECONDS)

    def _ensure_stream_manager(self):
        if self._stream_manager is None:
            raise RuntimeError(
                "SocialSignalsStreamService.set_stream_manager() was never called — "
                "no shared OptionStreamManager available"
            )
        return self._stream_manager

    # ── per-connection queue registration ─────────────────────────────

    def add_client(self) -> "queue.Queue":
        q: "queue.Queue" = queue.Queue(maxsize=100)
        with self._queues_lock:
            self._queues.append(q)
        logger.info("[SocialSignalsStream] client connected (total=%d)", len(self._queues))
        return q

    def remove_client(self, q: "queue.Queue"):
        with self._queues_lock:
            try:
                self._queues.remove(q)
            except ValueError:
                pass
            remaining = len(self._queues)
        logger.info("[SocialSignalsStream] client disconnected (remaining=%d)", remaining)

    # ── background loop ───────────────────────────────────────────────

    def _loop(self):
        while self._running:
            t0 = time.time()
            try:
                self._resync()
                logger.info("[SocialSignalsStream] resync ok — %d tracked, %.2fs",
                            len(self._subscribed), time.time() - t0)
            except Exception as exc:
                logger.warning("[SocialSignalsStream] resync error after %.2fs: %s",
                               time.time() - t0, exc)
            time.sleep(POLL_INTERVAL_SECONDS)

    def _resync(self):
        from services.supabase.supabase_service import get_supabase_service

        rows = (
            get_supabase_service().client.table("tracked_options_contracts")
            .select("contract_symbol")
            .eq("status", "tracking")
            .eq("tracked_from_source", "social_signal")
            .execute().data or []
        )
        live_symbols = {r["contract_symbol"] for r in rows}
        stream = self._ensure_stream_manager()

        for symbol in live_symbols - self._subscribed.keys():
            cb = self._make_callback(symbol)
            self._subscribed[symbol] = cb
            stream.subscribe(symbol, cb)

        for symbol in list(self._subscribed.keys() - live_symbols):
            stream.unsubscribe(symbol, self._subscribed.pop(symbol))

    def _make_callback(self, symbol: str):
        def _cb(mid_price: float):
            payload = json.dumps({
                "type": "price_update",
                "contract_symbol": symbol,
                "mid_price": round(mid_price, 4),
            })
            with self._queues_lock:
                dead = []
                for q in self._queues:
                    try:
                        q.put_nowait(payload)
                    except queue.Full:
                        dead.append(q)
                for q in dead:
                    self._queues.remove(q)
        return _cb


social_signals_stream = SocialSignalsStreamService()
