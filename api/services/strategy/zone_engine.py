"""
Zone Engine — multi-source, multi-timeframe support/resistance detection.

Automates the read a Discord flow-alert admin does by hand: pre-marked
horizontal levels, confirmed by confluence (several independent methods
landing on the same price) and an opening-range break with volume behind
it. See docs/todos/OUTSTANDING.md #2 for the reverse-engineered AMZN 9/30
example this was built against ($245 support / $247.50 trigger / $252.50
target) — `zones("AMZN", timeframe="30m")` should land close to those three
numbers on that session.

Supersedes `technical_service.py`'s old swing-only S/R (single timeframe —
2y daily only, single source, fixed 1% tolerance, no width, no volume, no
confluence). `get_support_resistance()` below is a drop-in replacement for
that function's exact return shape, so `/strategy/support-resistance/<ticker>`
and `PriceChartFullScreen`'s `showSR` layer keep working unchanged while the
new `zones()` output feeds the chart's auto-zone band layer and the entry
gate (see entry_check_service.py's "zone" factor) with real width, scores
and sources.

Design, mapped straight from the TODO:
  - Candidate SOURCES, each independently detected: swing highs/lows
    (fractal, N=3) on both the daily and the requested intraday timeframe,
    prior-day H/L/C, premarket H/L, ORH/ORL (OrbDataHub's live range when the
    ticker is followed, else the 09:30-09:45 window), round numbers ($1 near
    price, $5 a bit further out), session VWAP, and prior-day VWAP.
  - CLUSTERING: points within `min(0.2% of price, 0.25x ATR-14 daily)` of
    each other's running mean become one zone — a band (`low`/`high`), not a
    single price. The smaller of the two, not the larger: on an elevated-ATR
    session the ATR term alone is wide enough to swallow genuinely distinct
    multi-dollar levels (verified against AMZN 9/30 below); ATR only widens
    tolerance on a tight/low-ATR name where 0.2% of price would be sub-cent.
  - SCORING v2 (0-100; see `score_terms`): diminishing-returns touch
    count (30 * sqrt(touches/10), capped at 10) + recency (20, exponential
    decay, 5-day half-life) + volume traded through the band (15) + a
    diminishing confluence bonus for each DISTINCT extra source category
    beyond the first (+12, +8, then +5 each, up to 5 extra = +35; repeated
    swing touches are one category — "swing" — and both round tiers are one
    "round"). The terms sum to exactly 100 at their caps, so 100 means "10
    touches, tested today, heavy volume, 5 independent methods agreeing" —
    rare by design, unlike v1 where real zones all tied at 100.

Refreshed far more often than the old 8h S/R cache (`_CACHE_TTL_SECONDS`
below) — several of the sources above (ORB, premarket, session VWAP) are
only meaningful "as of a moment ago" during a live session.
"""

import concurrent.futures
import logging
import threading
import time
from datetime import date as _date, datetime, timezone

import pytz

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

_cache: dict = {}
_cache_lock = threading.Lock()
_CACHE_TTL_SECONDS = 90

# Hard cap on the three yfinance fetches zones() makes. yfinance has no
# per-call timeout and a slow Yahoo cookie/crumb exchange can hang for 10s+;
# StructureTracker refreshes zones on its bar-handling thread, so one hung
# fetch would stall live structure updates. On timeout zones() serves the
# last cached result (marked `stale`) instead of raising.
_FETCH_TIMEOUT_SECONDS = 10
# Shared pool so a timed-out fetch (its thread keeps running until yfinance
# gives up) doesn't spawn a new pool per call; sized for a few concurrent
# tickers plus a couple of hung stragglers.
_fetch_pool = concurrent.futures.ThreadPoolExecutor(max_workers=6, thread_name_prefix="zone-fetch")

_SWING_WINDOW = 3  # fractal confirmation bars each side — same as the old technical_service constant

# Clustering tolerance: the larger of a flat % of price or a fraction of
# daily ATR-14 — a fixed %-only tolerance (the old 1%) is too tight on a
# low-ATR day and too wide on a high-ATR one.
_TOL_PCT = 0.002
_TOL_ATR_MULT = 0.25

