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
import time
import logging
from datetime import date, datetime

logger = logging.getLogger(__name__)

# How often the background health-logger dumps the full subscription list to
# the server log (2026-08-12 — added after a suspicion that subscriptions
# are additive/persistent on Alpaca's side with no automatic expiry: every
# subscribe() that isn't matched by a later unsubscribe() stays on this
# connection indefinitely, across reconnects too, since _ensure_started's
# post-restart resubscribe walks self._callbacks verbatim. A 0DTE-heavy usage
# pattern generates a brand-new symbol every trading day, so a leak here
# creeps quietly toward whatever channel cap the account's data plan has —
# invisible in week one, a real problem after months of running. This is the
# log trail to confirm (or rule out) that theory over time, independent of
# whatever's currently visible in the Service Status screen at any one
# moment.
HEALTH_LOG_INTERVAL_SEC = 1800

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
        self._api_key = os.getenv("ALPACA_LIVE_API_KEY", "")
        self._secret  = os.getenv("ALPACA_LIVE_SECRET_KEY", "")
        self._stream: "OptionDataStream | None" = None
        self._thread: threading.Thread | None    = None
        self._callbacks: dict[str, list]         = {}   # symbol → [cb, ...]
        self._lock       = threading.Lock()
        self._start_lock = threading.Lock()
        self._started    = False
        # Staleness tracking (2026-08-11) — _ensure_started's thread-liveness
        # check catches a fully DEAD thread, but not a "connected zombie": a
        # WS that's technically still running but has quietly stopped
        # delivering ticks (a degraded connection Alpaca hasn't formally
        # closed, a subscribe that silently no-op'd). Recording wall-clock
        # time of the last quote actually received — globally and per-symbol
        # — is what lets a caller distinguish "no ticks for this ONE thin
        # contract" from "nothing has arrived on this connection in minutes,"
        # and is what get_health() below surfaces to the Service Status
        # screen and to _enter_trade's post-failure diagnostics.
        self._last_quote_at: dict[str, float] = {}   # symbol → epoch seconds
        self._last_quote_at_any: float | None = None  # across ALL symbols
        self._quote_count: dict[str, int]     = {}   # symbol → lifetime tick count (this process)
        self._health_log_started = False

    # ── Public API ─────────────────────────────────────────────────────────────

    def subscribe(self, symbol: str, callback):
        """
        Register callback(mid_price: float) for real-time mid-price updates.
        Starts the WebSocket thread on first call.
        """
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
            # alpaca-py's subscribe_quotes() can block (e.g. websocket not yet
            # connected, or the asyncio bridge stalls). Run it off-thread so a
            # hang there can NEVER hold self._lock or the calling request thread
            # hostage — a single bad subscribe must not wedge every other
            # symbol's subscribe/unsubscribe for the rest of the process.
            threading.Thread(
                target=self._safe_subscribe_quotes, args=(symbol,),
                daemon=True, name=f"OptionStream-sub-{symbol}",
            ).start()
        logger.info("[OptionStream] Subscribed %s (total cb=%d)",
                    symbol, len(self._callbacks[symbol]))

    def _safe_subscribe_quotes(self, symbol: str):
        try:
            self._stream.subscribe_quotes(self._make_handler(symbol), symbol)
        except Exception as ex:
            logger.error("[OptionStream] subscribe_quotes failed for %s: %s", symbol, ex)

    def unsubscribe(self, symbol: str, callback=None):
        """
        Remove a specific callback (or ALL callbacks) for a symbol.
        When no callbacks remain the server subscription is cancelled.
        """
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
            # Same rationale as subscribe(): never block the caller or the lock
            # on alpaca-py's internal call.
            threading.Thread(
                target=self._safe_unsubscribe_quotes, args=(symbol,),
                daemon=True, name=f"OptionStream-unsub-{symbol}",
            ).start()

    def _safe_unsubscribe_quotes(self, symbol: str):
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

    @staticmethod
    def _occ_expiry(symbol: str) -> "date | None":
        """Best-effort expiry date parsed from an OCC option symbol
        (<ROOT><YYMMDD><C|P><strike*1000, 8 digits>). None if unparseable —
        callers treat that as "can't tell, don't flag it" rather than expired.
        """
        try:
            body = symbol[-15:]
            yy, mm, dd = body[0:2], body[2:4], body[4:6]
            return date(2000 + int(yy), int(mm), int(dd))
        except Exception:
            return None

    def get_health(self) -> dict:
        """
        Snapshot for the Service Status screen (GET /services/status) and for
        _enter_trade's post-verify_stream-failure diagnostics. Deliberately
        does NOT decide "stale" here — that requires knowing whether the
        market is even open, which this class has no business knowing about;
        the caller (monitoring_routes.py, which already has market-hours
        context for the ORB hub's own health check) applies that threshold.

        expired_symbols/expired_count (2026-08-12): subscriptions are
        additive on Alpaca's side with no automatic expiry — a symbol only
        comes off this connection when unsubscribe() is explicitly called.
        Any OCC symbol in here whose parsed expiry is already in the past is
        proof a close/exit path failed to unsubscribe; this is the signal to
        watch for a slow leak toward the account's channel cap.
        """
        today = datetime.now().astimezone().date()
        with self._lock:
            running = bool(self._started and self._thread and self._thread.is_alive())
            subscribed = sorted(self._callbacks.keys())
            last_any = self._last_quote_at_any
            per_symbol = {
                sym: {
                    "last_quote_age_seconds": round(time.time() - ts, 1),
                    "quote_count": self._quote_count.get(sym, 0),
                }
                for sym, ts in self._last_quote_at.items()
            }
        expired = sorted(
            sym for sym in subscribed
            if (exp := self._occ_expiry(sym)) is not None and exp < today
        )
        return {
            "running":                 running,
            "subscribed_symbols":      subscribed,
            "subscribed_count":        len(subscribed),
            "expired_symbols":         expired,
            "expired_count":           len(expired),
            "last_quote_age_seconds":  round(time.time() - last_any, 1) if last_any is not None else None,
            "symbols":                 per_symbol,
        }

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
        # `_started` alone can't detect a dead connection — it's set once and
        # never reset, so if the background thread dies for any reason (a
        # dropped WS connection, a transient network blip), every future call
        # here saw _started=True and early-returned, leaving every subsequent
        # subscribe()/verify_stream() silently calling into a stream that no
        # longer exists. Every entry from that point on would fail stream
        # verification after its full 8s timeout — a wall that never heals
        # itself short of a full process restart. Checking thread liveness
        # (not just the flag) lets a dead stream actually be restarted.
        if self._started and self._thread and self._thread.is_alive():
            return
        with self._start_lock:
            if self._started and self._thread and self._thread.is_alive():
                return
            was_running = self._started
            if was_running:
                logger.warning("[OptionStream] background thread died — restarting")
            self._started = False
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
                return

            if not self._health_log_started:
                self._health_log_started = True
                threading.Thread(
                    target=self._health_log_loop, daemon=True,
                    name="OptionStream-health-log",
                ).start()

            if was_running:
                # A brand-new OptionDataStream instance starts with zero
                # subscriptions of its own — the normal alpaca-py reconnect
                # loop (_run_forever) re-subscribes automatically on an
                # ordinary WS drop, but that only works because it reconnects
                # the SAME instance; here we had to build a whole new one
                # because the background thread itself died. Without this,
                # every symbol tracked in self._callbacks from before the
                # crash — including a still-open swing/LEAPS position's price
                # feed — would silently go stale forever, since nothing else
                # ever calls subscribe() again for an already-open position.
                with self._lock:
                    symbols = list(self._callbacks.keys())
                for symbol in symbols:
                    threading.Thread(
                        target=self._safe_subscribe_quotes, args=(symbol,),
                        daemon=True, name=f"OptionStream-resub-{symbol}",
                    ).start()
                if symbols:
                    logger.info("[OptionStream] Re-subscribing %d symbol(s) after "
                                "restart: %s", len(symbols), symbols)

    def _health_log_loop(self):
        """
        Runs for the life of the process (started once, from _ensure_started).
        Dumps the full subscription list every HEALTH_LOG_INTERVAL_SEC so the
        server log has a standing trail of how it grows over days/weeks —
        the Service Status screen only shows a point-in-time snapshot, which
        is enough to confirm a leak but not to see how fast it's growing or
        catch it happening between checks.
        """
        while True:
            time.sleep(HEALTH_LOG_INTERVAL_SEC)
            try:
                health = self.get_health()
            except Exception as ex:
                logger.error("[OptionStream] health-log tick failed: %s", ex)
                continue
            if health["expired_count"] > 0:
                logger.warning(
                    "[OptionStream] subscription audit — %d active (%d EXPIRED, never "
                    "unsubscribed): %s | full list: %s",
                    health["subscribed_count"], health["expired_count"],
                    health["expired_symbols"], health["subscribed_symbols"],
                )
            else:
                logger.info(
                    "[OptionStream] subscription audit — %d active, 0 expired: %s",
                    health["subscribed_count"], health["subscribed_symbols"],
                )

    def _make_handler(self, symbol: str):
        """Return an async quote handler that fans out to all registered callbacks."""
        async def _handler(quote):
            ask = getattr(quote, "ask_price", None)
            bid = getattr(quote, "bid_price", None)
            ask_ok = ask is not None and float(ask) > 0
            bid_ok = bid is not None and float(bid) > 0
            # Relaxed 2026-08-11 — this used to require BOTH sides present,
            # silently dropping the entire tick otherwise. Option quotes are
            # routinely one-sided for brief stretches during fast/thin
            # conditions — exactly the moment an ORB breakout entry is
            # trying to verify the stream is alive. That meant verify_stream
            # could time out (and an automated SPY entry get skipped as
            # "blind") even while Alpaca was actively sending real ticks for
            # the symbol, just never with both sides simultaneously present
            # within the 8s window. A one-sided price is still meaningfully
            # better than treating the tick as if it never arrived at all —
            # both for the verify_stream liveness probe (which only cares
            # "is this symbol being quoted") and for live exit management on
            # an open position (a stale mid during a fast move is worse than
            # a slightly-approximate one). Only a genuinely empty quote
            # (neither side present) is still dropped.
            if not ask_ok and not bid_ok:
                return
            if ask_ok and bid_ok:
                mid = (float(ask) + float(bid)) / 2
            else:
                mid = float(ask) if ask_ok else float(bid)

            now = time.time()
            with self._lock:
                self._last_quote_at[symbol] = now
                self._last_quote_at_any     = now
                self._quote_count[symbol]   = self._quote_count.get(symbol, 0) + 1
                targets = list(self._callbacks.get(symbol, []))
            for cb in targets:
                try:
                    cb(mid)
                except Exception as ex:
                    logger.error("[OptionStream] callback error for %s: %s", symbol, ex)
        return _handler
