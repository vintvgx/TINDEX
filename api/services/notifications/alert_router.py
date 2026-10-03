"""
Notification engine v2 — decides HOW each zone alert reaches each user.

StructureTracker produces the events (with its own per-ticker caps and the
09:30-10:00 entry-signal window); this router layers on top of it:

  Channels (iOS interruption levels — only the money event interrupts):
    approach      starred → QUIET push; unstarred or outside 09:30-16:00 ET → in-app
    confirmation  starred → ACTIVE push; unstarred → QUIET push
    invalidation  ACTIVE push only if the user holds a position on the
                  ticker; otherwise in-app
    failed_break / info → in-app only

  Starred tickers: user_stock_follows.alert_starred (the bell on the ticker
  sheet). A user who hasn't starred anything has ALL followed tickers
  treated as starred, until the morning brief exists to pick a default.

  Global throttle (per user, across all tickers): at most 3 pushes per
  15 minutes. Individual pushes use at most 2 of those; anything beyond
  queues, and the queue goes out as ONE digest ("🔔 MU broke above $1100 ·
  NVDA approaching $233 · …") once it has collected for 60s and a throttle
  slot is free. Overflow is never dropped, and a digest counts as 1 push.

  Every event — pushed, queued, or in-app only — also lands in the user's
  in-app timeline (the `notifications` table the Notifications screen reads).

The decision logic (`choose_channel`, `_UserQueue`) is pure and clock-
injected so it can be tested without a database or Expo.
"""

import logging
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from typing import Callable

import pytz

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

ACTIVE, PASSIVE, INAPP = "active", "passive", "inapp"

THROTTLE_WINDOW_SECONDS = 15 * 60
THROTTLE_MAX_PUSHES = 3
# Individual pushes may use this many of the window's slots; the rest is
# kept for the digest, so overflow can always go out within the window.
INDIVIDUAL_MAX_PUSHES = 2
DIGEST_COALESCE_SECONDS = 60
DIGEST_MAX_ITEMS = 4
STARRED_CACHE_SECONDS = 60


def in_session(ts=None) -> bool:
    """09:30-16:00 ET, weekdays."""
    t = (ts if ts is not None else datetime.now(ET))
    t = (t if getattr(t, "tzinfo", None) else ET.localize(t)).astimezone(ET)
    if t.weekday() >= 5:
        return False
    minutes = t.hour * 60 + t.minute
    return 9 * 60 + 30 <= minutes < 16 * 60


def choose_channel(kind: str, starred: bool, session_open: bool, holds_position: bool) -> str:
    """Pure channel decision for one event and one user."""
    if kind == "approach":
        return PASSIVE if (starred and session_open) else INAPP
    if kind == "confirmation":
        return ACTIVE if starred else PASSIVE
    if kind == "invalidation":
        return ACTIVE if holds_position else INAPP
    return INAPP


class _UserQueue:
    """One user's throttle + digest state. Pure: the caller supplies `now`
    and gets back what to send."""

    def __init__(self):
        self.sent: deque = deque()     # timestamps of pushes in the window
        self.buffer: list = []         # queued events awaiting a digest
        self.buffer_since: float = None

    def _prune(self, now: float):
        while self.sent and now - self.sent[0] >= THROTTLE_WINDOW_SECONDS:
            self.sent.popleft()

    def offer(self, event: dict, now: float) -> "dict | None":
        """An event that should push. Returns it if it can go out now;
        otherwise queues it for the digest and returns None."""
        self._prune(now)
        if not self.buffer and len(self.sent) < INDIVIDUAL_MAX_PUSHES:
            self.sent.append(now)
            return event
        self.buffer.append(event)
        if self.buffer_since is None:
            self.buffer_since = now
        return None

    def flush(self, now: float) -> "dict | None":
        """The digest (or lone queued event) to send now, if any."""
        self._prune(now)
        if not self.buffer or now - self.buffer_since < DIGEST_COALESCE_SECONDS:
            return None
        if len(self.sent) >= THROTTLE_MAX_PUSHES:
            return None  # wait for a slot; nothing is dropped
        events, self.buffer, self.buffer_since = self.buffer, [], None
        self.sent.append(now)
        return events[0] if len(events) == 1 else make_digest(events)


def make_digest(events: list) -> dict:
    shorts = [e["short"] for e in events[:DIGEST_MAX_ITEMS]]
    more = len(events) - DIGEST_MAX_ITEMS
    body = " · ".join(shorts) + (f" · +{more} more" if more > 0 else "")
    return {
        "kind": "digest",
        "title": "🔔 Zone alerts",
        "body": body,
        "short": body,
        "ticker": events[0].get("ticker"),
        "level": ACTIVE if any(e.get("level") == ACTIVE for e in events) else PASSIVE,
        "data": {"type": "digest", "ticker": events[0].get("ticker"), "count": len(events)},
    }