# Scoring v2 weights (decided 2026-09-30 — see docs zone-engine-fix-specs,
# Fix 1). Every term has diminishing returns and the caps sum to exactly 100,
# so nothing needs normalizing and real zones stop tying at the ceiling.
_TOUCH_MAX = 10
_TOUCH_WEIGHT = 30.0               # 30 * sqrt(min(touches, 10) / 10): 1 ≈ 9.5, 5 ≈ 21.2, 10 = 30
_RECENCY_WEIGHT = 20.0
_RECENCY_HALF_LIFE_DAYS = 3.0     # a touch 3 days old scores half of "just now"; 33 days old ~= 1/1024
_VOLUME_WEIGHT = 15.0
_VOLUME_HEADROOM_MULT = 8.0        # zone volume density at 8x the naive per-touch expectation maxes this term
# Bonus per extra distinct source category beyond the first: +12, +8, then
# +5 each, capped at 5 extra (+35 max). Each extra method agreeing still
# adds conviction, just less than the one before it.
_CONFLUENCE_STEPS = (12.0, 8.0, 5.0, 5.0, 5.0)

# Round numbers only count as a source near price — far enough away and
# "round" stops being a level anyone is actually watching.
_ROUND_1_MAX_DIST_PCT = 0.03
_ROUND_5_MAX_DIST_PCT = 0.08

# Bad-tick guard (2026-10-01) — defense in depth beyond the zero-volume
# filter below. A real 30m gap this size on a liquid name is rare enough
# that flagging it is correct; verified against the SPY case this exists
# for (see module docstring): a 6.6% phantom print is caught with room to
# spare. Named/tunable rather than inlined since "how big a gap is
# suspicious" is exactly the kind of threshold worth being able to tune
# without re-reading the filter's logic.
BAD_TICK_PCT = 0.03

_ALLOWED_TIMEFRAMES = ("5m", "15m", "30m")


# ── Small numeric helpers ────────────────────────────────────────────────────

def _atr(high, low, close, period: int = 14):
    """Daily ATR-14 — same formula as technical_service.get_technicals."""
    import pandas as pd
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    val = tr.rolling(period).mean().iloc[-1]
    return float(val) if pd.notna(val) else None


def _find_swing_points(highs: list, lows: list, window: int = _SWING_WINDOW) -> tuple:
    """
    A bar at index i is a swing high if its high is the max within
    [i-window, i+window] (local peak, `window` bars confirmed both sides),
    swing low if its low is the local min over the same range. Timeframe-
    agnostic — called on daily bars and on whichever intraday bars zones()
    was asked for. Moved verbatim from technical_service.py (2026-09-30).
    """
    n = len(highs)
    swing_high_idx, swing_low_idx = [], []
    for i in range(window, n - window):
        seg_high = highs[i - window: i + window + 1]
        seg_low = lows[i - window: i + window + 1]
        if highs[i] == max(seg_high):
            swing_high_idx.append(i)
        if lows[i] == min(seg_low):
            swing_low_idx.append(i)
    return swing_high_idx, swing_low_idx


def _classic_pivots(prev_high: float, prev_low: float, prev_close: float) -> dict:
    """Standard daily pivot points off the most recent complete session.
    Moved verbatim from technical_service.py (2026-09-30)."""
    pivot = (prev_high + prev_low + prev_close) / 3
    return {
        "pivot": pivot,
        "r1": 2 * pivot - prev_low,
        "s1": 2 * pivot - prev_high,
        "r2": pivot + (prev_high - prev_low),
        "s2": pivot - (prev_high - prev_low),
    }


def _round_number_points(price: float) -> list:
    pts = []
    base1 = round(price)
    for d in range(-3, 4):
        lvl = base1 + d
        if lvl <= 0:
            continue
        if abs(lvl - price) / price <= _ROUND_1_MAX_DIST_PCT:
            pts.append({"price": float(lvl), "source": "round_1", "age_days": 0.0})
    base5 = round(price / 5) * 5
    for d in range(-2, 3):
        lvl = base5 + d * 5
        if lvl <= 0:
            continue
        if abs(lvl - price) / price <= _ROUND_5_MAX_DIST_PCT:
            pts.append({"price": float(lvl), "source": "round_5", "age_days": 0.0})
    return pts


