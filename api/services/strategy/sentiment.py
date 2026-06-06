"""
Four-layer sentiment filter stack.

VIX ceiling is injected from the active profile so WOLF (25) and
BULL DOG (35) have different tolerances.
"""

import requests

VIX_MIN = 13.0

MACRO_KEYWORDS = [
    "FOMC", "Federal Reserve", "CPI", "PPI", "NFP", "Nonfarm",
    "GDP", "PCE", "Interest Rate Decision", "Jobs Report",
]


class SentimentFilter:

    def check_all(self, ticker: str, vix_max: float = 30.0) -> dict:
        vix = self._get_vix()

        if vix and vix < VIX_MIN:
            return {"trade": False, "reason": f"VIX_TOO_LOW ({vix:.1f})", "vix": vix, "sentiment": "CALM"}

        if vix and vix > vix_max:
            return {"trade": False, "reason": f"VIX_TOO_HIGH ({vix:.1f})", "vix": vix, "sentiment": "PANIC"}

        if self._macro_event_today():
            return {"trade": False, "reason": "MACRO_EVENT", "vix": vix, "sentiment": "MACRO_RISK"}

        sentiment = self._get_premarket_sentiment(ticker)
        return {"trade": True, "reason": "ALL_FILTERS_PASS", "vix": vix, "sentiment": sentiment}

    def confirm_with_flow(self, ticker: str, direction: str,
                          unusual_whales_key: str = None) -> bool:
        """
        Cross-checks trade direction against recent Unusual Whales options flow.
        Returns True (allow trade) if flow supports direction or if data unavailable.
        """
        if not unusual_whales_key:
            return True
        try:
            url = "https://api.unusualwhales.com/api/option-contracts/flow"
            headers = {"Authorization": f"Bearer {unusual_whales_key}"}
            params = {"ticker": ticker, "limit": 50}
            resp = requests.get(url, headers=headers, params=params, timeout=5)
            if resp.status_code != 200:
                return True
            data = resp.json().get("data", [])
            call_p = sum(float(c.get("premium", 0)) for c in data if c.get("type") == "call")
            put_p  = sum(float(c.get("premium", 0)) for c in data if c.get("type") == "put")
            total  = call_p + put_p
            if total == 0:
                return True
            call_pct = call_p / total
            if direction == "CALL" and call_pct < 0.35:
                return False
            if direction == "PUT"  and call_pct > 0.65:
                return False
            return True
        except Exception:
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
        Checks TradingEconomics calendar for high-importance US macro events today.
        Fails open (returns False) so a missing API key never blocks trading.
        """
        try:
            from datetime import date
            today_str = date.today().isoformat()
            resp = requests.get(
                f"https://api.tradingeconomics.com/calendar/country/united states/date/{today_str}",
                timeout=5,
            )
            if resp.status_code != 200:
                return False
            for event in resp.json():
                if event.get("Importance", 0) >= 3:
                    if any(kw.lower() in event.get("Event", "").lower() for kw in MACRO_KEYWORDS):
                        return True
            return False
        except Exception:
            return False