class AlertRouter:
    """Process-wide singleton. `route()` is called from StructureTracker on
    the bar thread, so it only does cheap work inline: DB writes for the
    in-app timeline and push sends happen on the notifier's own thread /
    a small background flusher."""

    def __init__(self, sender: Callable = None, inapp_writer: Callable = None,
                 starred_lookup: Callable = None, position_lookup: Callable = None,
                 clock: Callable = time.time, start_flusher: bool = True):
        self._sender = sender or _default_sender
        self._inapp = inapp_writer or _default_inapp_writer
        self._starred = starred_lookup or _default_starred_lookup
        self._holds_position = position_lookup or _default_position_lookup
        self._clock = clock
        self._queues: dict = {}
        self._lock = threading.Lock()
        if start_flusher:
            threading.Thread(target=self._flush_loop, daemon=True, name="alert-router-flush").start()

    def route(self, event: dict, user_ids: list, pushable: bool = True) -> dict:
        """
        `event`: {kind, ticker, title, body, short, data, bar_ts}.
        `pushable`: False when StructureTracker's own gating (entry window,
        daily cap, once-per-level) already ruled out a push — the event
        still goes to the in-app timeline.
        Returns {user_id: channel or "queued"} for logging/tests.
        """
        out = {}
        session_open = in_session(event.get("bar_ts"))
        holds = self._safe(self._holds_position, event.get("ticker"), default=False) \
            if event["kind"] == "invalidation" else False
        for uid in user_ids:
            starred = self._safe(self._starred, uid, event.get("ticker"), default=True)
            channel = choose_channel(event["kind"], starred, session_open, holds) if pushable else INAPP
            self._safe(self._inapp, uid, event, default=None)
            if channel == INAPP:
                out[uid] = INAPP
                continue
            with self._lock:
                q = self._queues.setdefault(uid, _UserQueue())
                ready = q.offer({**event, "level": channel}, self._clock())
            if ready:
                self._safe(self._sender, uid, ready, default=None)
                out[uid] = channel
            else:
                out[uid] = "queued"
        return out

    def flush_due(self) -> list:
        """Send any digests that are due. Returns [(user_id, message)]."""
        sent = []
        now = self._clock()
        with self._lock:
            due = [(uid, q.flush(now)) for uid, q in self._queues.items()]
        for uid, msg in due:
            if msg:
                self._safe(self._sender, uid, msg, default=None)
                sent.append((uid, msg))
        return sent

    def _flush_loop(self):
        while True:
            time.sleep(5)
            try:
                self.flush_due()
            except Exception as e:
                logger.warning("[AlertRouter] flush failed: %s", e)

    @staticmethod
    def _safe(fn, *args, default=None):
        try:
            return fn(*args)
        except Exception as e:
            logger.warning("[AlertRouter] %s failed: %s", getattr(fn, "__name__", fn), e)
            return default


# ── Default I/O (production) ────────────────────────────────────────────────

_notifier = None
_starred_cache: dict = {}   # user_id -> (fetched_at, set_of_starred_tickers, has_any)


def _get_notifier():
    global _notifier
    if _notifier is None:
        from services.strategy.notifier import StrategyNotifier
        from services.supabase.supabase_service import get_supabase_service
        _notifier = StrategyNotifier(get_supabase_service().client)
    return _notifier


def _default_sender(user_id: str, msg: dict):
    _get_notifier().notify_zone_alert(
        msg["title"], msg["body"], [user_id],
        {**(msg.get("data") or {}), "ticker": msg.get("ticker")},
        interruption_level=msg.get("level", ACTIVE),
    )


def _default_inapp_writer(user_id: str, event: dict):
    from services.supabase.supabase_service import get_supabase_service
    get_supabase_service().client.table("notifications").insert({
        "user_id": user_id,
        "title": event["title"],
        "body": event["body"],
        "type": f"zone_{event['kind']}",
        "data": {**(event.get("data") or {}), "ticker": event.get("ticker"), "kind": event["kind"]},
        "is_read": False,
        "expires_at": (datetime.now(ET) + timedelta(days=7)).isoformat(),
    }).execute()


def _default_starred_lookup(user_id: str, ticker: str) -> bool:
    """Starred = alert_starred on that follow. A user with no starred rows
    gets every followed ticker treated as starred. If the column doesn't
    exist yet (migration not applied), everything counts as starred."""
    now = time.time()
    entry = _starred_cache.get(user_id)
    if not entry or now - entry[0] > STARRED_CACHE_SECONDS:
        from services.supabase.supabase_service import get_supabase_service
        rows = (get_supabase_service().client.table("user_stock_follows")
                .select("ticker, alert_starred").eq("user_id", user_id).execute().data or [])
        starred = {r["ticker"].upper() for r in rows if r.get("alert_starred")}
        entry = (now, starred, bool(starred))
        _starred_cache[user_id] = entry
    _, starred, has_any = entry
    return (ticker or "").upper() in starred if has_any else True


def _default_position_lookup(ticker: str) -> bool:
    """True if an app-managed engine currently holds a position on `ticker`."""
    from routes.strategy_routes import _all_engines
    t = (ticker or "").upper()
    return any(getattr(eng, "ticker", "").upper() == t and getattr(eng, "trade_taken", False)
               for _, eng in _all_engines())


_router = None
_router_lock = threading.Lock()


def get_alert_router() -> AlertRouter:
    global _router
    with _router_lock:
        if _router is None:
            _router = AlertRouter()
        return _router
