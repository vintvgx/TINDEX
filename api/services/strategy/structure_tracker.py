"""
Structure Tracker — live swing-sequence trend state, break-of-structure
(BOS), zone flips, and zone-interaction events on top of ZoneEngine's zones.

Decoupled from the ORB opening-range-breakout strategy the same way
KeyLevelWatcher is (see its docstring) — this isn't a trading engine, it
never submits orders. It reuses the same live 1-minute bar bus
(`OrbDataHub`), the same "only a bar CLOSE confirms anything" rule, and the
same constraint: `OrbDataHub` only publishes bars for tickers with
`user_stock_follows.orb_enabled = True`.

Aggregation: 1-minute bars from the hub are folded into `timeframe`-wide
buckets (15m/30m), anchored to the 09:30 ET session open — matching how
Yahoo's own 30m bars are anchored, not wall-clock hour boundaries. A bucket
is only "closed" (and only then eligible for swing/BOS/zone-break checks)
once a later bar shows the next bucket has started; the in-progress bucket
is exposed separately for zone-approach checks, which care about the live
price, not a confirmed close.

`start()` backfills today's 1-minute bars from
`yfinance_service.get_intraday_chart_for_date` before subscribing to the
live hub feed — the hub's own ring buffer
(`OrbDataHub.max_recent_bars=240`, ~4 hours) is far short of a full session,
so a tracker that starts or restarts mid-session would otherwise have no
morning structure to judge BOS against. A late backfill failure degrades to
"structure starts from whenever the hub feed picks up" rather than blocking
start() — same non-fatal-degrade discipline as the rest of this codebase.

Zone snapshots (from `zone_engine.zones()`) are pulled once per closed
aggregation bar, not per tick — that call does a live yfinance fetch, so
tying it to the 1-minute bar stream would hammer it needlessly. Each
snapshot's zones get a PER-SNAPSHOT id (`"support_0"`, `"resistance_1"`,
...) used only to key this session's flip/event bookkeeping — zones aren't
DB rows with a stable cross-day identity, so "never delete, keep flipped
zones with reduced score" (the TODO's own words) means keep the record for
today's session and in `zone_events`, not guarantee a zone reconstructed
tomorrow is "the same" one.
"""

import logging
import threading
from datetime import date as _date, datetime, timedelta

import pytz

from services.utils.orb_data_hub import OrbBar, get_orb_data_hub

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

# Bar-close confirmation, same rule ORBEngine/KeyLevelWatcher use.
_SWING_WINDOW = 3

# "Zone approach" — price within this % of a zone boundary, checked against
# the LIVE (not-yet-closed) price, unlike BOS/zone-break which only ever act
# on a confirmed bar close.
_APPROACH_PCT = 0.0015

# "Zone break" needs a close through the boundary AND volume this far above
# the trailing 20-bar average — a close alone is cheap; volume behind it is
# what the TODO calls a real break vs. noise.
_BREAK_VOLUME_MULT = 1.2
_VOLUME_LOOKBACK_BARS = 20

# A break that reverses back inside the zone within this many CLOSED bars is
# a failed break (bull/bear trap) — the flip it caused gets undone.
_FAILED_BREAK_WINDOW_BARS = 3

# A flipped zone's score is reduced, not zeroed — it's demoted, not deleted.
_FLIP_SCORE_MULT = 0.6

_DEFAULT_TIMEFRAME = "30m"


# ── Pure aggregation/structure functions (no I/O — unit-testable directly) ──