def _vwap_from_bars(bars) -> float:
    """None on empty/zero-volume input (e.g. a future session with no bars yet)."""
    if bars is None or bars.empty:
        return None
    typical = (bars["High"] + bars["Low"] + bars["Close"]) / 3
    vol = bars["Volume"]
    total_vol = float(vol.sum())
    if total_vol <= 0:
        return None
    return float((typical * vol).sum() / total_vol)


def _category(source: str) -> str:
    """Collapses repeated-instance sources (many swing touches, both round
    tiers) into one confluence category — see module docstring. Everything
    else (pdh/pdl/pdc/premarket_high/premarket_low/orh/orl/session_vwap/
    prior_day_vwap) is already its own distinct method."""
    if source.startswith("swing_"):
        return "swing"
    if source in ("round_1", "round_5"):
        return "round"
    return source


def _regular_session_mask(idx_et):
    minutes = idx_et.hour * 60 + idx_et.minute
    return (minutes >= 9 * 60 + 30) & (minutes < 16 * 60)


def _prior_trading_date(dates_et, today_et: _date):
    """Most recent date strictly before today present in `dates_et`."""
    earlier = [d for d in set(dates_et) if d < today_et]
    return max(earlier) if earlier else None


# ── Candidate source gathering ───────────────────────────────────────────────

def _swing_source_points(highs: list, lows: list, timestamps: list, source_tag: str) -> list:
    hi_idx, lo_idx = _find_swing_points(highs, lows)
    now = datetime.now(timezone.utc)

    def _age_days(ts) -> float:
        t = ts if ts.tzinfo else ts.tz_localize("UTC")
        return max(0.0, (now - t.tz_convert("UTC")).total_seconds() / 86400.0)

    pts = []
    for i in hi_idx:
        pts.append({"price": float(highs[i]), "source": f"swing_high_{source_tag}",
                    "age_days": _age_days(timestamps[i]), "date": _et_date_iso(timestamps[i])})
    for i in lo_idx:
        pts.append({"price": float(lows[i]), "source": f"swing_low_{source_tag}",
                    "age_days": _age_days(timestamps[i]), "date": _et_date_iso(timestamps[i])})
    return pts


def _et_date_iso(ts) -> str:
    """YYYY-MM-DD of a bar timestamp in ET (naive timestamps are taken as ET,
    which is how yfinance labels daily bars)."""
    if getattr(ts, "tzinfo", None) is not None:
        return ts.tz_convert(ET).date().isoformat()
    return ts.date().isoformat()


