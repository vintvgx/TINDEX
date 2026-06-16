"""
ORB engine debug log — ALWAYS ON, persisted to Supabase.

Every engine decision point (ORB calc, skip reasons, breakout-confirm guards,
contract selection, capital checks, order submit, exits) is recorded. There is no
on/off toggle anymore: `emit` always runs, appends to a small in-memory ring (kept
for the legacy /strategy/debug-logs endpoint), and enqueues the row to a background
writer that batch-inserts into the `orb_debug_logs` Supabase table. The frontend
Debug tab reads that table directly.

The writer runs on a daemon thread and is fully best-effort — persistence never
blocks or breaks the trade path.
"""

import os
import queue
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


class _SupabaseDebugWriter:
    """
    Process-wide background writer. Decouples Supabase persistence from the engine's
    hot path: emit() enqueues a row, a single daemon thread drains and batch-inserts.
    """

    def __init__(self, maxsize: int = 10_000):
        self._q: "queue.Queue[dict]" = queue.Queue(maxsize=maxsize)
        self._client = None
        self._started = False
        self._lock = threading.Lock()

    def _ensure_started(self) -> None:
        if self._started:
            return
        with self._lock:
            if self._started:
                return
            try:
                from supabase import create_client
                url = os.getenv("SUPABASE_URL")
                key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
                if url and key:
                    self._client = create_client(url, key)
                else:
                    logger.warning("[DebugWriter] Supabase creds missing — debug logs not persisted")
            except Exception as e:
                logger.warning("[DebugWriter] client init failed: %s", e)
                self._client = None
            threading.Thread(target=self._run, name="orb-debug-writer", daemon=True).start()
            self._started = True

    def enqueue(self, row: dict) -> None:
        self._ensure_started()
        if self._client is None:
            return
        try:
            self._q.put_nowait(row)
        except queue.Full:
            pass  # drop under extreme load — never block the trade path

    def _run(self) -> None:
        while True:
            try:
                batch = [self._q.get()]                  # block until at least one row
                for _ in range(199):                     # drain up to 200/batch
                    try:
                        batch.append(self._q.get_nowait())
                    except queue.Empty:
                        break
                try:
                    self._client.table("orb_debug_logs").insert(batch).execute()
                except Exception as e:
                    logger.debug("[DebugWriter] insert failed (%d rows): %s", len(batch), e)
            except Exception as e:
                logger.debug("[DebugWriter] loop error: %s", e)


_writer = _SupabaseDebugWriter()


class DebugLogBuffer:
    """In-memory ring + Supabase persistence for one engine's debug events."""

    def __init__(self, enabled: Optional[Callable[[], bool]] = None, maxlen: int = 500):
        # `enabled` is accepted for backwards compatibility but IGNORED — debug is
        # always on now and every event is persisted to Supabase.
        self._lock = threading.Lock()
        self._buf: deque = deque(maxlen=maxlen)
        self._seq = 0
        self._ctx = {"strategy_id": None, "ticker": None, "strategy_name": None}

    def set_context(self, strategy_id=None, ticker=None, strategy_name=None) -> None:
        """Identify which engine these events belong to (written on every row)."""
        self._ctx = {
            "strategy_id":   strategy_id,
            "ticker":        ticker,
            "strategy_name": strategy_name,
        }

    def emit(self, level: str, message: str, data: Optional[dict] = None) -> None:
        """Append to the ring buffer and persist to Supabase (best-effort)."""
        try:
            level = (level or "INFO").upper()
            if level not in LEVELS:
                level = "INFO"
            ts = datetime.now(ET).isoformat()
            with self._lock:
                self._seq += 1
                self._buf.append({
                    "id":      self._seq,
                    "ts":      ts,
                    "level":   level,
                    "message": message,
                    "data":    data,
                })
            _writer.enqueue({
                "ts":            ts,
                "strategy_id":   self._ctx.get("strategy_id"),
                "ticker":        self._ctx.get("ticker"),
                "strategy_name": self._ctx.get("strategy_name"),
                "level":         level,
                "message":       message,
                "data":          data,
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
