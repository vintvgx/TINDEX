"""
Per-engine in-memory debug log.

When a strategy's `debug_mode` is on, the engine emits a structured, color-coded
record at every decision point (ORB calc, skip reasons, breakout-confirm guards,
contract selection, capital checks, order submit, exits). The frontend Debug tab
in Trade Log & Stats polls these over REST so the user can see exactly why a trade
was or wasn't taken.

Storage is a bounded in-memory ring buffer (ephemeral — clears on restart). `emit`
is a no-op when debug is off, so instrumentation costs nothing in normal operation.
"""

import logging
import threading
from collections import deque
from datetime import datetime
from typing import Callable, Optional

import pytz

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

# Severity levels — the frontend maps each to a color.
LEVELS = ("DEBUG", "INFO", "WARN", "ERROR", "SUCCESS")


class DebugLogBuffer:
    """Thread-safe bounded ring buffer of debug events for one engine."""

    def __init__(self, enabled: Callable[[], bool], maxlen: int = 500):
        self._enabled = enabled
        self._lock = threading.Lock()
        self._buf: deque = deque(maxlen=maxlen)
        self._seq = 0

    def emit(self, level: str, message: str, data: Optional[dict] = None) -> None:
        """Append a record. No-op when the engine's debug_mode is off."""
        try:
            if not self._enabled():
                return
            level = level.upper()
            if level not in LEVELS:
                level = "INFO"
            with self._lock:
                self._seq += 1
                self._buf.append({
                    "id":      self._seq,
                    "ts":      datetime.now(ET).isoformat(),
                    "level":   level,
                    "message": message,
                    "data":    data,
                })
        except Exception as e:  # never let logging break the trade path
            logger.debug("[DebugLogBuffer] emit failed: %s", e)

    def snapshot(self, since_id: int = 0) -> list[dict]:
        """Return records with id > since_id (0 = all), oldest first."""
        with self._lock:
            return [r for r in self._buf if r["id"] > since_id]

    def clear(self) -> None:
        """Drop all buffered records."""
        with self._lock:
            self._buf.clear()
