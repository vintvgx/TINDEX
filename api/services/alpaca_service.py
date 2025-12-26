import asyncio
from decimal import Decimal
import os
from typing import Dict, Set, Optional
import pytz
from datetime import datetime, time, timedelta
import logging
import aiohttp

from supabase import create_client, Client

from alpaca.data.live import StockDataStream, OptionDataStream
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame
from alpaca.data.enums import DataFeed
from alpaca.data.models import Bar

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AlpacaService:
    """
    Service class for managing Alpaca API requests with streaming support.

    This service provides:
    ├── Subscribes to user-followed stocks
    ├── Calculates ORB ranges (9:30-9:45) via real-time OR historical data
    ├── Monitors breakouts in real-time
    └── Triggers notifications directly
    """

    def __init__(self):
        """Initialize Alpaca client with environment variables"""
        self.alpaca_api_key = os.getenv("ALPACA_API_KEY")
        self.alpaca_secret_key = os.getenv("ALPACA_SECRET_KEY")

        if not self.alpaca_api_key:
            raise ValueError("ALPACA_API_KEY not defined")

        if not self.alpaca_secret_key:
            raise ValueError("ALPACA_SECRET_KEY not defined")

        # Supabase setup
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_ANON_KEY")

        if not self.supabase_url or not self.supabase_key:
            raise ValueError("Supabase credentials not defined")

        # Initialize supabase
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)

        # Initialize historical data client for fetching ORB ranges
        self.historical_client = StockHistoricalDataClient(
            self.alpaca_api_key,
            self.alpaca_secret_key
        )

        # Market timezone
        self.et_timezone = pytz.timezone("America/New_York")

        # ORB tracking
        self.orb_ranges: Dict[str, Dict] = {}
        self.monitoring_state: Dict[str, Dict] = {}
        self.active_tickers: Set[str] = set()
        self.subscribed_tickers: Set[str] = set()

        # Market hours
        self.market_open = time(9, 30)
        self.orb_end = time(9, 45)
        self.market_close = time(16, 0)

        # Service state
        self.is_running = False
        self.calculation_phase = False
        self._stream_task: Optional[asyncio.Task] = None
        self._stream_started = False
        self._debug_mode = False
        self._bars_received_count = 0

        # Stream will be created fresh when needed
        self.stock_stream: Optional[StockDataStream] = None
        self.option_stream: Optional[OptionDataStream] = None

        # Expo push URL
        self.expo_push_url = "https://exp.host/--/api/v2/push/send"

    def _create_stock_stream(self):
        """Create a fresh stock stream instance with handlers"""
        self.stock_stream = StockDataStream(
            self.alpaca_api_key,
            self.alpaca_secret_key,
            feed=DataFeed.IEX
        )
        logger.info("Created new StockDataStream instance")

    def get_current_et_time(self) -> datetime:
        """Get current time in ET timezone"""
        return datetime.now(self.et_timezone)

    def is_market_hours(self) -> bool:
        """Check if currently in market hours"""
        now = self.get_current_et_time()
        current_time = now.time()

        # Skip weekends
        if now.weekday() >= 5:
            return False

        return self.market_open <= current_time <= self.market_close

    def is_orb_calculation_period(self) -> bool:
        """Check if in ORB calculation period (9:30-9:45 AM)"""
        now = self.get_current_et_time()
        current_time = now.time()
        return self.market_open <= current_time <= self.orb_end

    async def load_followed_stocks(self) -> Set[str]:
        """Load all ORB-enabled stocks from database"""
        try:
            response = (
                self.supabase.table("user_stock_follows")
                .select("ticker")
                .eq("orb_enabled", True)
                .execute()
            )

            tickers = {row["ticker"] for row in response.data}
            logger.info(f"Loaded {len(tickers)} tickers for ORB monitoring: {list(tickers)}")
            return tickers
        except Exception as e:
            logger.error(f"Error loading followed stocks: {e}")
            return set()

    async def fetch_orb_range_historical(self, ticker: str) -> Optional[Dict]:
        """
        Fetch ORB range using historical data (9:30-9:45 AM window).
        
        This is the RELIABLE method - works even if service starts late.
        Uses Alpaca's REST API to get minute bars for the ORB window.
        """
        try:
            today = self.get_current_et_time().date()

            # Define the ORB window in ET timezone
            orb_start = self.et_timezone.localize(
                datetime.combine(today, self.market_open)
            )
            orb_end = self.et_timezone.localize(
                datetime.combine(today, self.orb_end)
            )

            logger.info(f"Fetching historical bars for {ticker}: {orb_start} to {orb_end}")

            request = StockBarsRequest(
                symbol_or_symbols=ticker,
                timeframe=TimeFrame.Minute,
                start=orb_start,
                end=orb_end,
                feed=DataFeed.IEX
            )

            # This is a sync call, run in executor to not block
            loop = asyncio.get_event_loop()
            bars = await loop.run_in_executor(
                None,
                lambda: self.historical_client.get_stock_bars(request)
            )

            if not bars or ticker not in bars:
                logger.warning(f"No historical bars found for {ticker} in ORB window")
                return None

            ticker_bars = bars[ticker]
            if not ticker_bars:
                logger.warning(f"Empty bar list for {ticker}")
                return None

            # Calculate ORB from historical bars
            # Use the actual high/low from each bar, not just close prices
            highs = [Decimal(str(bar.high)) for bar in ticker_bars]
            lows = [Decimal(str(bar.low)) for bar in ticker_bars]
            volumes = [bar.volume for bar in ticker_bars]

            orb_high = max(highs)
            orb_low = min(lows)
            opening_price = Decimal(str(ticker_bars[0].open))
            total_volume = sum(volumes)

            orb_data = {
                "high": orb_high,
                "low": orb_low,
                "open": opening_price,
                "volume": total_volume
            }

            logger.info(
                f"[HISTORICAL ORB] {ticker}: "
                f"High={orb_high}, Low={orb_low}, Open={opening_price}, "
                f"Volume={total_volume}, Bars={len(ticker_bars)}"
            )

            return orb_data

        except Exception as e:
            logger.error(f"Error fetching historical ORB for {ticker}: {e}", exc_info=True)
            return None

    async def ensure_orb_ranges(self):
        """
        Ensure we have ORB ranges for all followed tickers.
        
        If we're past the ORB calculation period (9:45 AM) and don't have
        ranges in memory or database, fetch them historically.
        """
        current_time = self.get_current_et_time().time()

        # If still in calculation period, real-time streaming will handle it
        if self.is_orb_calculation_period():
            logger.info("Still in ORB calculation period, using real-time data")
            return

        # If before market open, nothing to do
        if current_time < self.market_open:
            logger.info("Before market open, no ORB ranges to fetch")
            return

        tickers = await self.load_followed_stocks()
        if not tickers:
            logger.warning("No tickers to ensure ORB ranges for")
            return

        logger.info(f"Ensuring ORB ranges for {len(tickers)} tickers...")

        for ticker in tickers:
            # Check if we already have it in memory
            if ticker in self.orb_ranges:
                logger.info(f"  {ticker}: Already in memory")
                continue

            # Check if it's in the database for today
            existing = await self._get_orb_range_from_db(ticker)
            if existing:
                self.orb_ranges[ticker] = existing
                logger.info(
                    f"  {ticker}: Loaded from DB - "
                    f"High={existing['high']}, Low={existing['low']}"
                )
                continue

            # Not in memory or DB - fetch historically
            logger.info(f"  {ticker}: Missing, fetching historically...")
            orb_data = await self.fetch_orb_range_historical(ticker)

            if orb_data:
                self.orb_ranges[ticker] = orb_data
                await self.save_orb_range(ticker, orb_data)
                logger.info(
                    f"  {ticker}: Fetched and saved - "
                    f"High={orb_data['high']}, Low={orb_data['low']}"
                )
            else:
                logger.warning(f"  {ticker}: Could not fetch ORB range")

        logger.info(f"ORB ranges ensured. Total in memory: {len(self.orb_ranges)}")

    async def _get_orb_range_from_db(self, ticker: str) -> Optional[Dict]:
        """Get ORB range from database for today"""
        try:
            trade_date = self.get_current_et_time().date()

            response = (
                self.supabase.table("orb_ranges")
                .select("*")
                .eq("ticker", ticker)
                .eq("trade_date", str(trade_date))
                .execute()
            )

            if response.data and len(response.data) > 0:
                row = response.data[0]
                return {
                    "high": Decimal(str(row["orb_high"])),
                    "low": Decimal(str(row["orb_low"])),
                    "open": Decimal(str(row.get("opening_price", 0))),
                    "volume": row.get("volume_in_range", 0)
                }

            return None

        except Exception as e:
            logger.error(f"Error getting ORB range from DB for {ticker}: {e}")
            return None

    async def save_orb_range(self, ticker: str, data: Dict):
        """
        Save calculated ORB range to database.
        
        Saves both the ORB range data and initializes the monitoring state.
        """
        try:
            trade_date = self.get_current_et_time().date()

            # Ensure we're saving Decimal values as floats
            orb_high = float(data["high"]) if isinstance(data["high"], Decimal) else data["high"]
            orb_low = float(data["low"]) if isinstance(data["low"], Decimal) else data["low"]
            opening_price = float(data.get("open", 0)) if isinstance(data.get("open", 0), Decimal) else data.get("open", 0)
            volume = int(data.get("volume", 0))

            # Validate the data
            if orb_high <= 0 or orb_low <= 0:
                logger.error(f"Invalid ORB data for {ticker}: high={orb_high}, low={orb_low}")
                return

            if orb_low > orb_high:
                logger.error(f"Invalid ORB data for {ticker}: low ({orb_low}) > high ({orb_high})")
                return

            orb_record = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "orb_high": orb_high,
                "orb_low": orb_low,
                "volume_in_range": volume,
                "opening_price": opening_price,
            }

            logger.info(f"[DB SAVE] Saving ORB range for {ticker}: {orb_record}")

            self.supabase.table("orb_ranges").upsert(orb_record).execute()

            # Initialize monitoring state
            state_record = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "last_price": orb_high,  # Initialize with high
                "high_broken": False,
                "low_broken": False,
                "monitoring_active": True,
            }

            self.supabase.table("orb_monitoring_state").upsert(state_record).execute()

            # Also update in-memory monitoring state
            self.monitoring_state[ticker] = {
                "high_broken": False,
                "low_broken": False
            }

            logger.info(
                f"[DB SAVE] Saved ORB range for {ticker}: "
                f"High={orb_high}, Low={orb_low}, Open={opening_price}, Volume={volume}"
            )

        except Exception as e:
            logger.error(f"Error saving ORB range for {ticker}: {e}", exc_info=True)

    async def load_orb_ranges(self):
        """Load today's ORB ranges from database into memory"""
        try:
            trade_date = self.get_current_et_time().date()

            response = (
                self.supabase.table("orb_ranges")
                .select("*")
                .eq("trade_date", str(trade_date))
                .execute()
            )

            for row in response.data:
                ticker = row["ticker"]
                self.orb_ranges[ticker] = {
                    "high": Decimal(str(row["orb_high"])),
                    "low": Decimal(str(row["orb_low"])),
                    "open": Decimal(str(row.get("opening_price", 0))),
                    "volume": row.get("volume_in_range", 0),
                }

            # Load monitoring state
            state_response = (
                self.supabase.table("orb_monitoring_state")
                .select("*")
                .eq("trade_date", str(trade_date))
                .eq("monitoring_active", True)
                .execute()
            )

            for row in state_response.data:
                ticker = row["ticker"]
                self.monitoring_state[ticker] = {
                    "high_broken": row["high_broken"],
                    "low_broken": row["low_broken"],
                }

            logger.info(
                f"Loaded {len(self.orb_ranges)} ORB ranges from DB. "
                f"Monitoring state for {len(self.monitoring_state)} tickers."
            )

            # Log each loaded range for debugging
            for ticker, data in self.orb_ranges.items():
                state = self.monitoring_state.get(ticker, {})
                logger.info(
                    f"  {ticker}: High={data['high']}, Low={data['low']}, "
                    f"HighBroken={state.get('high_broken', False)}, "
                    f"LowBroken={state.get('low_broken', False)}"
                )

        except Exception as e:
            logger.error(f"Error loading ORB ranges: {e}", exc_info=True)

    async def record_breakout(self, ticker: str, breakout_type: str, price: Decimal):
        """Record a breakout event and trigger notifications"""
        try:
            trade_date = self.get_current_et_time().date()
            orb_data = self.orb_ranges.get(ticker, {})

            # Convert Decimals to floats for JSON serialization
            breakout_price = float(price) if isinstance(price, Decimal) else price
            orb_high = float(orb_data.get("high", 0)) if isinstance(orb_data.get("high", 0), Decimal) else orb_data.get("high", 0)
            orb_low = float(orb_data.get("low", 0)) if isinstance(orb_data.get("low", 0), Decimal) else orb_data.get("low", 0)

            breakout_record = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "breakout_type": breakout_type,
                "breakout_price": breakout_price,
                "breakout_time": self.get_current_et_time().isoformat(),
                "orb_high": orb_high,
                "orb_low": orb_low,
            }

            logger.info(f"[DB SAVE] Recording breakout: {breakout_record}")

            self.supabase.table("orb_breakouts").insert(breakout_record).execute()

            # Update monitoring state in DB
            state_update = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "last_price": breakout_price,
            }

            if breakout_type == "above":
                state_update["high_broken"] = True
                self.monitoring_state[ticker]["high_broken"] = True
            else:
                state_update["low_broken"] = True
                self.monitoring_state[ticker]["low_broken"] = True

            self.supabase.table("orb_monitoring_state").upsert(state_update).execute()

            await self.send_notifications(ticker, breakout_type, price)

            logger.info(
                f"[BREAKOUT RECORDED] {ticker} broke {breakout_type} ORB at ${breakout_price:.2f} "
                f"(ORB High=${orb_high:.2f}, ORB Low=${orb_low:.2f})"
            )

        except Exception as e:
            logger.error(f"Error recording breakout for {ticker}: {e}", exc_info=True)

    async def send_notifications(self, ticker: str, breakout_type: str, price: Decimal):
        """Send push notifications to users following this stock with ORB enabled"""
        try:
            users_response = (
                self.supabase.table("user_stock_follows")
                .select("user_id")
                .eq("ticker", ticker)
                .eq("orb_enabled", True)
                .execute()
            )

            if not users_response.data:
                logger.info(f"No users following {ticker} with ORB enabled")
                return

            user_ids = [user['user_id'] for user in users_response.data]

            profiles_response = (
                self.supabase.table("user_profiles")
                .select("id, expo_push_token, notification_preferences")
                .in_("id", user_ids)
                .not_("expo_push_token", "is", None)
                .execute()
            )

            if not profiles_response.data:
                logger.info(f"No users with push tokens for {ticker}")
                return

            eligible_users = [
                user for user in profiles_response.data
                if user.get("notification_preferences", {}).get("enabled", False)
                and user.get("notification_preferences", {}).get("orb_alerts", True)
            ]

            if not eligible_users:
                logger.info(f"No eligible users for {ticker} ORB notification")
                return

            notification_tasks = []
            for user in eligible_users:
                message_title = f"🚨 ORB Alert: {ticker}"
                direction = "above ORB high" if breakout_type == "above" else "below ORB low"
                price_float = float(price) if isinstance(price, Decimal) else price
                message_body = f"{ticker} broke {direction} at ${price_float:.2f}"

                message = {
                    "sound": "default",
                    "title": message_title,
                    "body": message_body,
                    "data": {
                        "type": "orb_breakout",
                        "ticker": ticker,
                        "breakout_type": breakout_type,
                        "price": price_float,
                        "screen": "ticker",
                        "timestamp": self.get_current_et_time().isoformat()
                    },
                    "badge": 1,
                    "priority": "high",
                    "channelId": "orb-alerts",
                }

                task = self._send_push_notification(
                    user=user,
                    message=message,
                    ticker=ticker,
                    breakout_type=breakout_type,
                    price=price
                )
                notification_tasks.append(task)

            results = await asyncio.gather(*notification_tasks, return_exceptions=True)

            successful = sum(1 for r in results if r is True)
            failed = len(results) - successful

            logger.info(
                f"ORB notifications sent for {ticker}: "
                f"{successful} successful, {failed} failed"
            )

        except Exception as e:
            logger.error(f"Error sending notifications for {ticker}: {e}")

    async def _send_push_notification(
        self,
        user: Dict,
        message: Dict,
        ticker: Optional[str] = None,
        breakout_type: Optional[str] = None,
        price: Optional[Decimal] = None
    ) -> bool:
        """Send individual push notification via Expo"""
        try:
            expo_token = user.get("expo_push_token")
            if not expo_token:
                return False

            # Set recipient
            message["to"] = expo_token

            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.expo_push_url,
                    json=message,
                    headers={
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip, deflate",
                        "Content-Type": "application/json",
                    }
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Expo push failed for user {user['id']}: {error_text}")
                        return False

                    receipt = await response.json()
                    if receipt.get("data", {}).get("status") == "error":
                        logger.error(f"Expo error for user {user['id']}: {receipt}")
                        return False

            await self._save_notification_record(
                user_id=user['id'],
                message=message,
                ticker=ticker,
                breakout_type=breakout_type,
                price=price
            )

            return True

        except Exception as e:
            logger.error(f"Failed to send push to user {user.get('id')}: {e}")
            return False

    async def _save_notification_record(
        self,
        user_id: str,
        message: Dict,
        ticker: Optional[str] = None,
        breakout_type: Optional[str] = None,
        price: Optional[Decimal] = None
    ):
        """Save notification record to database for UI display"""
        try:
            notification_data = {
                "screen": message.get("data", {}).get("screen", "home"),
                "sentAt": self.get_current_et_time().isoformat()
            }

            if ticker:
                notification_data["ticker"] = ticker
            if breakout_type:
                notification_data["breakout_type"] = breakout_type
            if price is not None:
                notification_data["price"] = float(price) if isinstance(price, Decimal) else price

            if "data" in message:
                notification_data.update(message["data"])

            notification_record = {
                "user_id": user_id,
                "title": message["title"],
                "body": message["body"],
                "type": message.get("data", {}).get("type", "orb_breakout"),
                "data": notification_data,
                "read": False,
                "expires_at": (
                    datetime.now() + timedelta(days=7)
                ).isoformat()
            }

            self.supabase.table("notifications").insert(notification_record).execute()
            logger.info(f"Saved notification record for user {user_id}")

        except Exception as e:
            logger.error(f"Failed to save notification record: {e}")

    async def _get_all_orb_users(self) -> list:
        """Get all unique users who have ORB enabled for any ticker"""
        try:
            response = (
                self.supabase.table("user_stock_follows")
                .select("user_id")
                .eq("orb_enabled", True)
                .execute()
            )

            if not response.data:
                return []

            user_ids = list(set([row["user_id"] for row in response.data]))

            profiles_response = (
                self.supabase.table("user_profiles")
                .select("id, expo_push_token, notification_preferences")
                .in_("id", user_ids)
                .not_("expo_push_token", "is", None)
                .execute()
            )

            if not profiles_response.data:
                return []

            eligible_users = [
                user for user in profiles_response.data
                if user.get("notification_preferences", {}).get("enabled", False)
                and user.get("notification_preferences", {}).get("orb_alerts", True)
            ]

            return eligible_users

        except Exception as e:
            logger.error(f"Error getting ORB users: {e}")
            return []

    async def send_service_status_notification(self, status: str):
        """Send push notifications to all ORB users about service status"""
        try:
            if status not in ["started", "stopped"]:
                logger.error(f"Invalid service status: {status}")
                return

            users = await self._get_all_orb_users()

            if not users:
                logger.info(f"No eligible users for service {status} notification")
                return

            if status == "started":
                title = "✅ ORB Service Started"
                body = "ORB monitoring service is now active and monitoring your followed stocks."
            else:
                title = "⏸️ ORB Service Stopped"
                body = "ORB monitoring service has stopped."

            message = {
                "sound": "default",
                "title": title,
                "body": body,
                "data": {
                    "type": "service_status",
                    "status": status,
                    "screen": "home",
                    "timestamp": self.get_current_et_time().isoformat()
                },
                "badge": 1,
                "priority": "normal",
                "channelId": "orb-alerts",
            }

            notification_tasks = []
            for user in users:
                task = self._send_push_notification(
                    user=user,
                    message=message
                )
                notification_tasks.append(task)

            results = await asyncio.gather(*notification_tasks, return_exceptions=True)

            successful = sum(1 for r in results if r is True)
            failed = len(results) - successful

            logger.info(
                f"Service {status} notifications sent: "
                f"{successful} successful, {failed} failed"
            )

        except Exception as e:
            logger.error(f"Error sending service status notifications: {e}")

    async def handle_bar(self, data: Bar):
        """Handle incoming bar data from Alpaca stream"""
        ticker = data.symbol
        
        # Use the BAR's high and low, not just close!
        bar_high = Decimal(str(data.high))
        bar_low = Decimal(str(data.low))
        bar_close = Decimal(str(data.close))
        bar_open = Decimal(str(data.open))

        # Debug: Log bar received
        self._bars_received_count += 1
        if self._bars_received_count <= 5 or self._bars_received_count % 10 == 0:
            logger.info(
                f"[BAR #{self._bars_received_count}] {ticker}: "
                f"O={data.open} H={data.high} L={data.low} C={data.close} V={data.volume}"
            )

        if self.calculation_phase:
            # During ORB calculation, track the TRUE high and low from bar data
            if ticker not in self.orb_ranges:
                self.orb_ranges[ticker] = {
                    "high": bar_high,
                    "low": bar_low,
                    "open": bar_open,  # First bar's open is the opening price
                    "volume": data.volume,
                }
                logger.info(
                    f"[ORB CALC] Started tracking {ticker}: "
                    f"High={bar_high}, Low={bar_low}, Open={bar_open}"
                )
            else:
                old_high = self.orb_ranges[ticker]["high"]
                old_low = self.orb_ranges[ticker]["low"]
                
                # Update with bar's high/low, not just close
                self.orb_ranges[ticker]["high"] = max(old_high, bar_high)
                self.orb_ranges[ticker]["low"] = min(old_low, bar_low)
                self.orb_ranges[ticker]["volume"] += data.volume

                # Log if high/low changed
                if self.orb_ranges[ticker]["high"] != old_high:
                    logger.info(
                        f"[ORB CALC] {ticker} new HIGH: {self.orb_ranges[ticker]['high']} "
                        f"(bar high was {bar_high})"
                    )
                if self.orb_ranges[ticker]["low"] != old_low:
                    logger.info(
                        f"[ORB CALC] {ticker} new LOW: {self.orb_ranges[ticker]['low']} "
                        f"(bar low was {bar_low})"
                    )
        else:
            # Monitoring phase - check for breakouts using current price (close)
            if ticker not in self.orb_ranges:
                return

            orb_high = self.orb_ranges[ticker]["high"]
            orb_low = self.orb_ranges[ticker]["low"]
            
            # Ensure monitoring state exists
            if ticker not in self.monitoring_state:
                self.monitoring_state[ticker] = {"high_broken": False, "low_broken": False}
            
            state = self.monitoring_state[ticker]

            # Check breakouts - use bar_high for upper breakout, bar_low for lower
            # This catches intrabar breakouts, not just close-based
            if not state["high_broken"] and bar_high > orb_high:
                logger.info(
                    f"[BREAKOUT DETECTED] {ticker} above ORB high! "
                    f"Bar High={bar_high}, ORB High={orb_high}"
                )
                await self.record_breakout(ticker, "above", bar_high)

            elif not state["low_broken"] and bar_low < orb_low:
                logger.info(
                    f"[BREAKOUT DETECTED] {ticker} below ORB low! "
                    f"Bar Low={bar_low}, ORB Low={orb_low}"
                )
                await self.record_breakout(ticker, "below", bar_low)

    def _sync_bar_handler(self, data: Bar):
        """
        Synchronous wrapper for handle_bar.
        Alpaca's subscribe_bars expects a sync callback.
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self.handle_bar(data))
            else:
                loop.run_until_complete(self.handle_bar(data))
        except Exception as e:
            logger.error(f"Error in bar handler wrapper: {e}")

    async def subscribe_to_tickers(self):
        """Subscribe to bar data for followed tickers"""
        tickers = await self.load_followed_stocks()

        if not tickers:
            logger.warning("No tickers to monitor - check user_stock_follows table")
            return False

        self.active_tickers = tickers

        # Create fresh stream instance
        self._create_stock_stream()

        # Subscribe using the SYNC handler
        self.stock_stream.subscribe_bars(self._sync_bar_handler, *list(tickers))
        self.subscribed_tickers = tickers.copy()

        logger.info(f"Subscribed to bars for {len(tickers)} tickers: {list(tickers)}")
        return True

    async def unsubscribe_all(self):
        """Unsubscribe from all tickers before closing"""
        if not self.subscribed_tickers:
            logger.info("No tickers to unsubscribe from")
            return

        try:
            logger.info(f"Unsubscribing from {len(self.subscribed_tickers)} tickers")

            if self.stock_stream:
                for ticker in self.subscribed_tickers:
                    try:
                        self.stock_stream.unsubscribe_bars(ticker)
                    except Exception as e:
                        logger.warning(f"Error unsubscribing from {ticker}: {e}")

            await asyncio.sleep(0.5)

            self.subscribed_tickers.clear()
            logger.info("Unsubscribed from all tickers successfully")

        except Exception as e:
            logger.error(f"Error during unsubscribe: {e}")

    async def start_stream(self):
        """Start the WebSocket stream"""
        if self._stream_task is not None and not self._stream_task.done():
            logger.info("Stream already running")
            return

        if not self.stock_stream:
            logger.error("Cannot start stream - stock_stream not initialized")
            return

        try:
            logger.info("Starting Alpaca WebSocket stream...")

            self._stream_task = asyncio.create_task(self.stock_stream._run_forever())
            self._stream_started = True

            await asyncio.sleep(2)

            logger.info(
                f"Stream started successfully. Monitoring {len(self.subscribed_tickers)} tickers. "
                f"Waiting for bar data..."
            )
        except Exception as e:
            logger.error(f"Failed to start stock stream: {e}", exc_info=True)
            raise

    async def stop_stream(self):
        """Stop the WebSocket stream with proper cleanup"""
        if not self._stream_started:
            logger.info("Stream was never started, skipping cleanup")
            return

        try:
            await self.unsubscribe_all()

            if self._stream_task is not None:
                logger.info("Cancelling stream task")
                self._stream_task.cancel()
                try:
                    await self._stream_task
                except asyncio.CancelledError:
                    logger.info("Stream task cancelled successfully")
                except Exception as e:
                    logger.error(f"Error awaiting stream task cancellation: {e}")
                finally:
                    self._stream_task = None

            if self.stock_stream:
                try:
                    await self.stock_stream.close()
                    logger.info("Stock stream connection closed")
                except Exception as e:
                    logger.error(f"Error closing stock stream: {e}")

            self._stream_started = False
            self.stock_stream = None

        except Exception as e:
            logger.error(f"Error stopping stream: {e}")

    async def run_service(self):
        """Main service loop"""
        logger.info("Starting ORB Monitoring Service loop")

        while self.is_running:
            try:
                current_time = self.get_current_et_time()

                # Debug: Log service state periodically
                if self._bars_received_count == 0 and self._stream_started:
                    logger.warning(
                        f"[DEBUG] Stream started but no bars received yet. "
                        f"Subscribed tickers: {list(self.subscribed_tickers)}"
                    )

                # Skip market hours check in debug mode
                if not getattr(self, '_debug_mode', False) and not self.is_market_hours():
                    if self._stream_started:
                        logger.info("Market closed, stopping stream")
                        await self.stop_stream()

                    logger.info("Outside market hours, waiting...")
                    await asyncio.sleep(60)
                    continue

                # Check if we're in ORB calculation period
                if self.is_orb_calculation_period():
                    if not self.calculation_phase:
                        logger.info("=" * 50)
                        logger.info("Entering ORB calculation phase (9:30-9:45 AM)")
                        logger.info("=" * 50)
                        self.calculation_phase = True
                        self.orb_ranges.clear()
                        self.monitoring_state.clear()
                        self._bars_received_count = 0

                        subscribed = await self.subscribe_to_tickers()
                        if subscribed:
                            await self.start_stream()
                        else:
                            logger.error("Failed to subscribe to any tickers!")

                elif self.calculation_phase:
                    # Just exited ORB period - save ranges
                    logger.info("=" * 50)
                    logger.info(f"ORB calculation complete. Total bars received: {self._bars_received_count}")
                    logger.info(f"ORB ranges calculated: {list(self.orb_ranges.keys())}")
                    logger.info("=" * 50)
                    self.calculation_phase = False

                    for ticker, data in self.orb_ranges.items():
                        await self.save_orb_range(ticker, data)
                        logger.info(
                            f"  {ticker}: High={data['high']}, Low={data['low']}, "
                            f"Open={data.get('open', 'N/A')}, Volume={data.get('volume', 0)}"
                        )

                # After market close
                if current_time.time() > self.market_close:
                    logger.info("Market closed, stopping service")
                    self.is_running = False
                    break

                await asyncio.sleep(10)

            except Exception as e:
                logger.error(f"Error in service loop: {e}", exc_info=True)
                await asyncio.sleep(30)

    async def start(self, debug_mode: bool = False):
        """Start the monitoring service"""
        try:
            self.is_running = True
            self._debug_mode = debug_mode
            self._bars_received_count = 0

            logger.info("=" * 60)
            logger.info("ORB MONITORING SERVICE STARTING")
            logger.info(f"Debug mode: {debug_mode}")
            logger.info(f"Current ET time: {self.get_current_et_time()}")
            logger.info(f"Market hours: {self.is_market_hours()}")
            logger.info(f"ORB calculation period: {self.is_orb_calculation_period()}")
            logger.info("=" * 60)

            # Send service started notification
            await self.send_service_status_notification("started")

            # Check market hours first
            if not debug_mode and not self.is_market_hours():
                logger.info("Outside market hours - entering wait loop")
                await self.run_service()
                return

            # Debug mode: bypass market hours for testing
            if debug_mode:
                logger.info("DEBUG MODE: Bypassing market hours check")
                
                # First, ensure we have ORB ranges (fetch historically if needed)
                await self.ensure_orb_ranges()
                
                logger.info(f"DEBUG MODE: ORB ranges available: {len(self.orb_ranges)}")
                for ticker, data in self.orb_ranges.items():
                    logger.info(f"  {ticker}: High={data['high']}, Low={data['low']}")

                subscribed = await self.subscribe_to_tickers()
                if subscribed:
                    logger.info(f"DEBUG MODE: Subscribed to {len(self.active_tickers)} tickers")
                    await self.start_stream()
                    logger.info("DEBUG MODE: Waiting 30 seconds to receive data...")

                    for i in range(6):
                        await asyncio.sleep(5)
                        logger.info(f"DEBUG MODE: [{(i+1)*5}s] Bars received: {self._bars_received_count}")

                    logger.info(f"DEBUG MODE: Test complete. Total bars: {self._bars_received_count}")
                else:
                    logger.error("DEBUG MODE: Failed to subscribe to any tickers")
                return

            # Normal operation
            # If past ORB calculation period, ensure we have ranges (fetch historically if needed)
            if not self.is_orb_calculation_period():
                await self.ensure_orb_ranges()

                if self.orb_ranges:
                    logger.info(f"Starting monitoring with {len(self.orb_ranges)} ORB ranges")
                    subscribed = await self.subscribe_to_tickers()
                    if subscribed:
                        await self.start_stream()
                else:
                    logger.info("No ORB ranges available, will wait for calculation period")

            await self.run_service()

        except Exception as e:
            logger.error(f"Service error: {e}", exc_info=True)
            self.is_running = False
        finally:
            await self.stop()

    async def stop(self):
        """Stop the monitoring service"""
        logger.info("=" * 60)
        logger.info("STOPPING ORB MONITORING SERVICE")
        logger.info(f"Total bars received this session: {self._bars_received_count}")
        logger.info("=" * 60)

        self.is_running = False

        await self.stop_stream()

        await self.send_service_status_notification("stopped")

        logger.info("ORB Monitoring Service stopped")


# Global instance for singleton pattern
_alpaca_service = None


def get_alpaca_service() -> AlpacaService:
    """Get or create the singleton AlpacaService instance."""
    global _alpaca_service

    if _alpaca_service is None:
        try:
            _alpaca_service = AlpacaService()
            logger.info("AlpacaService singleton created")
        except Exception as e:
            logger.error(f"Failed to initialize AlpacaService: {str(e)}", exc_info=True)
            raise Exception(f"Alpaca service initialization failed: {str(e)}") from e

    return _alpaca_service


def reset_alpaca_service():
    """Reset the singleton instance (useful for testing or restarts)"""
    global _alpaca_service
    _alpaca_service = None
    logger.info("AlpacaService singleton reset")