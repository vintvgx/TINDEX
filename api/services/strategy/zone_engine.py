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
  - SCORING (0-100, clipped): touch count (capped at 4 touches' worth of
    benefit) + recency (exponential decay, today's ORB/premarket/VWAP score
    near-full, a 55-day-old daily swing barely registers but is never
    dropped) + volume traded through the band + a confluence bonus for each
    DISTINCT extra source category beyond the first (repeated swing touches
    are one category — "swing" — not one per touch; each of PDH/PDL/PDC/
    ORH/ORL/premarket/round/VWAP is its own category).

Refreshed far more often than the old 8h S/R cache (`_CACHE_TTL_SECONDS`
below) — several of the sources above (ORB, premarket, session VWAP) are
only meaningful "as of a moment ago" during a live session.
"""

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

_SWING_WINDOW = 3  # fractal confirmation bars each side — same as the old technical_service constant

# Clustering tolerance: the larger of a flat % of price or a fraction of
# daily ATR-14 — a fixed %-only tolerance (the old 1%) is too tight on a
# low-ATR day and too wide on a high-ATR one.
_TOL_PCT = 0.002
_TOL_ATR_MULT = 0.25

# Scoring weights — all out of 100 before the confluence bonus, which is
# genuinely additive on top (a single-source zone can still reach 100 via
# touches+recency+volume; confluence pushes an already-strong zone higher
# still, matching "conviction = confluence count" from the TODO).
_TOUCH_MAX = 4
_TOUCH_WEIGHT = 40.0
_RECENCY_WEIGHT = 25.0
_RECENCY_HALF_LIFE_DAYS = 5.0     # a touch 5 days old scores half of "just now"; 55 days old ~= 1/1024
_VOLUME_WEIGHT = 15.0
_VOLUME_HEADROOM_MULT = 3.0        # zone volume at 3x the naive per-touch expectation maxes this term
_CONFLUENCE_BONUS = 25.0
_CONFLUENCE_MAX_EXTRA = 2          # cap: 2 extra independent source categories => +50 max
# Every term's own max, summed — the denominator _score_cluster normalizes
# against, so hitting 100 requires touches, recency, volume AND confluence
# all near their individual caps at once (see _score_cluster's comment).
_SCORE_RAW_MAX = _TOUCH_WEIGHT + _RECENCY_WEIGHT + _VOLUME_WEIGHT + (_CONFLUENCE_MAX_EXTRA * _CONFLUENCE_BONUS)

# Round numbers only count as a source near price — far enough away and
# "round" stops being a level anyone is actually watching.
_ROUND_1_MAX_DIST_PCT = 0.03
_ROUND_5_MAX_DIST_PCT = 0.08

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
        pts.append({"price": float(highs[i]), "source": f"swing_high_{source_tag}", "age_days": _age_days(timestamps[i])})
    for i in lo_idx:
        pts.append({"price": float(lows[i]), "source": f"swing_low_{source_tag}", "age_days": _age_days(timestamps[i])})
    return pts


def _gather_points(ticker: str, daily, intraday_5d, today_session, timeframe: str) -> tuple:
    """
    Returns (points, current_price, atr, prior_day, volume_ref).
    `volume_ref` = (avg_intraday_bar_volume, intraday_5d) used later for the
    volume-traded-at-level score.
    """
    import pandas as pd

    today_et = datetime.now(ET).date()

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
    prior_day = {"high": float(prev_row["High"]), "low": float(prev_row["Low"]), "close": float(prev_row["Close"])}
    points.append({"price": prior_day["high"], "source": "pdh", "age_days": 1.0})
    points.append({"price": prior_day["low"], "source": "pdl", "age_days": 1.0})
    points.append({"price": prior_day["close"], "source": "pdc", "age_days": 1.0})

    # Premarket H/L + ORH/ORL + session VWAP — all from today's finer-grained session bars.
    orh = orl = None
    if today_session is not None and not today_session.empty:
        idx_et = today_session.index.tz_convert(ET) if today_session.index.tz is not None else today_session.index.tz_localize(ET)
        pre_mask = (idx_et.hour * 60 + idx_et.minute) < 9 * 60 + 30
        premarket = today_session[pre_mask]
        if not premarket.empty:
            points.append({"price": float(premarket["High"].max()), "source": "premarket_high", "age_days": 0.0})
            points.append({"price": float(premarket["Low"].min()), "source": "premarket_low", "age_days": 0.0})

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
            points.append({"price": orh, "source": "orh", "age_days": 0.0})
            points.append({"price": orl, "source": "orl", "age_days": 0.0})

        reg_mask = _regular_session_mask(idx_et)
        session_vwap = _vwap_from_bars(today_session[reg_mask])
        if session_vwap:
            points.append({"price": session_vwap, "source": "session_vwap", "age_days": 0.0})

    # Prior-day VWAP, from the 5d intraday set filtered to that date's regular session.
    if intraday_5d is not None and not intraday_5d.empty:
        idx_et5 = intraday_5d.index.tz_convert(ET) if intraday_5d.index.tz is not None else intraday_5d.index.tz_localize(ET)
        prior_date = _prior_trading_date(idx_et5.date, today_et)
        if prior_date is not None:
            day_mask = (idx_et5.date == prior_date) & _regular_session_mask(idx_et5)
            prior_vwap = _vwap_from_bars(intraday_5d[day_mask])
            if prior_vwap:
                points.append({"price": prior_vwap, "source": "prior_day_vwap", "age_days": 1.0})

    # Round numbers near current price.
    points += _round_number_points(current_price)

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


def _score_cluster(cluster: list, intraday_5d, tolerance_abs: float) -> dict:
    center = sum(p["price"] for p in cluster) / len(cluster)
    low = min(p["price"] for p in cluster)
    high = max(p["price"] for p in cluster)
    half_width = max((high - low) / 2, tolerance_abs / 2)
    low, high = center - half_width, center + half_width

    touches = len(cluster)
    touch_score = min(touches, _TOUCH_MAX) / _TOUCH_MAX * _TOUCH_WEIGHT

    # Recency: the single freshest touch represents the zone — a level
    # tested both 2 days ago and 50 days ago reads as "tested 2 days ago"
    # for recency purposes; touch count already rewards the repeat separately.
    freshest_age = min(p["age_days"] for p in cluster)
    recency_score = (0.5 ** (freshest_age / _RECENCY_HALF_LIFE_DAYS)) * _RECENCY_WEIGHT

    volume_score = 0.0
    if intraday_5d is not None and not intraday_5d.empty:
        overlap = intraday_5d[(intraday_5d["High"] >= low) & (intraday_5d["Low"] <= high)]
        avg_bar_vol = float(intraday_5d["Volume"].mean() or 0.0)
        if avg_bar_vol > 0:
            zone_vol = float(overlap["Volume"].sum())
            expected = avg_bar_vol * max(touches, 1) * _VOLUME_HEADROOM_MULT
            volume_score = min(1.0, zone_vol / expected) * _VOLUME_WEIGHT if expected > 0 else 0.0

    categories = {_category(p["source"]) for p in cluster}
    confluence_extra = min(len(categories) - 1, _CONFLUENCE_MAX_EXTRA)
    confluence_bonus = confluence_extra * _CONFLUENCE_BONUS

    # Normalized against the sum of every term's OWN cap (130), not clipped
    # directly. touch_score (cap 40) and recency_score (cap 25) each
    # saturate trivially on their own — 4+ touches, or one same-day source
    # (orb/premarket/vwap have age_days=0, and most real intraday zones
    # carry one) — so summing-then-clipping-at-100 let unrelated zones tie
    # at the ceiling (verified against AMZN 9/30: 5 of 9 support zones tied
    # at exactly 100.0, and "top 3 by score" arbitrarily dropped the ORH
    # zone — the exact trigger the TODO's acceptance case names — in favor
    # of less specific ones via sort-stability alone). Dividing by the true
    # combined max means hitting 100 needs every term near its cap at once,
    # which is rare enough to actually rank zones instead of tying them.
    raw = touch_score + recency_score + volume_score + confluence_bonus
    score = min(100.0, raw / _SCORE_RAW_MAX * 100.0)

    return {
        "center": round(center, 4),
        "low": round(low, 4),
        "high": round(high, 4),
        "score": round(score, 1),
        "touches": touches,
        "sources": sorted({p["source"] for p in cluster}),
    }


# ── Public API ────────────────────────────────────────────────────────────────

def zones(ticker: str, timeframe: str = "30m", force_refresh: bool = False) -> dict:
    """
    Top-3 resistance zones above price + top-3 support zones below, nearest-
    to-price first, each `{center, low, high, score, touches, sources[]}`.
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

    if not force_refresh:
        with _cache_lock:
            entry = _cache.get(cache_key)
        if entry and now - entry["fetched_at"] < _CACHE_TTL_SECONDS:
            return entry["data"]

    try:
        import yfinance as yf

        tk = yf.Ticker(ticker)
        daily = tk.history(period="60d", interval="1d")
        if daily.empty or len(daily) < 30:
            return {"error": "insufficient_history", "ticker": ticker}

        intraday_5d = tk.history(period="5d", interval=timeframe, prepost=True)
        today_session = tk.history(period="1d", interval="5m", prepost=True)

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

        resistance = sorted([z for z in scored if z["type"] == "resistance"], key=lambda z: -z["score"])[:3]
        support = sorted([z for z in scored if z["type"] == "support"], key=lambda z: -z["score"])[:3]
        resistance.sort(key=lambda z: z["center"])
        support.sort(key=lambda z: -z["center"])

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
