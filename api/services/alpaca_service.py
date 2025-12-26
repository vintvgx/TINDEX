import asyncio
from decimal import Decimal
import os
from typing import Dict, Set, Optional
import pytz
from datetime import datetime, time, timedelta
import logging
import aiohttp


from supabase import create_client, Client


from alpaca.data.live import CryptoDataStream, OptionDataStream, StockDataStream
from alpaca.data.models import Bar, Trade, Quote

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AlpacaService:
    """
    Service class for managing Alpaca API requests with streaming support.

    This service provides:
    ├──Subscribes to user-followed stocks
    ├── Calculates ORB ranges (9:30-9:45)
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

        # Initialize options and stock stream
        self.stock_stream = StockDataStream(self.alpaca_api_key, self.alpaca_secret_key)
        self.option_stream = OptionDataStream(
            self.alpaca_api_key, self.alpaca_secret_key
        )

        # Initialize supabase
        # TODO come back to this, a call should be made to an already initialized supabase instead of re-initializing
        # TODO verify how alpaca set up is and when the service is being called
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)

        # Market timezone
        self.et_timezone = pytz.timezone("America/New_York")

        # ORB tracking
        self.orb_ranges: Dict[str, Dict] = {}  # ticker -> {high, low, volume}
        self.monitoring_state: Dict[str, Dict] = (
            {}
        )  # ticker -> {high_broken, low_broken}
        self.active_tickers: Set[str] = set()

        # Market hours
        self.market_open = time(9, 30)
        self.orb_end = time(9, 45)
        self.market_close = time(16, 0)

        # Service state
        self.is_running = False
        self.calculation_phase = False  # True during 9:30-9:45
        self._stream_task: Optional[asyncio.Task] = None  # Track the stream task
        
        # url for sending push notifications
        self.expo_push_url = "https://exp.host/--/api/v2/push/send"


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
            logger.info(f"Loaded {len(tickers)} tickers for ORB monitoring")
            return tickers
        except Exception as e:
            logger.error(f"Error loading followed stocks: {e}")
            return set()

    async def save_orb_range(self, ticker: str, data: Dict):
        """Save calculated ORB range to database"""
        try:
            trade_date = self.get_current_et_time().date()

            self.supabase.table("orb_ranges").upsert(
                {
                    "ticker": ticker,
                    "trade_date": str(trade_date),
                    "orb_high": float(data["high"]),
                    "orb_low": float(data["low"]),
                    "volume_in_range": data.get("volume", 0),
                    "opening_price": float(data.get("open", 0)),
                }
            ).execute()

            # Initialize monitoring state
            self.supabase.table("orb_monitoring_state").upsert(
                {
                    "ticker": ticker,
                    "trade_date": str(trade_date),
                    "last_price": float(data["high"]),
                    "high_broken": False,
                    "low_broken": False,
                    "monitoring_active": True,
                }
            ).execute()

            logger.info(
                f"Saved ORB range for {ticker}: High={data['high']}, Low={data['low']}"
            )
        except Exception as e:
            logger.error(f"Error saving ORB range for {ticker}: {e}")

    async def load_orb_ranges(self):
        """Load today's ORB ranges from database"""
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

            logger.info(f"Loaded {len(self.orb_ranges)} ORB ranges for monitoring")
        except Exception as e:
            logger.error(f"Error loading ORB ranges: {e}")

    async def record_breakout(self, ticker: str, breakout_type: str, price: Decimal):
        """Record a breakout event and trigger notifications"""
        try:
            trade_date = self.get_current_et_time().date()
            orb_data = self.orb_ranges.get(ticker, {})

            # Record breakout
            breakout_record = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "breakout_type": breakout_type,
                "breakout_price": float(price),
                "breakout_time": self.get_current_et_time().isoformat(),
                "orb_high": float(orb_data.get("high", 0)),
                "orb_low": float(orb_data.get("low", 0)),
            }

            self.supabase.table("orb_breakouts").insert(breakout_record).execute()

            # Update monitoring state
            state_update = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "last_price": float(price),
            }

            if breakout_type == "above":
                state_update["high_broken"] = True
            else:
                state_update["low_broken"] = True

            self.supabase.table("orb_monitoring_state").upsert(state_update).execute()

            # Trigger notification to alert user 
            # TODO implement send_notification (use supabase/sendPushNotification line 240 - 265 for reference)
            await self.send_notifications(ticker, breakout_type, price)

            logger.info(f"BREAKOUT: {ticker} broke {breakout_type} ORB at ${price}")

        except Exception as e:
            logger.error(f"Error recording breakout for {ticker}: {e}")

    async def send_notifications(self, ticker: str, breakout_type: str, price: Decimal):
        """Send push notifications to users following this stock with ORB enabled"""
        try:
            # Step 1: Query users who are following this ticker with ORB notifications enabled
            users_response = self.supabase.table("user_stock_follows")\
                .select("user_id")\
                .eq("ticker", ticker)\
                .eq("orb_enabled", True)\
                .execute()
            
            if not users_response.data:
                logger.info(f"No users following {ticker} with ORB enabled")
                return
            
            user_ids = [user['user_id'] for user in users_response.data]
            
            # Step 2: Get user profiles with push tokens
            profiles_response = self.supabase.table("user_profiles")\
                .select("id, expo_push_token, notification_preferences")\
                .in_("id", user_ids)\
                .not_("expo_push_token", "is", None)\
                .execute()
            
            if not profiles_response.data:
                logger.info(f"No users with push tokens for {ticker}")
                return
            
            # Step 3: Filter for users with notifications enabled
            eligible_users = [
                user for user in profiles_response.data
                if user.get("notification_preferences", {}).get("enabled", False)
                and user.get("notification_preferences", {}).get("orb_alerts", True)
            ]
            
            if not eligible_users:
                logger.info(f"No eligible users for {ticker} ORB notification")
                return
            
            # Step 4: Send notifications to each eligible user
            notification_tasks = []
            for user in eligible_users:
                task = self._send_push_notification(
                    user=user,
                    ticker=ticker,
                    breakout_type=breakout_type,
                    price=price
                )
                notification_tasks.append(task)
            
            # Send all notifications in parallel
            results = await asyncio.gather(*notification_tasks, return_exceptions=True)
            
            # Log results
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
        ticker: str, 
        breakout_type: str, 
        price: Decimal,
        title: Optional[str] = None,
        body: Optional[str] = None
    ) -> bool:
        """Send individual push notification via Expo"""
        try:
            expo_token = user.get("expo_push_token")
            if not expo_token:
                return False
            
            # Format notification message
            message_title = title if title is not None else f"🚨 ORB Alert: {ticker}"
            direction = "above ORB high" if breakout_type == "above" else "below ORB low"
            message_body = body if body is not None else f"{ticker} broke {direction} at ${float(price):.2f}"
            
            # Create notification message
            message = {
                "to": expo_token,
                "sound": "default",
                "title": message_title,
                "body": message_body,
                "data": {
                    "type": "orb_breakout",
                    "ticker": ticker,
                    "breakout_type": breakout_type,
                    "price": float(price),
                    "screen": "ticker",  # Navigate to ticker screen
                    "timestamp": self.get_current_et_time().isoformat()
                },
                "badge": 1,
                "priority": "high",
                "channelId": "orb-alerts",
            }
            
            # Send via Expo Push API
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
            
            # Save notification to database for UI display
            await self._save_notification_record(
                user_id=user['id'],
                ticker=ticker,
                breakout_type=breakout_type,
                price=price,
                message=message
            )
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to send push to user {user.get('id')}: {e}")
            return False
    
    async def _save_notification_record(
        self,
        user_id: str,
        ticker: str,
        breakout_type: str,
        price: Decimal,
        message: Dict
    ):
        """Save notification record to database for UI display"""
        try:
            notification_record = {
                "user_id": user_id,
                "title": message["title"],
                "body": message["body"],
                "type": "orb_breakout",
                "data": {
                    "ticker": ticker,
                    "breakout_type": breakout_type,
                    "price": float(price),
                    "screen": "stock_detail",
                    "sentAt": self.get_current_et_time().isoformat()
                },
                "read": False,
                "expires_at": (
                    datetime.now() + timedelta(days=7)
                ).isoformat()  # Expire after 7 days
            }
            
            self.supabase.table("notifications").insert(notification_record).execute()
            logger.info(f"Saved notification record for user {user_id}")
            
        except Exception as e:
            logger.error(f"Failed to save notification record: {e}")

    async def handle_bar(self, data: Bar):
        """Handle incoming bar data

                NOTE: Bar object structure from Alpaca
        Bar(
            symbol='AAPL',
            timestamp=datetime,
            open=150.00,
            high=151.00,
            low=149.50,
            close=150.75,
            volume=1000000,
            trade_count=5000,
            vwap=150.25  # Volume-weighted average price
            exchange
        )
        """
        ticker = data.symbol
        current_price = Decimal(str(data.close))

        if self.calculation_phase:
            # During ORB calculation period (9:30-9:45)
            # saves prices to Dict during initial market open
            if ticker not in self.orb_ranges:
                self.orb_ranges[ticker] = {
                    "high": current_price,
                    "low": current_price,
                    "open": current_price,
                    "volume": data.volume,
                }
            else:
                # prices are then updated as the Bar data is received
                self.orb_ranges[ticker]["high"] = max(
                    self.orb_ranges[ticker]["high"], current_price
                )
                self.orb_ranges[ticker]["low"] = min(
                    self.orb_ranges[ticker]["low"], current_price
                )
                self.orb_ranges[ticker]["volume"] += data.volume
        else:
            # After ORB period - monitor for breakouts
            if ticker not in self.orb_ranges:
                return  # No ORB data for this ticker

            orb_high = self.orb_ranges[ticker]["high"]
            orb_low = self.orb_ranges[ticker]["low"]
            state = self.monitoring_state.get(
                ticker, {"high_broken": False, "low_broken": False}
            )

            # Check for breakouts
            if not state["high_broken"] and current_price > orb_high:
                await self.record_breakout(ticker, "above", current_price)
                state["high_broken"] = True

            elif not state["low_broken"] and current_price < orb_low:
                await self.record_breakout(ticker, "below", current_price)
                state["low_broken"] = True

    async def subscribe_to_tickers(self):
        """Subscribe to bar data for followed tickers"""
        tickers = await self.load_followed_stocks()

        if not tickers:
            logger.warning("No tickers to monitor")
            return

        self.active_tickers = tickers

        # Subscribe to bar data
        async def bar_handler(data):
            await self.handle_bar(data)

        self.stock_stream.subscribe_bars(bar_handler, *list(tickers))
        logger.info(f"Subscribed to {len(tickers)} tickers")

    async def run_service(self):
        """Main service loop"""
        logger.info("Starting ORB Monitoring Service")
        self.is_running = True

        while self.is_running:
            try:
                current_time = self.get_current_et_time()

                if not self.is_market_hours():
                    logger.info("Outside market hours, waiting...")
                    await asyncio.sleep(60)  # Check every minute
                    continue

                # Check if we're in ORB calculation period
                if self.is_orb_calculation_period():
                    if not self.calculation_phase:
                        logger.info("Entering ORB calculation phase (9:30-9:45 AM)")
                        self.calculation_phase = True
                        self.orb_ranges.clear()
                        self.monitoring_state.clear()
                        await self.subscribe_to_tickers()

                        # Start streaming
                        if self._stream_task is None or self._stream_task.done():
                            self._stream_task = asyncio.create_task(self.stock_stream.run())
                            logger.info("Stock stream task created in calculation phase")

                elif self.calculation_phase:
                    # Just exited ORB period - save ranges
                    logger.info("ORB calculation complete, saving ranges")
                    self.calculation_phase = False

                    for ticker, data in self.orb_ranges.items():
                        await self.save_orb_range(ticker, data)

                # After market close
                if current_time.time() > self.market_close:
                    logger.info("Market closed, stopping service")
                    self.is_running = False
                    break

                await asyncio.sleep(10)  # Check every 10 seconds

            except Exception as e:
                logger.error(f"Error in service loop: {e}")
                await asyncio.sleep(30)  # Wait before retry

    async def start(self):
        """Start the monitoring service"""
        try:
            # Ensure is_running is set early to prevent NoneType errors
            self.is_running = True
            
            # Load any existing ORB ranges for today
            if not self.is_orb_calculation_period():
                await self.load_orb_ranges()
                await self.subscribe_to_tickers()
                
                # Start the stream task and store it for proper management
                try:
                    self._stream_task = asyncio.create_task(self.stock_stream.run())
                    logger.info("Stock stream task created")
                except Exception as e:
                    logger.error(f"Failed to start stock stream: {e}", exc_info=True)
                    raise

            await self.run_service()

        except Exception as e:
            logger.error(f"Service error: {e}", exc_info=True)
            # Ensure is_running is False on error
            self.is_running = False
        finally:
            await self.stop()

    async def stop(self):
        """Stop the monitoring service"""
        logger.info("Stopping ORB Monitoring Service")
        
        # Set is_running to False first
        if hasattr(self, 'is_running'):
            self.is_running = False
        
        # Cancel the stream task if it exists
        if hasattr(self, '_stream_task') and self._stream_task is not None:
            try:
                self._stream_task.cancel()
                try:
                    await self._stream_task
                except asyncio.CancelledError:
                    logger.info("Stream task cancelled successfully")
                except Exception as e:
                    logger.error(f"Error waiting for stream task cancellation: {e}")
            except Exception as e:
                logger.error(f"Error cancelling stream task: {e}")
        
        # Close the stock stream
        if hasattr(self, 'stock_stream') and self.stock_stream is not None:
            try:
                await self.stock_stream.close()
                logger.info("Stock stream closed")
            except Exception as e:
                logger.error(f"Error closing stock stream: {e}")


# Global instance for singleton pattern
_alpaca_service = None


def get_alpaca_service() -> AlpacaService:
    """
    Get or create the singleton AlpacaService instance.

    This factory function ensures only one instance of AlpacaService exists,
    which is important for managing a single connection pool and avoiding
    duplicate subscriptions to the same data streams.

    Returns:
        AlpacaService instance

    Raises:
        ValueError: If required environment variables are not set
    """
    global _alpaca_service

    if _alpaca_service is None:
        try:
            _alpaca_service = AlpacaService()
            logger.info("AlpacaService singleton created")
        except Exception as e:
            logger.error(f"Failed to initialize AlpacaService: {str(e)}", exc_info=True)
            raise Exception(f"Alpaca service initialization failed: {str(e)}") from e

    return _alpaca_service

