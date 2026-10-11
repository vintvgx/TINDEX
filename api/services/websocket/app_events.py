"""
App-wide push channel: /ws/app (polling audit C2).

One socket per phone carries "what changed" notices instead of the phone
polling every endpoint every few seconds:

    {"type": "invalidate", "topics": ["positions", "account"]}
    {"type": "trade_update", ...}          (an Alpaca fill/cancel, see C1)

On "invalidate" the app refetches just those queries through the normal
REST endpoints (which are server-cached — A5). Push-to-refresh keeps a
single source of truth for every payload shape: the socket never has to
duplicate what the endpoints return.

Topics:
    positions  — a fill/close/cancel on either account
    account    — balances may have changed (same triggers as positions)
    pending    — a trade confirmation was created/resolved/expired

Each connected client has a coalescing mailbox: bursts of the same topic
collapse into one notice, sent at most every MIN_INTERVAL_S.
"""
import threading
import time

MIN_INTERVAL_S = 0.5
MAX_EVENTS = 20   # trade_update events buffered per client between sends


class AppMailbox:
    def __init__(self):
        self._cond = threading.Condition()
        self._topics: set = set()
        self._events: list = []
        self._last_sent = float("-inf")

    def put_topics(self, topics) -> None:
        with self._cond:
            self._topics.update(topics)
            self._cond.notify()

    def put_event(self, event: dict) -> None:
        with self._cond:
            self._events.append(event)
            del self._events[:-MAX_EVENTS]   # keep the newest
            self._cond.notify()

    def next(self, timeout: float) -> "tuple[list, list] | None":
        """Block until something is due (rate-limited), or `timeout` passes
        with nothing (None — the caller sends a keepalive). Returns
        (topics, events)."""
        deadline = time.monotonic() + timeout
        with self._cond:
            while True:
                now = time.monotonic()
                if self._topics or self._events:
                    wait = self._last_sent + MIN_INTERVAL_S - now
                    if wait <= 0:
                        topics, events = sorted(self._topics), self._events
                        self._topics, self._events = set(), []
                        self._last_sent = now
                        return topics, events
                else:
                    wait = deadline - now
                    if wait <= 0:
                        return None
                self._cond.wait(min(wait, max(deadline - now, 0.01)))
                if time.monotonic() >= deadline and not (self._topics or self._events):
                    return None


class AppEventBus:
    def __init__(self):
        self._clients: list = []
        self._lock = threading.Lock()

    def register(self) -> AppMailbox:
        box = AppMailbox()
        with self._lock:
            self._clients.append(box)
        return box

    def unregister(self, box: AppMailbox) -> None:
        with self._lock:
            if box in self._clients:
                self._clients.remove(box)

    def client_count(self) -> int:
        with self._lock:
            return len(self._clients)

    def notify(self, *topics: str) -> None:
        with self._lock:
            boxes = list(self._clients)
        for b in boxes:
            b.put_topics(topics)

    def publish_event(self, event: dict) -> None:
        with self._lock:
            boxes = list(self._clients)
        for b in boxes:
            b.put_event(event)


_bus = AppEventBus()


def get_app_event_bus() -> AppEventBus:
    return _bus


def notify_app(*topics: str) -> None:
    """Fire-and-forget "these changed" for every connected phone. Safe to call
    from any thread; never raises."""
    try:
        _bus.notify(*topics)
    except Exception:
        pass
