"""
Tiny in-process TTL cache with single-flight, for hot polled endpoints.

The app polls position endpoints every 5s from several places at once
(Home island, Open page, account strip, Positions tab — and more phones/tabs
multiply that). Each poll used to cost its own Alpaca call. With this, all
requests for the same key inside `ttl` share one fetch; requests arriving
while that fetch is in flight wait for it instead of starting their own
(polling audit 2026-10-07, A5).

One gunicorn worker, so a process-local dict IS the shared cache.
"""
import threading
import time
from typing import Any, Callable, Hashable

_MISSING = object()


class ShortCache:
    def __init__(self, ttl: float):
        self.ttl = ttl
        self._lock = threading.Lock()
        self._entries: dict = {}        # key -> (expires_at, value)
        self._key_locks: dict = {}      # key -> Lock (single-flight)
        self._generation = 0            # bumped by clear(); see get_or_compute

    def get_or_compute(self, key: Hashable, compute: Callable[[], Any],
                       cacheable: Callable[[Any], bool] = lambda v: True) -> Any:
        """Cached value for `key`, else compute() it once (concurrent callers
        wait for that one call). A result is stored only if cacheable(result)
        — e.g. skip errors so a failed fetch is retried on the next request."""
        hit = self._fresh(key)
        if hit is not _MISSING:
            return hit
        with self._lock:
            key_lock = self._key_locks.setdefault(key, threading.Lock())
        with key_lock:
            hit = self._fresh(key)  # filled while we waited
            if hit is not _MISSING:
                return hit
            with self._lock:
                gen = self._generation
            value = compute()
            if cacheable(value):
                with self._lock:
                    # A clear() during compute() means the state changed under
                    # us (e.g. a sell) — don't store a possibly pre-change value.
                    if gen == self._generation:
                        self._entries[key] = (time.monotonic() + self.ttl, value)
            return value

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._generation += 1

    def _fresh(self, key: Hashable) -> Any:
        with self._lock:
            entry = self._entries.get(key)
        if entry and entry[0] > time.monotonic():
            return entry[1]
        return _MISSING
