import threading
import time
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_cache: dict = {}
_cache_lock = threading.Lock()
_CACHE_TTL_SECONDS = 8 * 3600

# Separate cache/dict from get_technicals()'s _cache — independent lifetime,
# so a failure or force-refresh of one never affects the other. Shares
# _cache_lock purely as a dict guard (no meaningful contention at this
# request volume) rather than adding a second global lock for no reason.
_sr_cache: dict = {}


def _compute_zone(
    current: float, ema20: float, ema50, ema200,
    rsi, macd_above_signal: bool, dist_pct: float,
) -> str:
    # Bearish: price below its own 20-day EMA, or short-term EMA crossed below mid-term
    if current < ema20 or (ema50 is not None and ema20 < ema50):
        return "bearish"
    # Extended: only to the upside (current > ema20 already guaranteed by the bearish check above)
    if dist_pct > 8.0:
        return "extended"
    if (ema50 is None or ema20 > ema50) and rsi is not None and 35 <= rsi <= 70 and macd_above_signal:
        return "bullish"
    return "neutral"


def get_technicals(ticker: str, force_refresh: bool = False) -> dict:
    ticker = ticker.upper().strip()
    # Index tickers like $SPX, $RUT use exchange-internal symbols yfinance cannot resolve.
    if ticker.startswith("$"):
        return {"error": "index_ticker_unsupported", "ticker": ticker, "trend": "unknown"}
    now = time.time()

    if not force_refresh:
        with _cache_lock:
            entry = _cache.get(ticker)
        if entry and now - entry["fetched_at"] < _CACHE_TTL_SECONDS:
            return entry["data"]

    try:
        import yfinance as yf
        import pandas as pd

        hist = yf.Ticker(ticker).history(period="2y", interval="1d")
        if hist.empty or len(hist) < 22:
            return {"error": "insufficient_history", "ticker": ticker, "trend": "unknown"}

        close = hist["Close"]
        current = float(close.iloc[-1])

        ema20  = float(close.ewm(span=20,  adjust=False).mean().iloc[-1])
        ema50  = float(close.ewm(span=50,  adjust=False).mean().iloc[-1]) if len(close) >= 50  else None
        ema200 = float(close.ewm(span=200, adjust=False).mean().iloc[-1]) if len(close) >= 200 else None

        # RSI-14: guard against loss=0 (all-gain window) producing nan via 0/nan
        delta = close.diff()
        gain  = delta.clip(lower=0).rolling(14).mean()
        loss  = (-delta.clip(upper=0)).rolling(14).mean()
        rs    = gain / loss.replace(0, float("nan"))
        rs_val = float(rs.iloc[-1])
        if pd.isna(rs_val):
            # loss was 0 — pure uptrend → RSI 100; completely flat → 50
            rsi: float | None = 100.0 if float(gain.iloc[-1]) > 0 else 50.0
        else:
            rsi = float(100 - 100 / (1 + rs_val))

        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        macd_line        = ema12 - ema26
        signal_line      = macd_line.ewm(span=9, adjust=False).mean()
        macd_above_signal = float(macd_line.iloc[-1]) > float(signal_line.iloc[-1])
        macd_value        = round(float(macd_line.iloc[-1]), 4)

        high = hist["High"]
        low  = hist["Low"]
        tr = pd.concat([
            high - low,
            (high - close.shift()).abs(),
            (low  - close.shift()).abs(),
        ], axis=1).max(axis=1)
        atr = float(tr.rolling(14).mean().iloc[-1])

        # EMA alignment: is the medium-term trend above the long-term baseline?
        # (EMA50 > EMA200, falling back to EMA20 when EMA50 is unavailable)
        # Uses explicit None-check so the ema20 fallback fires when ema50 is absent,
        # not only when ema50 == 0.0 (the Python-truthiness pitfall in the original).
        ema_aligned = ema20 is not None
        if ema_aligned and ema200 is not None:
            mid = ema50 if ema50 is not None else ema20
            ema_aligned = mid > ema200

        # Net-direction over 10 sessions (two single data points, not a highs/lows check).
        # Named accurately to avoid misleading callers.
        recent = close.iloc[-10:].tolist()
        close_net_rising = recent[-1] > recent[0]

        if ema_aligned and close_net_rising:
            trend = "up"
        elif not ema_aligned and not close_net_rising:
            trend = "down"
        else:
            trend = "sideways"

        dist_from_ema20_pct = abs(current - ema20) / ema20 * 100
        zone = _compute_zone(current, ema20, ema50, ema200, rsi, macd_above_signal, dist_from_ema20_pct)

        result = {
            "ticker":              ticker,
            "current_price":       round(current, 4),
            "ema20":               round(ema20, 4),
            "ema50":               round(ema50, 4) if ema50 is not None else None,
            "ema200":              round(ema200, 4) if ema200 is not None else None,
            "rsi":                 round(rsi, 2),
            "macd_above_signal":   macd_above_signal,
            "macd_value":          macd_value,
            "atr":                 round(atr, 4),
            "trend":               trend,
            "ema_aligned":         ema_aligned,
            "dist_from_ema20_pct": round(dist_from_ema20_pct, 2),
            "zone":                zone,
            "last_fetched_utc":    datetime.now(timezone.utc).isoformat(),
        }

        with _cache_lock:
            _cache[ticker] = {"data": result, "fetched_at": now}

        return result

    except Exception as e:
        logger.warning("[technical_service] Failed for %s: %s", ticker, e)
        return {"error": str(e), "ticker": ticker, "trend": "unknown"}