def _gather_points(ticker: str, daily, intraday_5d, today_session, timeframe: str) -> tuple:
    """
    Returns (points, current_price, atr, prior_day, volume_ref).
    `volume_ref` = (avg_intraday_bar_volume, intraday_5d) used later for the
    volume-traded-at-level score.
    """
    import pandas as pd

    today_et = datetime.now(ET).date()
    today_iso = today_et.isoformat()

    daily_dates = daily.index.tz_localize(ET) if daily.index.tz is None else daily.index.tz_convert(ET)
    daily_is_today = daily_dates.date == today_et
    daily_complete = daily[~daily_is_today]
    if daily_complete.empty:
        daily_complete = daily  # thin history fallback — better than no prior day at all

    current_price = None
    if today_session is not None and not today_session.empty:
        current_price = float(today_session["Close"].iloc[-1])
    if current_price is None:
        current_price = float(daily["Close"].iloc[-1])

    atr = _atr(daily["High"], daily["Low"], daily["Close"], 14)

    points: list = []

    # Daily-timeframe swings, over up to 60d.
    points += _swing_source_points(
        daily["High"].tolist(), daily["Low"].tolist(), list(daily.index), "1d",
    )

    # Intraday-timeframe swings, over the requested granularity's 5d window.
    if intraday_5d is not None and not intraday_5d.empty:
        points += _swing_source_points(
            intraday_5d["High"].tolist(), intraday_5d["Low"].tolist(), list(intraday_5d.index), timeframe,
        )

    # Prior-day H/L/C.
    prev_row = daily_complete.iloc[-1]
    prior_iso = _et_date_iso(daily_complete.index[-1])
    prior_day = {"high": float(prev_row["High"]), "low": float(prev_row["Low"]), "close": float(prev_row["Close"])}
    points.append({"price": prior_day["high"], "source": "pdh", "age_days": 1.0, "date": prior_iso})
    points.append({"price": prior_day["low"], "source": "pdl", "age_days": 1.0, "date": prior_iso})
    points.append({"price": prior_day["close"], "source": "pdc", "age_days": 1.0, "date": prior_iso})

    # Premarket H/L + ORH/ORL + session VWAP — all from today's finer-grained session bars.
    orh = orl = None
    if today_session is not None and not today_session.empty:
        idx_et = today_session.index.tz_convert(ET) if today_session.index.tz is not None else today_session.index.tz_localize(ET)
        pre_mask = (idx_et.hour * 60 + idx_et.minute) < 9 * 60 + 30
        premarket = today_session[pre_mask]
        if not premarket.empty:
            points.append({"price": float(premarket["High"].max()), "source": "premarket_high", "age_days": 0.0, "date": today_iso})
            points.append({"price": float(premarket["Low"].min()), "source": "premarket_low", "age_days": 0.0, "date": today_iso})

        try:
            from services.utils.orb_data_hub import get_orb_data_hub
            status = get_orb_data_hub().get_status(ticker)
            if status and status.session_date == today_et and status.phase == "ready" and status.orh and status.orl:
                orh, orl = float(status.orh), float(status.orl)
        except Exception:
            pass
        if orh is None:
            orb_mask = (idx_et.hour * 60 + idx_et.minute >= 9 * 60 + 30) & (idx_et.hour * 60 + idx_et.minute < 9 * 60 + 45)
            orb_bars = today_session[orb_mask]
            if not orb_bars.empty:
                orh, orl = float(orb_bars["High"].max()), float(orb_bars["Low"].min())
        if orh is not None and orl is not None:
            points.append({"price": orh, "source": "orh", "age_days": 0.0, "date": today_iso})
            points.append({"price": orl, "source": "orl", "age_days": 0.0, "date": today_iso})

        reg_mask = _regular_session_mask(idx_et)
        session_vwap = _vwap_from_bars(today_session[reg_mask])
        if session_vwap:
            points.append({"price": session_vwap, "source": "session_vwap", "age_days": 0.0, "date": today_iso})

    # Prior-day VWAP, from the 5d intraday set filtered to that date's regular session.
    if intraday_5d is not None and not intraday_5d.empty:
        idx_et5 = intraday_5d.index.tz_convert(ET) if intraday_5d.index.tz is not None else intraday_5d.index.tz_localize(ET)
        prior_date = _prior_trading_date(idx_et5.date, today_et)
        if prior_date is not None:
            day_mask = (idx_et5.date == prior_date) & _regular_session_mask(idx_et5)
            prior_vwap = _vwap_from_bars(intraday_5d[day_mask])
            if prior_vwap:
                points.append({"price": prior_vwap, "source": "prior_day_vwap", "age_days": 1.0,
                               "date": prior_date.isoformat()})

    # Round numbers near current price — "touched" as of today.
    points += [{**p, "date": today_iso} for p in _round_number_points(current_price)]

    return points, current_price, atr, prior_day


# ── Clustering + scoring ─────────────────────────────────────────────────────

def _cluster_points(points: list, tolerance_abs: float) -> list:
    """
    Groups points within `tolerance_abs` of each other's running mean into
    one zone. Each point compared against the CLUSTER'S MEAN (not just the
    last point added), same anti-drift rule as the old _cluster_levels —
    a slow chain of close points can't span far more than tolerance_abs
    end-to-end.
    """
    if not points:
        return []
    pts = sorted(points, key=lambda p: p["price"])
    clusters = [[pts[0]]]
    for p in pts[1:]:
        cluster_mean = sum(c["price"] for c in clusters[-1]) / len(clusters[-1])
        if abs(p["price"] - cluster_mean) <= tolerance_abs:
            clusters[-1].append(p)
        else:
            clusters.append([p])
    return clusters


