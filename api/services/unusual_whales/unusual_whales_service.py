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

    def _normalize(self, alert: dict) -> dict:
        """
        Map UW's actual field names to the FlowAlert interface the app expects.
        UW uses 'type', 'has_sweep', 'has_floor', 'total_premium', etc.
        All original fields are preserved; mapped keys are added/overwritten.
        """
        ask_prem = float(alert.get("total_ask_side_prem") or 0)
        bid_prem = float(alert.get("total_bid_side_prem") or 0)
        return {
            **alert,
            "contract_type":      alert.get("type", ""),
            "is_sweep":           bool(alert.get("has_sweep", False)),
            "is_floor":           bool(alert.get("has_floor", False)),
            "is_multileg":        bool(alert.get("has_multileg", False)),
            "size":               int(alert.get("total_size") or 0),
            "premium":            str(alert.get("total_premium") or "0"),
            "implied_volatility": str(alert.get("iv_end") or alert.get("iv_start") or "0"),
            "side":               "ask" if ask_prem > bid_prem else "bid",
            "timestamp":          alert.get("created_at", ""),
            "unusual_score":      str(alert.get("unusual_score") or "0"),
            "tags":               alert.get("tags") or [],
        }

    def get_flow_alerts(self, limit: int = 50) -> list:
        """Return global option flow alerts ordered by premium descending."""
        if not self._available():
            return []
        try:
            url = f"{self.base_url}/api/option-trades/flow-alerts"
            resp = self.session.get(url, headers=self._headers(), params={"limit": limit}, timeout=10)
            resp.raise_for_status()
            raw = resp.json()
            return [self._normalize(a) for a in raw.get("data", [])]
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
            return [self._normalize(a) for a in raw.get("data", [])]
        except Exception as exc:
            logger.error("[UnusualWhales] get_ticker_flow_alerts(%s) error: %s", ticker, exc)
            return []


def get_unusual_whales_service() -> UnusualWhalesService:
    global _service_instance
    if _service_instance is None:
        _service_instance = UnusualWhalesService()
    return _service_instance
