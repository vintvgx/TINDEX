"""
Structure Tracker — live swing-sequence trend state, break-of-structure
(BOS), zone flips, and zone-interaction events on top of ZoneEngine's zones.

Decoupled from the ORB opening-range-breakout strategy the same way
KeyLevelWatcher is (see its docstring) — this isn't a trading engine, it
never submits orders. It reuses the same live 1-minute bar bus
(`OrbDataHub`), the same "only a bar CLOSE confirms anything" rule, and the
same constraint: `OrbDataHub` only publishes bars for tickers with
`user_stock_follows.orb_enabled = True`.

Two timeframes:
  - Trend + BOS run on 1-minute bars folded into `timeframe`-wide buckets
    (15m/30m), anchored to the 09:30 ET session open — matching how Yahoo's
    own 30m bars are anchored. A bucket is only "closed" once a later bar
    shows the next bucket has started.
  - Zone breaks, failed breaks and approaches run on every closed 1-MINUTE
    bar: a break is the first 1m close through the zone's far edge on
    >= 1.2x the trailing 20-bar 1m volume (30m confirmation lagged real
    breaks by up to half an hour). Pushes for new entries only go out inside
    ENTRY_SIGNAL_WINDOW (09:30-10:00 ET by default); tracking runs all day.

`start()` backfills today's 1-minute bars from
`yfinance_service.get_intraday_chart_for_date` before subscribing to the
live hub feed — the hub's own ring buffer
(`OrbDataHub.max_recent_bars=240`, ~4 hours) is far short of a full session,
so a tracker that starts or restarts mid-session would otherwise have no
morning structure to judge BOS against. A late backfill failure degrades to
"structure starts from whenever the hub feed picks up" rather than blocking
start() — same non-fatal-degrade discipline as the rest of this codebase.

Zone snapshots (from `zone_engine.zones()`) refresh at most once a minute,
on a background thread (zone_engine itself caches 90s). Each snapshot's
zones get a PER-SNAPSHOT id (`"support_0"`, `"resistance_1"`, ...) used to
key this session's flip/event bookkeeping, re-keyed on every refresh by
nearest center (remap_zone_ids) so state follows the zone — zones aren't
DB rows with a stable cross-day identity, so "never delete, keep flipped
zones with reduced score" (the TODO's own words) means keep the record for
today's session and in `zone_events`, not guarantee a zone reconstructed
tomorrow is "the same" one.
"""

import logging
import os
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

# "Zone break" = the first CLOSED 1-MINUTE bar through the zone's far edge
# with volume at least this multiple of the trailing 1m average. Breaks used
# to confirm on 30m bucket closes, which lagged real breaks by up to half an
# hour; trend/BOS still run on the 30m buckets (see _recompute).
_BREAK_VOLUME_MULT = 1.2
_VOLUME_LOOKBACK_BARS = 20
# Fewer prior session 1m bars than this and there's no break signal at all
# (not "skip the volume check") — 10 minutes of baseline is the minimum to
# judge "above average" against, and it keeps the opening-bar volume spike
# from being the whole baseline.
_VOLUME_MIN_PRIOR_BARS = 10

# Push anti-spam: at most this many zone pushes per ticker per session.
# An approach pushes once per zone and re-arms only after that zone's failed
# break; a break re-arms only after a failed break undoes the flip.
_MAX_PUSHES_PER_TICKER_PER_DAY = 3

# A break that closes back inside the zone (1m close) within this many
# minutes is a failed break (bull/bear trap) — the flip it caused gets undone.
# Was 3 x 30m bars; same ~90 minutes of probation, now on 1m closes.
FAILED_BREAK_WINDOW_MINUTES = 90


def _parse_entry_window(raw: str) -> tuple:
    """'09:30-10:00' → (time(9,30), time(10,0)); falls back to the default
    on anything malformed."""
    from datetime import time as _time
    try:
        start_s, end_s = raw.split("-")
        sh, sm = (int(x) for x in start_s.strip().split(":"))
        eh, em = (int(x) for x in end_s.strip().split(":"))
        start, end = _time(sh, sm), _time(eh, em)
        if start < end:
            return start, end
    except Exception:
        pass
    logger.warning("[StructureTracker] bad TINDEX_ENTRY_SIGNAL_WINDOW %r — using 09:30-10:00", raw)
    return _time(9, 30), _time(10, 0)