def confluence_bonus(extra_categories: int) -> float:
    """Diminishing bonus for `extra_categories` distinct source categories
    beyond the first — see _CONFLUENCE_STEPS."""
    n = max(0, min(extra_categories, len(_CONFLUENCE_STEPS)))
    return sum(_CONFLUENCE_STEPS[:n])


def score_terms(touches: int, freshest_age_days: float, volume_ratio: float,
                category_count: int) -> dict:
    """
    Pure scoring v2 — no I/O, unit-testable directly. `volume_ratio` is zone
    volume over its expected volume (avg bar volume * touches * headroom);
    `category_count` is the number of distinct source categories.
    Returns each term plus `score` = min(100, sum). Proximity to price is
    deliberately NOT a term: that's the gate/alerts' job (ZONE_NEAR_PCT,
    _APPROACH_PCT), and zones() uses it only as a display tiebreak.
    """
    touch = _TOUCH_WEIGHT * (min(max(touches, 0), _TOUCH_MAX) / _TOUCH_MAX) ** 0.5
    recency = _RECENCY_WEIGHT * 0.5 ** (max(freshest_age_days, 0.0) / _RECENCY_HALF_LIFE_DAYS)
    volume = _VOLUME_WEIGHT * min(1.0, max(volume_ratio, 0.0))
    confluence = confluence_bonus(category_count - 1)
    return {
        "touch": touch, "recency": recency, "volume": volume, "confluence": confluence,
        "score": min(100.0, touch + recency + volume + confluence),
    }


def _dedupe_cluster(cluster: list) -> list:
    """
    Collapses points with identical (round(price, 2), source) to one — the
    same swing point must never count as two touches. Applied before
    anything else reads `cluster` (touches, center/low/high, touch_detail,
    confluence categories), so a duplicate point can't inflate the zone's
    geometry OR its score. First occurrence wins (dict insertion order),
    so touch_detail's eventual sort is unaffected by which duplicate
    happened to carry the tie-broken date.
    """
    seen: dict = {}
    for p in cluster:
        key = (round(p["price"], 2), p["source"])
        if key not in seen:
            seen[key] = p
    return list(seen.values())


def _score_cluster(cluster: list, intraday_5d, tolerance_abs: float) -> dict:
    cluster = _dedupe_cluster(cluster)
    center = sum(p["price"] for p in cluster) / len(cluster)
    low = min(p["price"] for p in cluster)
    high = max(p["price"] for p in cluster)
    half_width = max((high - low) / 2, tolerance_abs / 2)
    low, high = center - half_width, center + half_width

    touches = len(cluster)
    # Recency: the freshest *prior-day* touch represents the zone — a level
    # tested both 2 days ago and 50 days ago reads as "tested 2 days ago"
    # for recency purposes; touch count already rewards the repeat separately.
    # Same-day points (premarket/session/round levels, age < 1) don't earn
    # freshness: a level only proven by today's tape hasn't earned it yet.
    # Falls back to the overall freshest touch when the zone is entirely
    # same-day.
    prior_ages = [p["age_days"] for p in cluster if p["age_days"] >= 1.0]
    freshest_age = min(prior_ages) if prior_ages else min(p["age_days"] for p in cluster)

    volume_ratio = 0.0
    if intraday_5d is not None and not intraday_5d.empty:
        overlap = intraday_5d[(intraday_5d["High"] >= low) & (intraday_5d["Low"] <= high)]
        avg_bar_vol = float(intraday_5d["Volume"].mean() or 0.0)
        avg_bar_range = float((intraday_5d["High"] - intraday_5d["Low"]).mean() or 0.0)
        zone_width = max(high - low, tolerance_abs)
        # Density comparison: overlapping volume per $1 of zone width vs the
        # naive per-touch expectation spread over a typical bar range. Wide
        # zones no longer score on width alone — only genuine volume
        # concentration maxes the term.
        if avg_bar_vol > 0 and avg_bar_range > 0 and zone_width > 0:
            expected_density = (avg_bar_vol / avg_bar_range) * max(touches, 1) * _VOLUME_HEADROOM_MULT
            volume_ratio = float(overlap["Volume"].sum() / zone_width) / expected_density

    categories = {_category(p["source"]) for p in cluster}
    terms = score_terms(touches, freshest_age, volume_ratio, len(categories))

    return {
        "center": round(center, 4),
        "low": round(low, 4),
        "high": round(high, 4),
        "score": round(terms["score"], 1),
        "touches": touches,
        "sources": sorted({p["source"] for p in cluster}),
        # Every point behind the zone, for the app's zone detail sheet:
        # newest date first, then highest price.
        "touch_detail": touch_detail(cluster),
        # The v2 breakdown the detail sheet draws as bars.
        "score_terms": {k: round(v, 1) for k, v in terms.items()},
    }


