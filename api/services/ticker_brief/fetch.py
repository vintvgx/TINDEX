"""
Shared fetch helper for the Ticker Brief sections.

Every section endpoint goes through `cached(key, ttl, fn)`: a per-process
TTL cache with a lock PER KEY, so the app firing all section requests at
once for one ticker doesn't send several identical yfinance calls (the
first caller fetches, the rest wait and read the result). Failed fetches
retry a couple of times with a short backoff before giving up.

yfinance is only ever called server-side, through here.
"""

import logging
import threading
import time
from typing import Any, Callable

logger = logging.getLogger(__name__)

_RETRIES = 2              # attempts after the first
_BACKOFF_SECONDS = 0.6    # doubled each retry

_cache: dict = {}         # key -> (fetched_at, value)
_locks: dict = {}         # key -> threading.Lock
_locks_guard = threading.Lock()


def _lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = _locks[key] = threading.Lock()
        return lock


def peek(key: str):
    """(fetched_at, value) of the last good fetch for `key`, or None — used
    to serve a stale value when a refresh fails."""
    return _cache.get(key)


def cached(key: str, ttl_seconds: float, fn: Callable[[], Any]) -> tuple:
    """
    (value, fetched_at) for `key`, fetching with `fn` when the cached value
    is older than `ttl_seconds`. `fn` raising (after retries) propagates —
    the caller decides how to degrade. A value of None is never cached.
    """
    entry = _cache.get(key)
    if entry and time.time() - entry[0] < ttl_seconds:
        return entry[1], entry[0]
    with _lock_for(key):
        # Another request may have fetched while we waited for the lock.
        entry = _cache.get(key)
        if entry and time.time() - entry[0] < ttl_seconds:
            return entry[1], entry[0]
        value = _with_retries(fn, key)
        fetched_at = time.time()
        if value is not None:
            _cache[key] = (fetched_at, value)
        return value, fetched_at


def _with_retries(fn: Callable[[], Any], key: str):
    delay = _BACKOFF_SECONDS
    last_err = None
    for attempt in range(_RETRIES + 1):
        try:
            return fn()
        except Exception as e:  # yfinance raises a wide variety of errors
            last_err = e
            if attempt < _RETRIES:
                logger.info("[ticker_brief] %s attempt %d failed: %s — retrying", key, attempt + 1, e)
                time.sleep(delay)
                delay *= 2
    raise last_err


def yf_ticker(symbol: str):
    import yfinance as yf
    return yf.Ticker(symbol)


def yf_info(symbol: str, ttl_seconds: float) -> dict:
    """yfinance `.info` — shared by the snapshot and analyst sections (one
    fetch serves both while fresh)."""
    def _fetch():
        info = yf_ticker(symbol).info
        if not info or len(info) < 3:
            raise RuntimeError("empty info response")
        return info
    value, _ = cached(f"info:{symbol}", ttl_seconds, _fetch)
    return value