def aggregate_bars(bars_1m: list, minutes: int, session_date) -> list:
    """
    Folds 1-minute `OrbBar`-shaped bars (anything with `.ts`, `.open`,
    `.high`, `.low`, `.close`, `.volume`) into `minutes`-wide buckets
    anchored to 09:30 ET on `session_date`. Returns CLOSED buckets only —
    a bar in the still-forming final bucket never appears here, since its
    high/low/close aren't final. Bars from other dates, or before 09:30, are
    dropped (pre/post-market is not where 15m/30m structure applies).
    """
    session_open = ET.localize(datetime(session_date.year, session_date.month, session_date.day, 9, 30))
    session_close = ET.localize(datetime(session_date.year, session_date.month, session_date.day, 16, 0))

    buckets: dict = {}
    order: list = []
    for bar in bars_1m:
        if bar.close is None:
            continue
        ts = bar.ts if bar.ts.tzinfo else ET.localize(bar.ts)
        ts = ts.astimezone(ET)
        if ts < session_open or ts >= session_close:
            continue
        elapsed_min = (ts - session_open).total_seconds() / 60.0
        bucket_idx = int(elapsed_min // minutes)
        bucket_start = session_open + timedelta(minutes=bucket_idx * minutes)
        if bucket_start not in buckets:
            buckets[bucket_start] = {
                "ts": bucket_start,
                "open": bar.open if bar.open is not None else bar.close,
                "high": bar.high if bar.high is not None else bar.close,
                "low": bar.low if bar.low is not None else bar.close,
                "close": bar.close,
                "volume": bar.volume or 0,
            }
            order.append(bucket_start)
        else:
            b = buckets[bucket_start]
            if bar.high is not None:
                b["high"] = max(b["high"], bar.high)
            if bar.low is not None:
                b["low"] = min(b["low"], bar.low)
            b["close"] = bar.close
            b["volume"] += bar.volume or 0

    if len(order) <= 1:
        return []
    return [buckets[k] for k in order[:-1]]


def confirmed_swings(bars: list, window: int = _SWING_WINDOW) -> tuple:
    """(swing_high_idx, swing_low_idx) over closed `bars` — same fractal
    rule as zone_engine._find_swing_points, duplicated here (not imported)
    so this module has no import-time dependency on zone_engine; both are
    small, stable, and kept in sync deliberately rather than coupled."""
    n = len(bars)
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    swing_high_idx, swing_low_idx = [], []
    for i in range(window, n - window):
        seg_high = highs[i - window: i + window + 1]
        seg_low = lows[i - window: i + window + 1]
        if highs[i] == max(seg_high):
            swing_high_idx.append(i)
        if lows[i] == min(seg_low):
            swing_low_idx.append(i)
    return swing_high_idx, swing_low_idx


def trend_state(bars: list, swing_high_idx: list, swing_low_idx: list) -> str:
    """'uptrend' (HH+HL) / 'downtrend' (LH+LL) / 'range' — from the last two
    CONFIRMED swing highs and the last two confirmed swing lows. 'range'
    (not an error state) until there are at least two of each — too little
    structure yet to call a direction."""
    if len(swing_high_idx) < 2 or len(swing_low_idx) < 2:
        return "range"
    h1, h2 = bars[swing_high_idx[-2]]["high"], bars[swing_high_idx[-1]]["high"]
    l1, l2 = bars[swing_low_idx[-2]]["low"], bars[swing_low_idx[-1]]["low"]
    if h2 > h1 and l2 > l1:
        return "uptrend"
    if h2 < h1 and l2 < l1:
        return "downtrend"
    return "range"


def detect_bos(bars: list, swing_high_idx: list, swing_low_idx: list) -> dict:
    """
    None, or one event, from the LATEST closed bar only — a close beyond
    the last swing high/low CONFIRMED strictly before that bar (a swing at
    the same index as the breaking bar can't have confirmed yet; its own
    `window` lookahead bars haven't closed).
    """
    if not bars:
        return None
    last_i = len(bars) - 1
    last = bars[last_i]
    prior_highs = [i for i in swing_high_idx if i < last_i]
    prior_lows = [i for i in swing_low_idx if i < last_i]
    if prior_highs and last["close"] > bars[prior_highs[-1]]["high"]:
        return {"type": "bos", "direction": "bullish", "level": bars[prior_highs[-1]]["high"],
                "close": last["close"], "bar_ts": last["ts"]}
    if prior_lows and last["close"] < bars[prior_lows[-1]]["low"]:
        return {"type": "bos", "direction": "bearish", "level": bars[prior_lows[-1]]["low"],
                "close": last["close"], "bar_ts": last["ts"]}
    return None


def detect_zone_break(zone: dict, bar: dict, avg_volume: float) -> dict:
    """
    None, or a `zone_break` event, from ONE closed bar against ONE zone —
    a close through the zone's far boundary (up through a resistance zone,
    down through a support zone) with volume at least `_BREAK_VOLUME_MULT`
    times `avg_volume` (the trailing `_VOLUME_LOOKBACK_BARS`-bar average,
    supplied by the caller). Approach checks are separate (`detect_approach`)
    since those read the live, not-yet-closed price.
    """
    close, volume = bar["close"], bar["volume"]
    broke_up = close > zone["high"] and zone["type"] == "resistance"
    broke_down = close < zone["low"] and zone["type"] == "support"
    if not (broke_up or broke_down):
        return None
    if not avg_volume or volume <= _BREAK_VOLUME_MULT * avg_volume:
        return None
    return {"type": "zone_break", "direction": "bullish" if broke_up else "bearish",
            "close": close, "volume": volume, "bar_ts": bar["ts"]}


def detect_approach(zone: dict, price: float) -> bool:
    """True if the live `price` sits within `_APPROACH_PCT` of either
    boundary of `zone` (and isn't already through it)."""
    low, high = zone["low"], zone["high"]
    if low <= price <= high:
        return False
    if high and abs(price - high) / high <= _APPROACH_PCT:
        return True
    if low and abs(price - low) / low <= _APPROACH_PCT:
        return True
    return False


def detect_failed_break(zone: dict, bars_since_break: list) -> bool:
    """True if price closed back inside `zone` within
    `_FAILED_BREAK_WINDOW_BARS` closed bars of a break — the bull/bear trap
    case. `bars_since_break` is the closed bars AFTER (not including) the
    breaking bar, oldest first, already capped by the caller to the window."""
    for b in bars_since_break[:_FAILED_BREAK_WINDOW_BARS]:
        if zone["low"] <= b["close"] <= zone["high"]:
            return True
    return False


# ── Live, stateful tracker ───────────────────────────────────────────────────

class _TickerState:
    def __init__(self, ticker: str, timeframe: str):
        self.ticker = ticker
        self.timeframe = timeframe
        self.session_date: _date = None
        self.raw_1m: list = []           # today's 1-minute bars (backfill + live), oldest first
        self.closed_bars: list = []       # aggregated CLOSED buckets at `timeframe`
        self.trend: str = "range"
        self.zone_snapshot: dict = None   # last zone_engine.zones() result, with per-snapshot ids
        self.zone_snapshot_at: datetime = None
        self.flips: dict = {}             # zone_id -> flip record (see StructureTracker._apply_flip)
        self.pending_breaks: dict = {}    # zone_id -> {"broken_at_idx": int, "direction": str}
        self.approached: set = set()      # zone_ids already fired a zone_approach since last moving away
        self._swing_high_idx: list = []
        self._swing_low_idx: list = []


class StructureTracker:
    """Process-wide singleton. Modeled on KeyLevelWatcher: in-memory state,
    rebuilt per ticker on start(), non-fatal on every I/O path."""

    def __init__(self):
        self._lock = threading.RLock()
        self._states: dict[str, _TickerState] = {}
        self._subscribed: set = set()

    # ── Lifecycle ────────────────────────────────────────────────────────────

    def start(self, tickers: list = None) -> None:
        """
        Backfill + subscribe for every ORB-followed ticker (or an explicit
        `tickers` list, e.g. for a targeted restart). Call once at process
        startup, after OrbService itself has started (subscribing before
        the hub exists is harmless — subscribe_bar just registers a
        callback — but backfill wants `user_stock_follows` to be populated).
        """
        try:
            resolved = tickers
            if resolved is None:
                from services.supabase.supabase_service import get_supabase_service
                sb = get_supabase_service().client
                rows = sb.table("user_stock_follows").select("ticker").eq("orb_enabled", True).execute().data or []
                resolved = [r["ticker"] for r in rows]
            for ticker in resolved:
                self.track(ticker)
            logger.info("[StructureTracker] started — tracking %d ticker(s)", len(resolved))
        except Exception as e:
            logger.error("[StructureTracker] start failed: %s", e, exc_info=True)

    def track(self, ticker: str, timeframe: str = _DEFAULT_TIMEFRAME) -> None:
        """Idempotent — safe to call again for a ticker already tracked."""
        ticker = ticker.upper().strip()
        with self._lock:
            if ticker in self._states:
                return
            self._states[ticker] = _TickerState(ticker, timeframe)
        self._backfill_today(ticker)
        with self._lock:
            if ticker not in self._subscribed:
                get_orb_data_hub().subscribe_bar(ticker, self._make_handler(ticker))
                self._subscribed.add(ticker)
        logger.info("[StructureTracker] tracking %s @ %s", ticker, timeframe)

    def _backfill_today(self, ticker: str) -> None:
        try:
            from services.yfinance.yfinance_service import get_intraday_chart_for_date
            today = datetime.now(ET).date()
            chart = get_intraday_chart_for_date(ticker, today.isoformat(), interval="1m")
            if not chart.get("available"):
                return
            bars = [
                OrbBar(
                    ticker=ticker,
                    ts=datetime.fromisoformat(chart["dates"][i]),
                    open=chart["opens"][i], high=chart["highs"][i],
                    low=chart["lows"][i], close=chart["closes"][i],
                    volume=int(chart["volumes"][i] or 0),
                )
                for i in range(len(chart["dates"]))
            ]
            with self._lock:
                st = self._states.get(ticker)
                if st is not None:
                    st.session_date = today
                    st.raw_1m = bars
                    self._recompute(st)
        except Exception as e:
            logger.warning("[StructureTracker] backfill failed for %s: %s", ticker, e)

    # ── Bar handling ─────────────────────────────────────────────────────────

    def _make_handler(self, ticker: str):
        def handler(bar: OrbBar):
            self._on_bar(ticker, bar)
        return handler

    def _on_bar(self, ticker: str, bar: OrbBar) -> None:
        if bar.close is None:
            return
        with self._lock:
            st = self._states.get(ticker)
            if st is None:
                return
            bar_date = (bar.ts if bar.ts.tzinfo else ET.localize(bar.ts)).astimezone(ET).date()
            if st.session_date != bar_date:
                # New session — reset today's structure. Flips/events from a
                # prior day already made it to zone_events; nothing here is lost.
                st.session_date = bar_date
                st.raw_1m = []
                st.closed_bars = []
                st.trend = "range"
                st.flips = {}
                st.pending_breaks = {}
                st.approached = set()
            st.raw_1m.append(bar)
            prev_closed_count = len(st.closed_bars)
            self._recompute(st)
            new_bars = st.closed_bars[prev_closed_count:]

        for closed_bar in new_bars:
            self._on_closed_bar(st, closed_bar)
        self._check_approach(st, float(bar.close))

    def _recompute(self, st: _TickerState) -> None:
        """Rebuilds aggregated bars + trend state from `st.raw_1m`. Called
        under `self._lock`."""
        if not st.session_date:
            return
        st.closed_bars = aggregate_bars(st.raw_1m, _tf_minutes(st.timeframe), st.session_date)
        hi_idx, lo_idx = confirmed_swings(st.closed_bars)
        st.trend = trend_state(st.closed_bars, hi_idx, lo_idx)
        st._swing_high_idx, st._swing_low_idx = hi_idx, lo_idx

    def _on_closed_bar(self, st: _TickerState, bar: dict) -> None:
        # BOS.
        bos = detect_bos(st.closed_bars, st._swing_high_idx, st._swing_low_idx)
        if bos:
            self._emit(st.ticker, bos, session_date=st.session_date)

        # Refresh the zone snapshot at most once per closed bar (not per tick).
        self._refresh_zones(st)
        if not st.zone_snapshot:
            return

        avg_volume = _trailing_avg_volume(st.closed_bars)
        for zone_id, zone in _all_zones(st.zone_snapshot):
            pending = st.pending_breaks.get(zone_id)
            if pending is not None:
                since = [b for b in st.closed_bars if b["ts"] > pending["broken_at_ts"]]
                if detect_failed_break(_flip_view(zone, st.flips.get(zone_id)), since):
                    self._undo_flip(st, zone_id)
                    self._emit(st.ticker, {"type": "failed_break", "zone_id": zone_id,
                                          "direction": pending["direction"], "bar_ts": bar["ts"]},
                              session_date=st.session_date)
                    del st.pending_breaks[zone_id]
                elif len(since) >= _FAILED_BREAK_WINDOW_BARS:
                    del st.pending_breaks[zone_id]  # break stood — stop watching for a trap
                continue

            effective = _flip_view(zone, st.flips.get(zone_id))
            brk = detect_zone_break(effective, bar, avg_volume)
            if brk:
                brk["zone_id"] = zone_id
                self._apply_flip(st, zone_id, zone, brk["direction"])
                st.pending_breaks[zone_id] = {"broken_at_ts": bar["ts"], "direction": brk["direction"]}
                self._emit(st.ticker, brk, session_date=st.session_date)

    def _check_approach(self, st: _TickerState, price: float) -> None:
        if not st.zone_snapshot:
            return
        for zone_id, zone in _all_zones(st.zone_snapshot):
            effective = _flip_view(zone, st.flips.get(zone_id))
            near = detect_approach(effective, price)
            if near and zone_id not in st.approached:
                st.approached.add(zone_id)
                self._emit(st.ticker, {"type": "zone_approach", "zone_id": zone_id, "close": price},
                          session_date=st.session_date)
            elif not near:
                st.approached.discard(zone_id)

    def _refresh_zones(self, st: _TickerState) -> None:
        now = datetime.now(ET)
        if st.zone_snapshot_at and (now - st.zone_snapshot_at).total_seconds() < 60:
            return
        try:
            from services.strategy.zone_engine import zones as _zones
            snap = _zones(st.ticker, timeframe=st.timeframe)
            if not snap.get("error"):
                st.zone_snapshot = snap
                st.zone_snapshot_at = now
        except Exception as e:
            logger.warning("[StructureTracker] zone refresh failed for %s: %s", st.ticker, e)

    # ── Flip bookkeeping ─────────────────────────────────────────────────────

    def _apply_flip(self, st: _TickerState, zone_id: str, zone: dict, direction: str) -> None:
        flipped_type = "resistance" if zone["type"] == "support" else "support"
        st.flips[zone_id] = {
            "original_type": zone["type"], "flipped_type": flipped_type,
            "flipped_score": round(zone["score"] * _FLIP_SCORE_MULT, 1),
            "flipped_at": datetime.now(ET).isoformat(), "direction": direction,
        }

    def _undo_flip(self, st: _TickerState, zone_id: str) -> None:
        st.flips.pop(zone_id, None)

    # ── Persistence + notification ──────────────────────────────────────────

    def _emit(self, ticker: str, event: dict, session_date) -> None:
        bar_ts = event.get("bar_ts")
        logger.info("[StructureTracker] %s %s: %s", ticker, event["type"], event)
        try:
            from services.supabase.supabase_service import get_supabase_service
            sb = get_supabase_service().client
            sb.table("zone_events").insert({
                "ticker": ticker,
                "session_date": str(session_date),
                "event_type": event["type"],
                "direction": event.get("direction"),
                "zone_id": event.get("zone_id"),
                "level": event.get("level"),
                "close": event.get("close"),
                "volume": event.get("volume"),
                "bar_ts": bar_ts.isoformat() if hasattr(bar_ts, "isoformat") else bar_ts,
            }).execute()
        except Exception as e:
            # Table may not be migrated yet, or the DB may be briefly
            # unreachable — never let persistence failure break live
            # structure tracking. The in-memory state (trend/flips) is
            # still correct even if the row never lands.
            logger.warning("[StructureTracker] zone_events insert failed for %s %s: %s",
                           ticker, event.get("type"), e)

    # ── Read API (chart layer / gate) ────────────────────────────────────────

    def get_trend(self, ticker: str) -> str:
        with self._lock:
            st = self._states.get(ticker.upper().strip())
            return st.trend if st else "range"

    def get_flipped_zones(self, ticker: str) -> list:
        """Current session's flipped zones, for the chart's flip labels and
        the entry gate's zone factor — {zone_id, low, high, original_type,
        current_type, score, sources, flipped_at}."""
        with self._lock:
            st = self._states.get(ticker.upper().strip())
            if not st or not st.zone_snapshot:
                return []
            out = []
            for zone_id, zone in _all_zones(st.zone_snapshot):
                flip = st.flips.get(zone_id)
                if flip:
                    out.append({
                        "zone_id": zone_id, "low": zone["low"], "high": zone["high"],
                        "original_type": flip["original_type"], "current_type": flip["flipped_type"],
                        "score": flip["flipped_score"], "sources": zone["sources"],
                        "flipped_at": flip["flipped_at"],
                    })
            return out


# ── Module-level helpers ─────────────────────────────────────────────────────

_TF_MINUTES = {"5m": 5, "15m": 15, "30m": 30}


def _tf_minutes(timeframe: str) -> int:
    return _TF_MINUTES.get(timeframe, 30)


def _trailing_avg_volume(bars: list) -> float:
    window = bars[-_VOLUME_LOOKBACK_BARS:]
    if not window:
        return 0.0
    return sum(b["volume"] for b in window) / len(window)


def _all_zones(snapshot: dict):
    """Yields (zone_id, zone) for every zone in a zone_engine.zones()
    snapshot, tagging each with a stable PER-SNAPSHOT id."""
    for i, z in enumerate(snapshot.get("support", [])):
        yield f"support_{i}", z
    for i, z in enumerate(snapshot.get("resistance", [])):
        yield f"resistance_{i}", z


def _flip_view(zone: dict, flip: dict) -> dict:
    """The zone dict a break/approach check should actually compare against
    — the ORIGINAL boundaries always (a flip changes which side is favored,
    not where the band sits), but the CURRENT type once flipped, so a
    zone_break can fire in the opposite direction on a flipped zone too."""
    if not flip:
        return zone
    return {**zone, "type": flip["flipped_type"]}


_tracker: "StructureTracker | None" = None
_tracker_lock = threading.Lock()


def get_structure_tracker() -> StructureTracker:
    global _tracker
    with _tracker_lock:
        if _tracker is None:
            _tracker = StructureTracker()
        return _tracker