def touch_detail(cluster: list) -> list:
    """[{price, date, source}] for each point, newest date first, then
    highest price. Pure — no I/O."""
    rows = [{"price": round(p["price"], 2), "date": p.get("date"), "source": p["source"]} for p in cluster]
    rows.sort(key=lambda r: r["price"], reverse=True)
    rows.sort(key=lambda r: r["date"] or "", reverse=True)  # stable: keeps price order within a date
    return rows


def rank_zones(zone_list: list, current_price: float, limit: int = 3) -> list:
    """Top `limit` zones by score desc, ties broken by distance from
    `current_price` (nearest first) — also the order they're returned in."""
    def _distance(z):
        if z["low"] <= current_price <= z["high"]:
            return 0.0
        return min(abs(current_price - z["low"]), abs(current_price - z["high"]))
    return sorted(zone_list, key=lambda z: (-z["score"], _distance(z)))[:limit]


# ── Public API ────────────────────────────────────────────────────────────────

def zones(ticker: str, timeframe: str = "30m", force_refresh: bool = False) -> dict:
    """
    Top-3 resistance zones above price + top-3 support zones below, each
    side ordered by score desc (ties: nearest to price first — see
    rank_zones), each `{center, low, high, score, touches, sources[]}`.
    `timeframe` selects the intraday granularity fed into the swing-point
    and volume sources (5m/15m/30m) — the clustering/scoring method itself
    is identical regardless of which one is chosen.
    """
    ticker = ticker.upper().strip()
    if ticker.startswith("$"):
        return {"error": "index_ticker_unsupported", "ticker": ticker}
    if timeframe not in _ALLOWED_TIMEFRAMES:
        timeframe = "30m"
    now = time.time()
    cache_key = f"{ticker}:{timeframe}"

    with _cache_lock:
        entry = _cache.get(cache_key)
    if not force_refresh and entry and now - entry["fetched_at"] < _CACHE_TTL_SECONDS:
        return entry["data"]

    try:
        future = _fetch_pool.submit(_fetch_history, ticker, timeframe)
        try:
            daily, intraday_5d, today_session = future.result(timeout=_FETCH_TIMEOUT_SECONDS)
        except concurrent.futures.TimeoutError:
            if entry:
                logger.warning("[zone_engine] %s (%s) fetch timed out after %ss — serving cached zones from %.0fs ago",
                               ticker, timeframe, _FETCH_TIMEOUT_SECONDS, now - entry["fetched_at"])
                return {**entry["data"], "stale": True}
            logger.warning("[zone_engine] %s (%s) fetch timed out after %ss with no cache",
                           ticker, timeframe, _FETCH_TIMEOUT_SECONDS)
            return {"error": "market_data_timeout", "ticker": ticker}

        if daily.empty or len(daily) < 30:
            return {"error": "insufficient_history", "ticker": ticker}

        points, current_price, atr, prior_day = _gather_points(
            ticker, daily, intraday_5d, today_session, timeframe,
        )

        # The SMALLER of the two candidates, not the larger. On a name with
        # an elevated ATR (AMZN's $5.42 on 2026-09-30, ~2.2% of price) the
        # ATR term alone ($1.36) is wide enough to merge genuinely distinct
        # zones — verified against this exact session: with max(), the PDL
        # ($245.14) and the ORH ($247.68) collapsed into one 3-dollar band,
        # exactly the two levels the TODO's acceptance case names as
        # separate ($245 support vs. $247.50-248 resistance/trigger). min()
        # keeps ATR only as a WIDENING factor on a tight/low-ATR name where
        # 0.2% of price would be sub-cent, never as grounds to swallow
        # multi-dollar structure on a volatile day.
        tolerance_abs = min(_TOL_PCT * current_price, _TOL_ATR_MULT * (atr or float("inf")))
        if tolerance_abs <= 0 or tolerance_abs == float("inf"):
            tolerance_abs = _TOL_PCT * current_price

        clusters = _cluster_points(points, tolerance_abs)
        scored = [_score_cluster(c, intraday_5d, tolerance_abs) for c in clusters]
        for z in scored:
            z["type"] = "resistance" if z["center"] > current_price else "support"

        resistance = rank_zones([z for z in scored if z["type"] == "resistance"], current_price)
        support = rank_zones([z for z in scored if z["type"] == "support"], current_price)

        result = {
            "ticker": ticker,
            "current_price": round(current_price, 4),
            "atr": round(atr, 4) if atr is not None else None,
            "tolerance": round(tolerance_abs, 4),
            "timeframe": timeframe,
            "prior_day": {k: round(v, 4) for k, v in prior_day.items()},
            "resistance": resistance,
            "support": support,
            "last_fetched_utc": datetime.now(timezone.utc).isoformat(),
        }

        with _cache_lock:
            _cache[cache_key] = {"data": result, "fetched_at": now}

        return result

    except Exception as e:
        logger.warning("[zone_engine] zones failed for %s (%s): %s", ticker, timeframe, e)
        return {"error": str(e), "ticker": ticker}


