"""
Options Contract Price Monitor Service

Polls Alpaca every 5 minutes during market hours for all actively tracked
options contracts. Updates current_price and price_change_pct in Supabase.
Sends Expo push notifications when price crosses ±25%, ±50%, or ±100%
thresholds from tracked_entry_price.

Notification rules:
  - Each threshold fires at most once per contract (flag is latched TRUE).
  - When multiple thresholds cross in the same poll, only the highest-magnitude
    one is sent to avoid notification spam.
  - 100% is the ceiling label ("100%+" shown in the notification).
"""

import asyncio
import os
import logging
import aiohttp
import pytz
from datetime import datetime, time
from typing import Dict, List, Optional, Tuple

from supabase import create_client, Client

logger = logging.getLogger(__name__)

# (threshold_pct, direction, db_flag_column)
# Ordered highest-magnitude first so we can find the most significant crossing.
THRESHOLDS: List[Tuple[float, str, str]] = [
    ( 100.0, "gain", "notified_gain_100"),
    (  50.0, "gain", "notified_gain_50"),
    (  25.0, "gain", "notified_gain_25"),
    ( -25.0, "loss", "notified_loss_25"),
    ( -50.0, "loss", "notified_loss_50"),
    (-100.0, "loss", "notified_loss_100"),
]

POLL_INTERVAL_SECONDS = 300  # 5 minutes


