"""
Per-client mailbox for /ws/strategy/<id>/live (2026-10-13).

Replaces the plain queue.Queue(maxsize=50) each socket used to get. With a
FIFO, a client that stopped reading — the app backgrounded (iOS suspends it
but the socket stays open), or a slow network — piled up to 50 stale price
updates (~17s at 3/s), and once full, put_nowait DROPPED THE NEWEST ones.
On resume the phone replayed that whole backlog: position P&L and account
equity visibly ticked through ~10s of old prices before reaching the real
one.

Here price-type messages coalesce: only the newest `price_update` and
`pending_price_update` are kept (an unread older one is simply replaced),
while event messages (`position_closed`, anything else) are kept in order —
those must never be dropped. Drop-in for the engine's fan-out
(`put_nowait`) and the route's read loop (`get(timeout=…)` raising
queue.Empty).
"""
import queue
import threading
import time

# Message kinds where only the latest matters.
_COALESCE = ('"type": "price_update"', '"type": "pending_price_update"')
_MAX_EVENTS = 20


def _kind(payload: str) -> str | None:
    head = payload[:64]
    for k in _COALESCE:
        if k in head:
            return k
    return None


class LiveMailbox:
    def __init__(self):
        self._cond = threading.Condition()
        self._latest: dict = {}     # kind -> newest payload (unsent)
        self._order: list = []      # send order: ("latest", kind) | ("event", payload)

    def put_nowait(self, payload: str) -> None:
        kind = _kind(payload)
        with self._cond:
            if kind is not None:
                if kind not in self._latest:
                    self._order.append(("latest", kind))
                self._latest[kind] = payload      # replace any unsent older one
            else:
                self._order.append(("event", payload))
                # Bound memory for a client that never reads; events past the
                # cap are the oldest ones.
                events = [i for i, (t, _) in enumerate(self._order) if t == "event"]
                if len(events) > _MAX_EVENTS:
                    del self._order[events[0]]
            self._cond.notify()

    def get(self, timeout: float) -> str:
        deadline = time.monotonic() + timeout
        with self._cond:
            while not self._order:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise queue.Empty
                self._cond.wait(remaining)
            tag, val = self._order.pop(0)
            if tag == "latest":
                return self._latest.pop(val)
            return val

    def qsize(self) -> int:
        with self._cond:
            return len(self._order)