def _drop_zero_volume_bars(ticker: str, bars, label: str):
    """
    Drops every REGULAR-SESSION bar with Volume <= 0 — a bar with no trades
    is a placeholder row Yahoo prints, not market data, and its OHLC is
    meaningless. One filter here, right at ingestion, fixes everything
    downstream at once for the bars it actually touches: swing detection,
    clustering, `current_price` (which then naturally falls back to the
    last *traded* bar's close), and the volume baseline for the scoring
    volume term.

    DELIBERATELY SCOPED to the regular session (9:30-16:00 ET), unlike the
    bad-tick guard below — verified 2026-10-01 against SPY/QQQ/AAPL: this
    feed reports Volume=0 for essentially EVERY extended-hours bar
    unconditionally (87/87 on a 5d/30m SPY pull), including completely
    ordinary ones, while regular-session volume was reliable (0/58 zero).
    Outside the regular session this field can't tell a real bar from a
    bad one at all — applying it there wouldn't catch anything the
    bad-tick guard doesn't already catch more precisely, and it WOULD
    silently delete premarket_high/premarket_low's entire source data
    every single day (every extended-hours bar, not just the bad ones),
    directly undoing the "premarket/after-hours bars are legitimate
    sources" requirement this fix is supposed to respect. The two-bar SPY
    case this pair of filters was built for is itself an after-hours bug —
    it's the price-based bad-tick guard, not this volume-based one, that
    actually catches it; see that function's docstring.

    Only intraday bars are checked at all — a 0-volume DAILY bar on a real
    ticker doesn't happen; filtering one would be dead code.

    Logged at debug, not warning — unlike _drop_bad_tick_bars below, a
    zero-volume regular-session bar is rare (this is the backstop for a
    genuine anomaly there), but still routine enough not to warrant a
    server-log alarm every time it fires.
    """
    if bars is None or bars.empty:
        return bars
    import pandas as pd
    idx_et = bars.index.tz_convert(ET) if bars.index.tz is not None else bars.index.tz_localize(ET)
    reg_mask = _regular_session_mask(idx_et)
    regular, extended = bars[reg_mask], bars[~reg_mask]
    before = len(regular)
    regular = regular[regular["Volume"] > 0]
    dropped = before - len(regular)
    if dropped:
        logger.debug("[zone_engine] %s %s: dropped %d zero-volume regular-session bar(s)", ticker, label, dropped)
    return pd.concat([regular, extended]).sort_index()