# ── Historical support/resistance ───────────────────────────────────────────
# Classic fractal swing-point detection over multi-day bars — a fundamentally
# different concept from ORB's orh/orl (same-session, recomputed and
# discarded daily). This aggregates across up to 2 years of daily closes to
# find levels price has repeatedly reacted to, the way a trader manually
# marking up a chart would.

def _find_swing_points(highs: list, lows: list, window: int = 3) -> tuple:
    """
    A bar at index i is a swing high if its high is the max within
    [i-window, i+window] (a local peak with `window` bars of confirmation on
    both sides), swing low if its low is the local min over the same range.
    Returns (swing_high_indices, swing_low_indices).
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


def _cluster_levels(points: list, current_price: float, tolerance_pct: float = 0.01) -> list:
    """
    points: (price, bar_index, total_bars) per swing point. Groups points
    within tolerance_pct of each other into one level — a "level" is really
    a zone, not one exact tick. Each point is compared against its cluster's
    running mean (not just the last point added) so a slow drift across many
    close points can't chain into one cluster spanning far more than
    tolerance_pct end-to-end.

    Scored by touch count + recency: a touch in the most recent third of the
    lookback window counts double — a level tested last month matters more
    than one that hasn't been touched in two years.
    """
    if not points:
        return []
    points = sorted(points, key=lambda p: p[0])
    clusters: list = []
    current_cluster = [points[0]]
    for p in points[1:]:
        cluster_mean = sum(c[0] for c in current_cluster) / len(current_cluster)
        if abs(p[0] - cluster_mean) / cluster_mean <= tolerance_pct:
            current_cluster.append(p)
        else:
            clusters.append(current_cluster)
            current_cluster = [p]
    clusters.append(current_cluster)

    levels = []
    for cluster in clusters:
        price = sum(c[0] for c in cluster) / len(cluster)
        total_bars = cluster[0][2]
        recency_weight = sum(
            2.0 if bar_idx >= total_bars * 0.67 else 1.0
            for _, bar_idx, _ in cluster
        )
        levels.append({
            "price":    round(price, 4),
            "touches":  len(cluster),
            "strength": round(recency_weight, 2),
            "type":     "resistance" if price > current_price else "support",
        })
    return levels


def _classic_pivots(prev_high: float, prev_low: float, prev_close: float) -> dict:
    """Standard daily pivot points off the most recent complete session."""
    pivot = (prev_high + prev_low + prev_close) / 3
    return {
        "pivot": pivot,
        "r1": 2 * pivot - prev_low,
        "s1": 2 * pivot - prev_high,
        "r2": pivot + (prev_high - prev_low),
        "s2": pivot - (prev_high - prev_low),
    }


def get_support_resistance(ticker: str, force_refresh: bool = False) -> dict:
    """
    Historical multi-day support/resistance for `ticker` — swing-point
    clustering over 2 years of daily bars, plus standard daily pivot points
    (pivot/R1/R2/S1/S2 off the prior session) as a cheap, always-available
    complement for tickers too new/thin to have clean swing structure yet.

    Returns the 4 strongest levels above and below the current price,
    nearest-to-price first.
    """
    ticker = ticker.upper().strip()
    if ticker.startswith("$"):
        return {"error": "index_ticker_unsupported", "ticker": ticker}
    now = time.time()

    if not force_refresh:
        with _cache_lock:
            entry = _sr_cache.get(ticker)
        if entry and now - entry["fetched_at"] < _CACHE_TTL_SECONDS:
            return entry["data"]

    try:
        import yfinance as yf

        hist = yf.Ticker(ticker).history(period="2y", interval="1d")
        if hist.empty or len(hist) < 30:
            return {"error": "insufficient_history", "ticker": ticker}

        highs = hist["High"].tolist()
        lows = hist["Low"].tolist()
        current_price = float(hist["Close"].iloc[-1])
        n = len(highs)

        swing_high_idx, swing_low_idx = _find_swing_points(highs, lows, window=3)
        points = (
            [(highs[i], i, n) for i in swing_high_idx]
            + [(lows[i], i, n) for i in swing_low_idx]
        )
        levels = _cluster_levels(points, current_price, tolerance_pct=0.01)

        prev = hist.iloc[-2] if len(hist) >= 2 else hist.iloc[-1]
        pivots = _classic_pivots(float(prev["High"]), float(prev["Low"]), float(prev["Close"]))

        resistance = sorted(
            [lv for lv in levels if lv["type"] == "resistance"],
            key=lambda lv: (-lv["strength"], lv["price"]),
        )[:4]
        support = sorted(
            [lv for lv in levels if lv["type"] == "support"],
            key=lambda lv: (-lv["strength"], -lv["price"]),
        )[:4]
        # Trimmed to the top N by strength above — re-sort by price (nearest
        # to current price first) since that's the more useful reading order
        # once the list is already short.
        resistance.sort(key=lambda lv: lv["price"])
        support.sort(key=lambda lv: -lv["price"])

        result = {
            "ticker": ticker,
            "current_price": round(current_price, 4),
            "support": support,
            "resistance": resistance,
            "pivots": {k: round(v, 4) for k, v in pivots.items()},
            "last_fetched_utc": datetime.now(timezone.utc).isoformat(),
        }

        with _cache_lock:
            _sr_cache[ticker] = {"data": result, "fetched_at": now}

        return result

    except Exception as e:
        logger.warning("[technical_service] S/R failed for %s: %s", ticker, e)
        return {"error": str(e), "ticker": ticker}
