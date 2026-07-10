"""
Four-layer sentiment filter stack.

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
from datetime import date, timezone
import pytz

_ET_TZ = pytz.timezone("America/New_York")

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

    def confirm_with_flow(self, ticker: str, direction: str,
                          unusual_whales_key: str = None) -> bool:
        """
        Cross-check trade direction against recent Unusual Whales options flow,
        weighting each alert by expiry proximity, recency, and aggression so that
        0DTE sweeps in the last 30 minutes carry far more signal than a week-out
        floor print from 2 hours ago.

        Weight formula per alert:
            weighted_premium = raw_premium × expiry_weight × recency_weight × aggression_weight

        Expiry weights  — closer expiry = more relevant to today's move:
            0DTE (today)            3.0×
            1–4 days                1.5×
            5–30 days               0.75×
            > 30 days               0.25×

        Recency weights — more recent = more actionable:
            ≤ 30 min                3.0×
            30–60 min               2.0×
            1–2 h                   1.0×
            2–4 h                   0.5×
            > 4 h                   0.25×

        Aggression weights — ask-side aggressive buys carry more conviction:
            ask side                1.5×
            bid side                1.0×

        Policy — FAILS OPEN. Only a successful read with a non-zero weighted total
        that genuinely contradicts the direction blocks the trade (returns False).
        Any availability problem or empty data allows the trade (returns True).

        Thresholds: CALL blocked when weighted call share < 35%;
                    PUT  blocked when weighted call share > 65%.
        """
        if not unusual_whales_key:
            logger.info("[SentimentFilter] Flow check bypassed for %s %s — no Unusual Whales key",
                        ticker, direction)
            return True
        try:
            from datetime import datetime
            from services.unusual_whales.unusual_whales_service import get_unusual_whales_service

            data = get_unusual_whales_service().get_ticker_flow_alerts(ticker, limit=50)
            if not data:
                logger.info("[SentimentFilter] Flow check bypassed for %s %s — no flow data",
                            ticker, direction)
                return True

            now_utc   = datetime.now(timezone.utc)
            today_str = now_utc.astimezone(_ET_TZ).strftime("%Y-%m-%d")

            call_w = 0.0
            put_w  = 0.0

            for alert in data:
                raw_premium = float(alert.get("premium") or 0)
                if raw_premium <= 0:
                    continue

                # ── Expiry weight ────────────────────────────────────────────────
                expiry_str = alert.get("expiry", "")
                try:
                    exp_date = datetime.strptime(expiry_str, "%Y-%m-%d").date()
                    today    = datetime.strptime(today_str, "%Y-%m-%d").date()
                    days_out = (exp_date - today).days
                except Exception:
                    days_out = 999  # treat unknown as far-dated
                if days_out <= 0:
                    expiry_w = 3.0
                elif days_out <= 4:
                    expiry_w = 1.5
                elif days_out <= 30:
                    expiry_w = 0.75
                else:
                    expiry_w = 0.25

                # ── Recency weight ───────────────────────────────────────────────
                ts_str = alert.get("timestamp", "")
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    age_min = (now_utc - ts).total_seconds() / 60
                except Exception:
                    age_min = 999
                if age_min <= 30:
                    recency_w = 3.0
                elif age_min <= 60:
                    recency_w = 2.0
                elif age_min <= 120:
                    recency_w = 1.0
                elif age_min <= 240:
                    recency_w = 0.5
                else:
                    recency_w = 0.25

                # ── Aggression weight ────────────────────────────────────────────
                aggression_w = 1.5 if alert.get("side") == "ask" else 1.0

                weighted = raw_premium * expiry_w * recency_w * aggression_w

                if alert.get("contract_type") == "call":
                    call_w += weighted
                else:
                    put_w += weighted

            total = call_w + put_w
            if total == 0:
                logger.info("[SentimentFilter] Flow check bypassed for %s %s — weighted total is zero",
                            ticker, direction)
                return True

            call_pct = call_w / total
            logger.info(
                "[SentimentFilter] %s weighted flow — call %.0f%% put %.0f%% "
                "(raw alerts=%d, weighted_total=%.0f)",
                ticker, call_pct * 100, (1 - call_pct) * 100, len(data), total,
            )

            if direction == "CALL" and call_pct < 0.35:
                logger.info("[SentimentFilter] Flow BLOCKS %s CALL — weighted call share %.0f%% < 35%%",
                            ticker, call_pct * 100)
                return False
            if direction == "PUT" and call_pct > 0.65:
                logger.info("[SentimentFilter] Flow BLOCKS %s PUT — weighted call share %.0f%% > 65%%",
                            ticker, call_pct * 100)
                return False

            logger.info("[SentimentFilter] Flow confirms %s %s — weighted call share %.0f%%",
                        ticker, direction, call_pct * 100)
            return True

        except Exception as exc:
            logger.warning("[SentimentFilter] Flow check bypassed for %s %s — %s",
                           ticker, direction, exc)
            return True

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