# New-entry signal window (America/New_York): approach and break pushes only
# fire for bars inside it — no new entries after 10:00 ET by default. Gates
# PUSHES only: flips, failed-break detection, zone refresh and trend/BOS keep
# running all session, and failed-break pushes for an already-pushed break
# always go out (they're exits). Override with
# TINDEX_ENTRY_SIGNAL_WINDOW="09:30-10:00".
ENTRY_SIGNAL_WINDOW = _parse_entry_window(os.getenv("TINDEX_ENTRY_SIGNAL_WINDOW", "09:30-10:00"))

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
    None, or a `zone_break` event, from ONE closed 1m bar against ONE zone —
    a close through the zone's far boundary (up through a resistance zone,
    down through a support zone) with volume at least `_BREAK_VOLUME_MULT`
    times `avg_volume` (the trailing 1m average of the bars BEFORE this one
    — see trailing_avg_volume). Callers skip the check entirely when there
    isn't enough baseline (avg_volume None); passing None here skips only the
    volume requirement.
    """
    close, volume = bar["close"], bar["volume"]
    broke_up = close > zone["high"] and zone["type"] == "resistance"
    broke_down = close < zone["low"] and zone["type"] == "support"
    if not (broke_up or broke_down):
        return None
    if avg_volume is not None and (avg_volume <= 0 or volume <= _BREAK_VOLUME_MULT * avg_volume):
        return None
    return {"type": "zone_break", "direction": "bullish" if broke_up else "bearish",
            "close": close, "volume": volume, "bar_ts": bar["ts"],
            "volume_mult": round(volume / avg_volume, 2) if avg_volume else None}


def trailing_avg_volume(bars: list, end_idx: int) -> "float | None":
    """Average volume of the up-to-`_VOLUME_LOOKBACK_BARS` closed bars
    strictly BEFORE `bars[end_idx]` — the bar under evaluation never counts
    toward its own baseline (a 3x breaking bar would otherwise inflate the
    average it's compared against). None when fewer than
    `_VOLUME_MIN_PRIOR_BARS` prior bars exist."""
    window = bars[max(0, end_idx - _VOLUME_LOOKBACK_BARS):end_idx]
    if len(window) < _VOLUME_MIN_PRIOR_BARS:
        return None
    return sum(b["volume"] or 0 for b in window) / len(window)


def detect_failed_break_1m(zone: dict, direction: str, close: float) -> bool:
    """True if a 1m `close` is back inside `zone` (or all the way back
    through it) after a `direction` break — i.e. the break didn't hold.
    `zone` carries the ORIGINAL bounds."""
    if direction == "bullish":
        return close <= zone["high"]
    return close >= zone["low"]


def in_entry_window(ts, window: tuple = None) -> bool:
    """True if bar timestamp `ts` falls inside the new-entry signal window
    (ET, start inclusive, end exclusive)."""
    start, end = window or ENTRY_SIGNAL_WINDOW
    t = (ts if getattr(ts, "tzinfo", None) else ET.localize(ts)).astimezone(ET).time()
    return start <= t < end


def session_bars_1m(raw_1m: list, session_date) -> list:
    """Today's regular-session (09:30-16:00 ET) 1m bars as plain dicts,
    oldest first — the series breaks, failed breaks and the volume baseline
    are judged on."""
    out = []
    for b in raw_1m:
        if b.close is None:
            continue
        ts = (b.ts if b.ts.tzinfo else ET.localize(b.ts)).astimezone(ET)
        if ts.date() != session_date:
            continue
        minutes = ts.hour * 60 + ts.minute
        if minutes < 9 * 60 + 30 or minutes >= 16 * 60:
            continue
        out.append({"ts": ts, "close": float(b.close), "high": b.high, "low": b.low, "volume": b.volume or 0})
    return out


def remap_zone_ids(old_snapshot: "dict | None", new_snapshot: dict) -> dict:
    """
    {old_zone_id: new_zone_id} between two zone_engine snapshots, matched by
    nearest center within max(half-width, clustering tolerance). Zone ids
    are per-snapshot positions ("support_0"), so a refresh that reorders or
    shifts zones would otherwise attach a flip, pending break or pushed
    signal to the wrong zone. Unmatched old ids are simply absent (that
    zone moved or dropped out). Pure.
    """
    if not old_snapshot:
        return {}
    tol = new_snapshot.get("tolerance") or old_snapshot.get("tolerance") or 0.0
    new_zones = list(_all_zones(new_snapshot))
    mapping, taken = {}, set()
    for old_id, oz in _all_zones(old_snapshot):
        o_center = (oz["low"] + oz["high"]) / 2
        best = None
        for new_id, nz in new_zones:
            if new_id in taken or nz["type"] != oz["type"]:
                continue
            d = abs((nz["low"] + nz["high"]) / 2 - o_center)
            if best is None or d < best[0]:
                best = (d, new_id, nz)
        if best and best[0] <= max((best[2]["high"] - best[2]["low"]) / 2, tol):
            mapping[old_id] = best[1]
            taken.add(best[1])
    return mapping


def _fmt_band(zone: dict) -> str:
    return f"${zone['low']:.2f}–${zone['high']:.2f}"


def format_zone_push(ticker: str, event: dict, zone: dict, timeframe: str) -> "tuple | None":
    """
    (title, body) for a zone push, or None for event types that aren't
    pushed (bos stays in zone_events/log only). `zone` is the zone as the
    check saw it (current, possibly flipped, type). Every entry push carries
    its invalidation, phrased on 1m closes — what breaks confirm on.
    `timeframe` is unused now that breaks are 1m-only; kept so callers
    don't change.
    """
    kind = zone["type"]
    timeframe = "1m"
    if event["type"] == "zone_approach":
        if kind == "support":
            invalidation = f"{timeframe} close below ${zone['low'] - 0.01:.2f}"
        else:
            invalidation = f"{timeframe} close above ${zone['high'] + 0.01:.2f}"
        return (
            f"🎯 {ticker} approaching {kind}",
            f"{ticker} within {_APPROACH_PCT * 100:.2f}% of {_fmt_band(zone)} {kind} "
            f"(score {zone['score']:.0f}, {zone['touches']} touches). Invalidation: {invalidation}.",
        )
    if event["type"] == "zone_break":
        new_kind = "resistance" if kind == "support" else "support"
        side = "below" if kind == "support" else "above"
        vol = f" on {event['volume_mult']:.1f}x average volume" if event.get("volume_mult") else ""
        return (
            f"⚡ {ticker} broke {kind}",
            f"{ticker} closed {side} {_fmt_band(zone)} at ${event['close']:.2f}{vol}. "
            f"Zone flips to {new_kind}. Invalidation: {timeframe} close back inside.",
        )
    if event["type"] == "failed_break":
        # `zone` here is the original (un-flipped) zone the break went through.
        side = "above" if kind == "resistance" else "below"
        return (
            f"↩️ {ticker} break failed",
            f"{ticker} closed back inside {_fmt_band(zone)} {kind} at ${event['close']:.2f} "
            f"within {FAILED_BREAK_WINDOW_MINUTES} min of breaking {side} it. "
            f"Signal invalidated — zone is {kind} again.",
        )
    return None


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


def should_push(event: dict, pushes_sent: int, approach_pushed: set, break_pushed: set,
                ticker: str = "") -> bool:
    """
    Push gating, pure:
      - failed_break: only for a break whose push actually went out, and
        ALWAYS (any time of day, even past the daily cap) — it's an exit.
      - zone_approach / zone_break: entries — only inside the entry signal
        window, under the daily cap, and an approach only once per zone
        (re-armed by that zone's failed break).
    """
    etype, zone_id = event["type"], event.get("zone_id")
    if etype == "failed_break":
        return zone_id in break_pushed
    if etype not in ("zone_approach", "zone_break"):
        return False
    if event.get("bar_ts") is None or not in_entry_window(event["bar_ts"]):
        return False
    if pushes_sent >= _MAX_PUSHES_PER_TICKER_PER_DAY:
        logger.info("[StructureTracker] %s %s push skipped — daily cap (%d) reached",
                    ticker, etype, _MAX_PUSHES_PER_TICKER_PER_DAY)
        return False
    if etype == "zone_approach" and zone_id in approach_pushed:
        return False
    return True


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
        self.pushes_sent: int = 0         # zone pushes this session — capped at _MAX_PUSHES_PER_TICKER_PER_DAY
        self.approach_pushed: set = set() # zone_ids whose approach push already went out (re-armed by a failed break)
        self.break_pushed: set = set()    # zone_ids whose break push went out — their failed break pushes too
        self.refreshing: bool = False     # a background zone refresh is in flight
        self._swing_high_idx: list = []
        self._swing_low_idx: list = []


class StructureTracker:
    """Process-wide singleton. Modeled on KeyLevelWatcher: in-memory state,
    rebuilt per ticker on start(), non-fatal on every I/O path."""

    def __init__(self):
        self._lock = threading.RLock()
        self._states: dict[str, _TickerState] = {}
        self._subscribed: set = set()
        self._notifier = None

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
            # Deliberately ORB-gated (OrbDataHub only publishes bars for
            # orb_enabled follows) — logged so it's visible which tickers get
            # live BOS/approach/break events; /strategy/zones reports
            # `tracked: false` for everything else.
            logger.info("[StructureTracker] started — tracking %d ORB-followed ticker(s): %s",
                        len(resolved), ", ".join(sorted({t.upper() for t in resolved})) or "none")
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
                st.pushes_sent = 0
                st.approach_pushed = set()
                st.break_pushed = set()
            st.raw_1m.append(bar)
            prev_closed_count = len(st.closed_bars)
            self._recompute(st)
            new_bars = st.closed_bars[prev_closed_count:]
            session_1m = session_bars_1m(st.raw_1m, st.session_date)

        # Trend/BOS: 30m buckets, unchanged.
        for closed_bar in new_bars:
            self._on_closed_bar(st, closed_bar)
        # Zone breaks / failed breaks / approaches: every closed 1m bar.
        self._refresh_zones(st)
        if session_1m and session_1m[-1]["ts"] == (bar.ts if bar.ts.tzinfo else ET.localize(bar.ts)).astimezone(ET):
            self._on_1m_bar(st, session_1m)
            self._check_approach(st, float(bar.close), session_1m[-1]["ts"])

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
        """30m bucket close — trend/BOS only."""
        bos = detect_bos(st.closed_bars, st._swing_high_idx, st._swing_low_idx)
        if bos:
            self._emit(st.ticker, bos, session_date=st.session_date)

    def _on_1m_bar(self, st: _TickerState, session_1m: list) -> None:
        """Latest closed 1m bar (`session_1m[-1]`) against every zone: failed
        breaks for pending ones, fresh breaks for the rest."""
        if not st.zone_snapshot:
            return
        bar = session_1m[-1]
        avg_volume = trailing_avg_volume(session_1m, len(session_1m) - 1)
        for zone_id, zone in _all_zones(st.zone_snapshot):
            pending = st.pending_breaks.get(zone_id)
            if pending is not None:
                age_min = (bar["ts"] - pending["broken_at_ts"]).total_seconds() / 60.0
                if age_min > FAILED_BREAK_WINDOW_MINUTES:
                    del st.pending_breaks[zone_id]  # break stood — stop watching for a trap
                elif detect_failed_break_1m(zone, pending["direction"], bar["close"]):
                    self._undo_flip(st, zone_id)
                    del st.pending_breaks[zone_id]
                    # Re-arm this zone's approach push for a fresh attempt.
                    st.approach_pushed.discard(zone_id)
                    self._emit(st.ticker, {"type": "failed_break", "zone_id": zone_id,
                                          "direction": pending["direction"], "close": bar["close"],
                                          "bar_ts": bar["ts"]},
                              session_date=st.session_date, st=st, zone=zone)
                continue

            if avg_volume is None:
                continue  # under 10 baseline bars — no break signal yet
            effective = _flip_view(zone, st.flips.get(zone_id))
            brk = detect_zone_break(effective, bar, avg_volume)
            if brk:
                brk["zone_id"] = zone_id
                self._apply_flip(st, zone_id, zone, brk["direction"])
                st.pending_breaks[zone_id] = {"broken_at_ts": bar["ts"], "direction": brk["direction"]}
                self._emit(st.ticker, brk, session_date=st.session_date, st=st, zone=effective)

    def _check_approach(self, st: _TickerState, price: float, bar_ts=None) -> None:
        if not st.zone_snapshot:
            return
        for zone_id, zone in _all_zones(st.zone_snapshot):
            effective = _flip_view(zone, st.flips.get(zone_id))
            near = detect_approach(effective, price)
            if near and zone_id not in st.approached:
                st.approached.add(zone_id)
                self._emit(st.ticker, {"type": "zone_approach", "zone_id": zone_id, "close": price,
                                       "bar_ts": bar_ts},
                          session_date=st.session_date, st=st, zone=effective)
            elif not near:
                st.approached.discard(zone_id)

    def _refresh_zones(self, st: _TickerState) -> None:
        """Refresh the zone snapshot at most once a minute, OFF the bar
        thread: it now runs per 1m bar, and a cold zone_engine fetch can take
        up to its 10s timeout, which would stall every ticker's bars on the
        hub's loop. Checks keep using the previous snapshot until the new one
        lands."""
        now = datetime.now(ET)
        if st.refreshing or (st.zone_snapshot_at and (now - st.zone_snapshot_at).total_seconds() < 60):
            return
        st.refreshing = True
        threading.Thread(target=self._refresh_zones_worker, args=(st,), daemon=True,
                         name=f"zone-refresh-{st.ticker}").start()

    def _refresh_zones_worker(self, st: _TickerState) -> None:
        try:
            from services.strategy.zone_engine import zones as _zones
            snap = _zones(st.ticker, timeframe=st.timeframe)
            if not snap.get("error"):
                with self._lock:
                    self._install_snapshot(st, snap)
        except Exception as e:
            logger.warning("[StructureTracker] zone refresh failed for %s: %s", st.ticker, e)
        finally:
            st.refreshing = False

    def _install_snapshot(self, st: _TickerState, snap: dict) -> None:
        """Swap in a new zone snapshot, carrying flips / pending breaks /
        pushed-signal state over to the matching new zone ids (see
        remap_zone_ids). Called under self._lock."""
        mapping = remap_zone_ids(st.zone_snapshot, snap)
        st.flips = {mapping[k]: v for k, v in st.flips.items() if k in mapping}
        st.pending_breaks = {mapping[k]: v for k, v in st.pending_breaks.items() if k in mapping}
        st.approached = {mapping[k] for k in st.approached if k in mapping}
        st.approach_pushed = {mapping[k] for k in st.approach_pushed if k in mapping}
        st.break_pushed = {mapping[k] for k in st.break_pushed if k in mapping}
        st.zone_snapshot = snap
        st.zone_snapshot_at = datetime.now(ET)

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

    def _emit(self, ticker: str, event: dict, session_date, st: "_TickerState" = None,
              zone: dict = None) -> None:
        bar_ts = event.get("bar_ts")
        logger.info("[StructureTracker] %s %s: %s", ticker, event["type"], event)
        if st is not None and zone is not None:
            self._push(st, event, zone)
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

    def _push(self, st: "_TickerState", event: dict, zone: dict) -> None:
        """Zone approach/break → push to the users following this ticker,
        within the per-ticker daily cap. Never raises."""
        try:
            if not self._should_push(st, event):
                return
            msg = format_zone_push(st.ticker, event, zone, st.timeframe)
            if msg is None:
                return
            user_ids = self._followers(st.ticker)
            if not user_ids:
                return
            st.pushes_sent += 1
            zone_id = event.get("zone_id")
            if event["type"] == "zone_break":
                st.break_pushed.add(zone_id)
            elif event["type"] == "zone_approach":
                st.approach_pushed.add(zone_id)
            elif event["type"] == "failed_break":
                st.break_pushed.discard(zone_id)
            self._get_notifier().notify_zone_alert(
                msg[0], msg[1], user_ids,
                {"type": event["type"], "ticker": st.ticker, "zone_low": zone["low"], "zone_high": zone["high"]},
            )
        except Exception as e:
            logger.warning("[StructureTracker] %s %s push failed: %s", st.ticker, event.get("type"), e)

    def _should_push(self, st: "_TickerState", event: dict) -> bool:
        return should_push(event, st.pushes_sent, st.approach_pushed, st.break_pushed, st.ticker)

    def _followers(self, ticker: str) -> list:
        """User ids with this ticker ORB-followed — the same set whose follow
        put it on the live bar feed. Read fresh each push (≤ a few per ticker
        per day), so a new or removed follow is picked up immediately."""
        from services.supabase.supabase_service import get_supabase_service
        rows = (get_supabase_service().client.table("user_stock_follows").select("user_id")
                .eq("ticker", ticker).eq("orb_enabled", True).execute().data or [])
        return sorted({r["user_id"] for r in rows if r.get("user_id")})

    def _get_notifier(self):
        # One shared notifier: each StrategyNotifier starts its own drain thread.
        if self._notifier is None:
            from services.strategy.notifier import StrategyNotifier
            from services.supabase.supabase_service import get_supabase_service
            self._notifier = StrategyNotifier(get_supabase_service().client)
        return self._notifier

    # ── Read API (chart layer / gate) ────────────────────────────────────────

    def is_tracked(self, ticker: str) -> bool:
        with self._lock:
            return ticker.upper().strip() in self._states

    def tracked_tickers(self) -> list:
        with self._lock:
            return sorted(self._states)

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
