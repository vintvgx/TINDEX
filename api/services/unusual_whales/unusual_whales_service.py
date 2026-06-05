import os
import requests
from log.logging_config import get_logger

logger = get_logger(__name__)

UNUSUAL_WHALES_BASE_URL = "https://api.unusualwhales.com"

_service_instance = None


class UnusualWhalesService:
    def __init__(self):
        self.api_key = os.environ.get("UNUSUAL_WHALES_API_KEY", "")
        self.base_url = UNUSUAL_WHALES_BASE_URL
        self.session = requests.Session()
        if not self.api_key:
            logger.warning("[UnusualWhales] UNUSUAL_WHALES_API_KEY not set — flow endpoints will return empty data")

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }

    def _available(self) -> bool:
        return bool(self.api_key)

    def get_flow_alerts(self, limit: int = 50) -> list:
        """Return global option flow alerts ordered by premium descending."""
        if not self._available():
            return []
        try:
            url = f"{self.base_url}/api/option-trades/flow-alerts"
            resp = self.session.get(url, headers=self._headers(), params={"limit": limit}, timeout=10)
            resp.raise_for_status()
            raw = resp.json()
            return raw.get("data", [])
        except Exception as exc:
            logger.error("[UnusualWhales] get_flow_alerts error: %s", exc)
            return []

    def get_ticker_flow_alerts(self, ticker: str, limit: int = 50) -> list:
        """Return flow alerts for a specific ticker."""
        if not self._available():
            return []
        try:
            url = f"{self.base_url}/api/stock/{ticker.upper()}/flow-alerts"
            resp = self.session.get(url, headers=self._headers(), params={"limit": limit}, timeout=10)
            resp.raise_for_status()
            raw = resp.json()
            return raw.get("data", [])
        except Exception as exc:
            logger.error("[UnusualWhales] get_ticker_flow_alerts(%s) error: %s", ticker, exc)
            return []


def get_unusual_whales_service() -> UnusualWhalesService:
    global _service_instance
    if _service_instance is None:
        _service_instance = UnusualWhalesService()
    return _service_instance
