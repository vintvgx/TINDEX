"""
Gap Analysis Service — ORB notification enrichment.

Computes gap size (prior close vs today open) and prior-day trend (bullish/bearish/flat)
for ORB breakout context. Intended to run at ~9:25 AM ET before the ORB window (9:30–9:45);
today_open is supplied later when the ORB range is saved (~9:45).

Design:
- Singleton; caches prior-day OHLC per ticker so ORB services can merge gap/trend
  into orb_ranges at save time.
- Pure calculation for gap_direction, prior_day_trend, trend_continuation;
  no Supabase dependency (ORB services perform DB writes).
"""

import asyncio
import logging
from datetime import date
from typing import Dict, List, Optional, Any

import yfinance as yf

logger = logging.getLogger(__name__)

# Thresholds (spec)
GAP_FLAT_PERCENT = 0.15
PRIOR_DAY_FLAT_PERCENT = 0.1


def compute_gap_context(
    prior_close: float,
    prior_day_open: float,
    today_open: float,
) -> Dict[str, Any]:
    """
    Compute gap and prior-day trend fields from OHLC inputs.

    Used when saving orb_ranges (today_open from first bar) and for consistency
    in tests. All price args must be > 0.

    Returns:
        Dict with: prior_close, today_open, gap_points, gap_percent, gap_direction,
        prior_day_open, prior_day_trend, trend_continuation. All values present;
        gap_direction in ('up','down','flat'), prior_day_trend in ('bullish','bearish','flat').
    """
    if prior_close <= 0 or prior_day_open <= 0 or today_open <= 0:
        logger.warning(
            "compute_gap_context: invalid inputs (prior_close=%s, prior_day_open=%s, today_open=%s)",
            prior_close, prior_day_open, today_open,
        )
        return _empty_gap_context(prior_close, prior_day_open, today_open)

    gap_points = round(today_open - prior_close, 2)
    gap_percent = round((today_open - prior_close) / prior_close * 100, 3)

    if abs(gap_percent) < GAP_FLAT_PERCENT:
        gap_direction = "flat"
    elif gap_percent > 0:
        gap_direction = "up"
    else:
        gap_direction = "down"

    prior_day_change_pct = (prior_close - prior_day_open) / prior_day_open * 100
    if abs(prior_day_change_pct) < PRIOR_DAY_FLAT_PERCENT:
        prior_day_trend = "flat"
    elif prior_day_change_pct > 0:
        prior_day_trend = "bullish"
    else:
        prior_day_trend = "bearish"

    trend_continuation = (
        (prior_day_trend == "bullish" and gap_direction == "up")
        or (prior_day_trend == "bearish" and gap_direction == "down")
    )

    return {
        "prior_close": round(prior_close, 2),
        "today_open": round(today_open, 2),
        "gap_points": gap_points,
        "gap_percent": gap_percent,
        "gap_direction": gap_direction,
        "prior_day_open": round(prior_day_open, 2),
        "prior_day_trend": prior_day_trend,
        "trend_continuation": trend_continuation,
    }


def _empty_gap_context(
    prior_close: Optional[float] = None,
    prior_day_open: Optional[float] = None,
    today_open: Optional[float] = None,
) -> Dict[str, Any]:
    """Return gap context with None/False for missing or invalid data."""
    return {
        "prior_close": round(prior_close, 2) if prior_close else None,
        "today_open": round(today_open, 2) if today_open else None,
        "gap_points": None,
        "gap_percent": None,
        "gap_direction": None,
        "prior_day_open": round(prior_day_open, 2) if prior_day_open else None,
        "prior_day_trend": None,
        "trend_continuation": False,
    }


class GapAnalysisService:
    """
    Fetches and caches prior-day OHLC for monitored tickers (~9:25 AM ET).
    ORB services call get_cached_prior(ticker) and compute_gap_context(..., today_open)
    when saving the ORB range.
    """

    def __init__(self):
        self._cache: Dict[str, Dict[str, float]] = {}
        self._cache_date: Optional[date] = None

    def get_cached_prior(self, ticker: str) -> Optional[Dict[str, float]]:
        """
        Return cached prior_close and prior_day_open for ticker, or None.
        Cache is keyed by date; if cache is for a different day, returns None.
        """
        if self._cache_date is None:
            return None
        return self._cache.get(ticker)

    def get_cache_date(self) -> Optional[date]:
        return self._cache_date

    def clear_cache(self):
        self._cache.clear()
        self._cache_date = None

    async def fetch_and_cache_prior_day_ohlc(self, tickers: List[str]) -> int:
        """
        Fetch previous trading day's open and close for each ticker via yfinance;
        store in memory for the current trade date. Run at ~9:25 AM ET.

        Returns:
            Number of tickers for which we successfully cached prior OHLC.
        """
        if not tickers:
            return 0

        trade_date = date.today()
        if self._cache_date != trade_date:
            self.clear_cache()
        self._cache_date = trade_date

        loop = asyncio.get_event_loop()

        def fetch_one(ticker: str) -> Optional[Dict[str, float]]:
            try:
                stock = yf.Ticker(ticker)
                hist = stock.history(period="5d", interval="1d")
                if hist is None or len(hist) < 2:
                    logger.warning(
                        "[GAP] %s: insufficient history (need at least 2 days)", ticker
                    )
                    return None
                prev_row = hist.iloc[-2]
                prior_close = float(prev_row["Close"])
                prior_day_open = float(prev_row["Open"])
                if prior_close <= 0 or prior_day_open <= 0:
                    logger.warning(
                        "[GAP] %s: invalid prior OHLC (open=%s, close=%s)",
                        ticker, prior_day_open, prior_close,
                    )
                    return None
                return {"prior_close": prior_close, "prior_day_open": prior_day_open}
            except Exception as e:
                logger.warning("[GAP] %s: fetch failed: %s", ticker, e)
                return None

        count = 0
        for ticker in tickers:
            result = await loop.run_in_executor(None, lambda t=ticker: fetch_one(t))
            if result:
                self._cache[ticker] = result
                count += 1
                logger.info(
                    "[GAP] %s: prior_close=%.2f, prior_day_open=%.2f",
                    ticker, result["prior_close"], result["prior_day_open"],
                )

        logger.info("[GAP] Cached prior-day OHLC for %d/%d tickers", count, len(tickers))
        return count


# Singleton
_gap_analysis_service: Optional[GapAnalysisService] = None


def get_gap_analysis_service() -> GapAnalysisService:
    """Get or create the singleton GapAnalysisService instance."""
    global _gap_analysis_service
    if _gap_analysis_service is None:
        _gap_analysis_service = GapAnalysisService()
        logger.info("GapAnalysisService singleton created")
    return _gap_analysis_service
