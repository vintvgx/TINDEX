"""
Sentiment filter stack (VIX floor/ceiling + macro event flag).

VIX ceiling is injected from the active profile so WOLF (25) and
BULL DOG (35) have different tolerances.

Macro events no longer block trading — they are returned as a flag so
the engine can include a caution warning in the entry notification while
still taking the trade (volatile macro days often produce the strongest
ORB breakouts).
"""

import os
import logging
import requests
from datetime import date

logger = logging.getLogger(__name__)

VIX_MIN = 13.0

MACRO_KEYWORDS = [
    "FOMC", "Federal Reserve", "CPI", "PPI", "NFP", "Nonfarm",
    "GDP", "PCE", "Interest Rate Decision", "Jobs Report",
]

_finnhub_client = None  # module-level singleton, created once on first use


def _get_finnhub_client():
    global _finnhub_client
    if _finnhub_client is None:
        key = os.getenv("FINNHUB_API_KEY")
        if key:
            try:
                import finnhub  # pylint: disable=import-outside-toplevel
                _finnhub_client = finnhub.Client(api_key=key)
            except ImportError:
                logger.warning("[SentimentFilter] finnhub-python not installed; macro check disabled")
    return _finnhub_client


class SentimentFilter:

    def check_all(self, ticker: str, vix_max: float = 30.0) -> dict:
        """
        Run VIX and premarket filters. Returns a result dict that always
        contains a 'macro_event' bool — True means a high-impact US economic
        event is scheduled today.  Macro events no longer cause 'trade: False';
        the caller decides what to do with the flag (typically a push notification).
        """
        vix = self._get_vix()

        if vix and vix < VIX_MIN:
            return {
                "trade": False, "reason": f"VIX_TOO_LOW ({vix:.1f})",
                "vix": vix, "sentiment": "CALM", "macro_event": False,
            }

        if vix and vix > vix_max:
            return {
                "trade": False, "reason": f"VIX_TOO_HIGH ({vix:.1f})",
                "vix": vix, "sentiment": "PANIC", "macro_event": False,
            }

        macro     = self._macro_event_today()
        sentiment = self._get_premarket_sentiment(ticker)

        if macro:
            logger.info("[SentimentFilter] Macro event today — trade proceeds with caution flag")

        return {
            "trade":       True,
            "reason":      "ALL_FILTERS_PASS",
            "vix":         vix,
            "sentiment":   sentiment,
            "macro_event": macro,
        }

    def _get_vix(self) -> float | None:
        try:
            resp = requests.get(
                "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1m&range=1d",
                timeout=5, headers={"User-Agent": "Mozilla/5.0"},
            )
            closes = resp.json()["chart"]["result"][0]["indicators"]["quote"][0]["close"]
            return next((v for v in reversed(closes) if v is not None), None)
        except Exception:
            return None

    def _get_premarket_sentiment(self, ticker: str) -> str:
        try:
            resp = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1m&range=1d",
                timeout=5, headers={"User-Agent": "Mozilla/5.0"},
            )
            meta = resp.json()["chart"]["result"][0]["meta"]
            gap  = (meta["regularMarketPrice"] - meta["chartPreviousClose"]) / meta["chartPreviousClose"]
            if gap > 0.005:
                return "BULLISH_BIAS"
            if gap < -0.005:
                return "BEARISH_BIAS"
            return "NEUTRAL"
        except Exception:
            return "NEUTRAL"

    def _macro_event_today(self) -> bool:
        """
        Check Finnhub economic calendar for high-impact US macro events scheduled today.
        Uses the finnhub-python library (FINNHUB_API_KEY env var required).
        Fails open (returns False) so a missing key never blocks trading.
        """
        client = _get_finnhub_client()
        if client is None:
            return False
        try:
            today_str = date.today().isoformat()
            result    = client.economic_calendar()
            for event in result.get("economicCalendar", []):
                if event.get("country", "").upper() != "US":
                    continue
                # Finnhub time format: "YYYY-MM-DD HH:MM:SS"
                if not event.get("time", "").startswith(today_str):
                    continue
                if event.get("impact", 0) < 3:
                    continue
                if any(kw.lower() in event.get("event", "").lower() for kw in MACRO_KEYWORDS):
                    logger.info("[SentimentFilter] Macro event detected: %s", event.get("event"))
                    return True
            return False
        except Exception as exc:
            logger.debug("[SentimentFilter] macro_event_today failed: %s", exc)
            return False
