import threading
import time
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_cache: dict = {}
_cache_lock = threading.Lock()
_CACHE_TTL_SECONDS = 8 * 3600


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