class OptionsContractMonitorService:
    """
    Background polling service for tracked options contract prices.

    Lifecycle mirrors OrbService: call start() in a background thread's
    event loop; call stop() to shut down cleanly.
    """

    def __init__(self):
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")

        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)
        self.expo_push_url = "https://exp.host/--/api/v2/push/send"
        self.et_timezone = pytz.timezone("America/New_York")
        self.is_running = False

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self):
        logger.info("OptionsContractMonitor: started")
        self.is_running = True
        try:
            while self.is_running:
                if self._is_market_hours():
                    await self._poll_cycle()
                else:
                    logger.info("OptionsContractMonitor: outside market hours, skipping poll")
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            pass
        finally:
            self.is_running = False
            logger.info("OptionsContractMonitor: stopped")

    async def stop(self):
        self.is_running = False

    # ── Market hours ─────────────────────────────────────────────────────────

    def _is_market_hours(self) -> bool:
        now = datetime.now(self.et_timezone)
        if now.weekday() >= 5:  # Saturday / Sunday
            return False
        t = now.time()
        return time(9, 30) <= t <= time(16, 0)

    # ── Poll cycle ───────────────────────────────────────────────────────────

    async def _poll_cycle(self):
        # Contract list is fetched fresh from Supabase every cycle.
        # This means any contract a user starts or stops tracking takes effect
        # within one poll interval (5 minutes) with no service restart needed.
        try:
            contracts = await self._load_active_contracts()
            if not contracts:
                logger.info("OptionsContractMonitor: no active contracts to poll")
                return

            logger.info(f"OptionsContractMonitor: polling {len(contracts)} contracts")

            from services.alpaca.alpaca_option_service import get_alpaca_option_service
            option_service = get_alpaca_option_service()

            symbols = [c["contract_symbol"] for c in contracts]
            prices = await option_service.get_contract_prices_batch(symbols)

            checked_at = datetime.now(self.et_timezone).isoformat()

            for contract in contracts:
                symbol = contract["contract_symbol"]
                current_price = prices.get(symbol)
                if current_price is None:
                    logger.debug(f"OptionsContractMonitor: no price for {symbol}")
                    continue

                tracked_entry = float(contract.get("tracked_entry_price") or 0)
                if tracked_entry <= 0:
                    continue

                pct_change = ((current_price - tracked_entry) / tracked_entry) * 100.0

                await self._update_contract_price(
                    contract_id=contract["id"],
                    current_price=current_price,
                    pct_change=pct_change,
                    checked_at=checked_at,
                )

                await self._check_and_notify(contract, current_price, pct_change)

        except Exception as e:
            logger.error(f"OptionsContractMonitor: poll cycle error: {e}", exc_info=True)

    # ── Database helpers ─────────────────────────────────────────────────────

    async def _load_active_contracts(self) -> List[Dict]:
        loop = asyncio.get_event_loop()

        def fetch():
            return (
                self.supabase
                .table("tracked_options_contracts")
                .select(
                    "id, user_id, contract_symbol, ticker, option_type, strike, "
                    "tracked_entry_price, "
                    "notified_gain_25, notified_loss_25, "
                    "notified_gain_50, notified_loss_50, "
                    "notified_gain_100, notified_loss_100"
                )
                .eq("status", "tracking")
                .not_.is_("tracked_entry_price", "null")
                .execute()
            )

        result = await loop.run_in_executor(None, fetch)
        return result.data or []

    async def _update_contract_price(
        self,
        contract_id: str,
        current_price: float,
        pct_change: float,
        checked_at: str,
    ):
        loop = asyncio.get_event_loop()

        def update():
            self.supabase.table("tracked_options_contracts").update({
                "current_price": round(current_price, 4),
                "price_change_pct": round(pct_change, 4),
                "last_price_check_at": checked_at,
            }).eq("id", contract_id).execute()

        await loop.run_in_executor(None, update)

    # ── Threshold logic & notifications ──────────────────────────────────────

    async def _check_and_notify(
        self,
        contract: Dict,
        current_price: float,
        pct_change: float,
    ):
        newly_crossed: List[Tuple[float, str, str]] = []

        for threshold_pct, direction, flag_col in THRESHOLDS:
            if contract.get(flag_col, False):
                continue  # already notified for this threshold
            if direction == "gain" and pct_change >= threshold_pct:
                newly_crossed.append((threshold_pct, direction, flag_col))
            elif direction == "loss" and pct_change <= threshold_pct:
                newly_crossed.append((threshold_pct, direction, flag_col))

        if not newly_crossed:
            return

        # Notify only for the highest-magnitude threshold hit in this cycle
        highest = max(newly_crossed, key=lambda x: abs(x[0]))
        threshold_pct, direction, _ = highest

        expo_token = await self._get_user_push_token(contract["user_id"])
        if expo_token:
            await self._send_price_alert(
                expo_token=expo_token,
                contract=contract,
                current_price=current_price,
                pct_change=pct_change,
                threshold_pct=threshold_pct,
                direction=direction,
            )

        # Latch all newly-crossed flags so we don't re-fire
        flag_updates = {flag_col: True for _, _, flag_col in newly_crossed}
        loop = asyncio.get_event_loop()

        def set_flags():
            self.supabase.table("tracked_options_contracts").update(
                flag_updates
            ).eq("id", contract["id"]).execute()

        await loop.run_in_executor(None, set_flags)

    async def _get_user_push_token(self, user_id: str) -> Optional[str]:
        loop = asyncio.get_event_loop()

        def fetch():
            return (
                self.supabase
                .table("user_profiles")
                .select("expo_push_token, notification_preferences")
                .eq("id", user_id)
                .single()
                .execute()
            )

        try:
            result = await loop.run_in_executor(None, fetch)
            profile = result.data
            if not profile:
                return None
            prefs = profile.get("notification_preferences") or {}
            if not prefs.get("enabled", True):
                return None
            token = profile.get("expo_push_token")
            return token if token and token != "null" else None
        except Exception as e:
            logger.warning(f"OptionsContractMonitor: could not fetch token for {user_id}: {e}")
            return None

    async def _send_price_alert(
        self,
        expo_token: str,
        contract: Dict,
        current_price: float,
        pct_change: float,
        threshold_pct: float,
        direction: str,
    ):
        symbol = contract["contract_symbol"]
        ticker = contract["ticker"]
        option_type = contract["option_type"]
        strike = contract["strike"]

        is_gain = direction == "gain"
        emoji = "📈" if is_gain else "📉"
        direction_word = "gained" if is_gain else "dropped"

        # Label caps at "100%+" for the ±100 threshold
        abs_thresh = abs(threshold_pct)
        label = "100%+" if abs_thresh >= 100 else f"{abs_thresh:.0f}%"

        title = f"{emoji} {ticker} {option_type} ${float(strike):.2f} — {label} {'gain' if is_gain else 'loss'}"
        body = (
            f"{symbol} has {direction_word} {abs(pct_change):.1f}% since tracked. "
            f"Now: ${current_price:.2f}"
        )

        message = {
            "to": expo_token,
            "sound": "default",
            "title": title,
            "body": body,
            "data": {
                "type": "contract_price_alert",
                "contract_symbol": symbol,
                "ticker": ticker,
                "option_type": option_type,
                "current_price": round(current_price, 4),
                "pct_change": round(pct_change, 2),
                "threshold_pct": threshold_pct,
                "direction": direction,
                "screen": "options",
            },
            "badge": 1,
            "priority": "high",
            "channelId": "contract-alerts",
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.expo_push_url,
                    json=message,
                    headers={
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip, deflate",
                        "Content-Type": "application/json",
                    },
                ) as resp:
                    if resp.status != 200:
                        text = await resp.text()
                        logger.error(f"OptionsContractMonitor: Expo push failed for {symbol}: {text}")
                    else:
                        logger.info(
                            f"OptionsContractMonitor: alert sent — {symbol} "
                            f"{pct_change:+.1f}% (threshold {threshold_pct:+.0f}%)"
                        )
        except Exception as e:
            logger.error(f"OptionsContractMonitor: failed to send alert for {symbol}: {e}")


# ── Singleton ────────────────────────────────────────────────────────────────

_monitor_instance: Optional[OptionsContractMonitorService] = None


def get_options_contract_monitor() -> OptionsContractMonitorService:
    global _monitor_instance
    if _monitor_instance is None:
        _monitor_instance = OptionsContractMonitorService()
        logger.info("OptionsContractMonitorService initialized")
    return _monitor_instance


def reset_options_contract_monitor():
    global _monitor_instance
    _monitor_instance = None
    logger.info("OptionsContractMonitorService reset")
