"""
Live price streaming service.

A background thread polls yfinance every 5 seconds for all subscribed tickers
plus VIX and SPY, then broadcasts the result to every connected WebSocket client
via a per-connection queue.
"""
import json
import queue
import threading
import time
from typing import Optional

from log.logging_config import get_logger
from services.utils.market_hours import is_market_hours

logger = get_logger(__name__)

VIX_TICKER    = "^VIX"
SPY_TICKER    = "SPY"
POLL_INTERVAL = 5  # seconds


def _sentiment(vix: Optional[float]) -> dict:
    if vix is None:
        return {"label": "Unknown", "color": "gray"}
    if vix < 15:
        return {"label": "Calm",         "color": "green"}
    if vix < 20:
        return {"label": "Neutral",      "color": "gray"}
    if vix < 25:
        return {"label": "Cautious",     "color": "yellow"}
    if vix < 35:
        return {"label": "Fearful",      "color": "orange"}
    return     {"label": "Extreme Fear", "color": "red"}


class PriceStreamService:
    def __init__(self):
        self._ticker_refcounts: dict[str, int]   = {}
        self._queues:           list[queue.Queue] = []
        self._tickers_lock = threading.Lock()
        self._queues_lock  = threading.Lock()
        self._running      = False

    def start(self):
        if self._running:
            return
        self._running = True
        threading.Thread(target=self._loop, daemon=True, name="price-stream").start()
        logger.info("[PriceStream] background loop started (interval=%ds)", POLL_INTERVAL)

    # ── subscription management ────────────────────────────────────────
    # Refcounted: a ticker stays in the poll set as long as at least one
    # client wants it, so one client unsubscribing (tab switch, disconnect)
    # never drops a ticker another client is still watching.

    def subscribe(self, ticker: str):
        ticker = ticker.upper()
        with self._tickers_lock:
            self._ticker_refcounts[ticker] = self._ticker_refcounts.get(ticker, 0) + 1

    def unsubscribe(self, ticker: str):
        ticker = ticker.upper()
        with self._tickers_lock:
            count = self._ticker_refcounts.get(ticker)
            if count is None:
                return
            if count <= 1:
                del self._ticker_refcounts[ticker]
            else:
                self._ticker_refcounts[ticker] = count - 1

    # ── per-connection queue registration ─────────────────────────────

    def add_client(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=5)
        with self._queues_lock:
            self._queues.append(q)
        return q

    def remove_client(self, q: queue.Queue):
        with self._queues_lock:
            try:
                self._queues.remove(q)
            except ValueError:
                pass

    # ── background loop ───────────────────────────────────────────────

    def _loop(self):
        while self._running:
            try:
                if is_market_hours():
                    self._broadcast()
            except Exception as exc:
                logger.error("[PriceStream] broadcast error: %s", exc)
            time.sleep(POLL_INTERVAL)

    def _broadcast(self):
        from services.portfolio.portfolio_service import batch_fetch_current_prices

        with self._tickers_lock:
            user_tickers = list(self._ticker_refcounts.keys())

        all_tickers = list({VIX_TICKER, SPY_TICKER} | set(user_tickers))

        try:
            prices = batch_fetch_current_prices(all_tickers)
        except Exception as exc:
            logger.warning("[PriceStream] price fetch failed: %s", exc)
            return

        vix = prices.get(VIX_TICKER)
        payload = json.dumps({
            "type":      "price_update",
            "prices":    prices,
            "vix":       vix,
            "spy":       prices.get(SPY_TICKER),
            "sentiment": _sentiment(vix),
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

        logger.debug("[PriceStream] broadcast to %d clients, VIX=%s", len(self._queues), vix)


price_stream = PriceStreamService()