def _drop_bad_tick_bars(ticker: str, bars, label: str):
    """
    Defense in depth beyond the zero-volume filter above: drops any bar
    whose Low gaps more than BAD_TICK_PCT below the PRIOR bar's Close — a
    bogus print that happens to carry nonzero volume (a thin/erroneous
    trade print, rather than the zero-volume placeholder rows the other
    filter catches) would otherwise sail through untouched. Checked
    against the bar immediately before it in this same (already
    zero-volume-filtered) series, so a dropped bar never cascades into
    falsely flagging the next one.

    Logged at WARNING — a bar with real volume that still gets dropped
    here is a genuinely unusual event worth seeing in the server log, not
    a routine occurrence like a thin pre-market bar.
    """
    if bars is None or bars.empty or len(bars) < 2:
        return bars
    prev_close = bars["Close"].shift(1)
    gap_pct = (bars["Low"] - prev_close).abs() / prev_close
    bad = gap_pct.fillna(0.0) > BAD_TICK_PCT  # first bar has no prev_close (NaN) — can't judge it, keep it
    if bad.any():
        for ts, is_bad in bad.items():
            if is_bad:
                logger.warning(
                    "[zone_engine] %s %s: dropping bad tick @ %s — Low %.2f vs prior close %.2f (%.1f%% gap)",
                    ticker, label, ts, bars.loc[ts, "Low"], prev_close.loc[ts], gap_pct.loc[ts] * 100,
                )
        bars = bars[~bad]
    return bars


def _fetch_history(ticker: str, timeframe: str) -> tuple:
    """The three live yfinance fetches zones() needs: (daily 60d, intraday
    5d at `timeframe`, today's 5m session incl. pre/post). Run on
    _fetch_pool so zones() can bound the wait.

    `prepost=True` is kept on both intraday fetches — premarket/after-hours
    bars are legitimate sources (premarket_high/low). We filter GARBAGE
    bars (zero-volume placeholders, bad ticks) below, never the session."""
    import yfinance as yf
    tk = yf.Ticker(ticker)
    daily = tk.history(period="60d", interval="1d")
    if daily.empty or len(daily) < 30:
        return daily, None, None
    intraday_5d = tk.history(period="5d", interval=timeframe, prepost=True)
    today_session = tk.history(period="1d", interval="5m", prepost=True)

    intraday_5d = _drop_zero_volume_bars(ticker, intraday_5d, "intraday_5d")
    intraday_5d = _drop_bad_tick_bars(ticker, intraday_5d, "intraday_5d")
    today_session = _drop_zero_volume_bars(ticker, today_session, "today_session")
    today_session = _drop_bad_tick_bars(ticker, today_session, "today_session")

    return daily, intraday_5d, today_session


def get_support_resistance(ticker: str, force_refresh: bool = False) -> dict:
    """
    Drop-in replacement for the old technical_service.get_support_resistance
    return shape — {ticker, current_price, support, resistance, pivots,
    last_fetched_utc}, each level {price, touches, strength, type} — so
    every existing caller (`/strategy/support-resistance/<ticker>`,
    `PriceChartFullScreen`'s `showSR` layer, muse.py's summary) keeps
    working unchanged while the richer `zones()` (bands + sources + a 0-100
    score) backs the new chart auto-zone layer and the entry gate instead.
    `strength` here is the new 0-100 score rescaled to roughly the old
    metric's range (touch-count-ish, 0-10) purely so an existing UI that
    prints it as a bare number doesn't suddenly show "87".
    """
    z = zones(ticker, timeframe="30m", force_refresh=force_refresh)
    if z.get("error"):
        return z

    def _shim(levels: list, kind: str) -> list:
        return [
            {"price": lv["center"], "touches": lv["touches"], "strength": round(lv["score"] / 10.0, 2), "type": kind}
            for lv in levels
        ]

    pd_ = z["prior_day"]
    pivots = _classic_pivots(pd_["high"], pd_["low"], pd_["close"])

    return {
        "ticker": z["ticker"],
        "current_price": z["current_price"],
        "support": _shim(z["support"], "support"),
        "resistance": _shim(z["resistance"], "resistance"),
        "pivots": {k: round(v, 4) for k, v in pivots.items()},
        "last_fetched_utc": z["last_fetched_utc"],
    }
