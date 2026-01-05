import asyncio
from decimal import Decimal
import os
from typing import Dict, Set, Optional
import pytz
from datetime import datetime, time, timedelta
import logging
import aiohttp
import pandas as pd

from supabase import create_client, Client

from alpaca.data.live import StockDataStream, OptionDataStream
from alpaca.data.enums import DataFeed
from alpaca.data.models import Bar
import yfinance as yf

from services.breakout_confirmation import BreakoutConfirmation

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
        self.supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not self.supabase_url or not self.supabase_key:
            raise ValueError("Supabase credentials not defined")

        # Initialize supabase
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)

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
        
        # Stream startup monitoring
        self._stream_monitor_task: Optional[asyncio.Task] = None
        self._stream_start_time: Optional[datetime] = None
        self._bars_received_at_start = 0

        # Stream will be created fresh when needed
        self.stock_stream: Optional[StockDataStream] = None
        self.option_stream: Optional[OptionDataStream] = None

        # Expo push URL
        self.expo_push_url = "https://exp.host/--/api/v2/push/send"
        
        # Breakout confirmation timers: {ticker: asyncio.Task}
        self._confirmation_timers: Dict[str, asyncio.Task] = {}

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
        Fetch ORB range using yfinance historical data (9:30-9:45 AM window).
        
        Uses yfinance instead of Alpaca's historical API because Alpaca's free tier
        only allows access to the latest 15 minutes of historical data.
        
        yfinance provides free access to intraday minute data for the current day.
        """
        try:
            today = self.get_current_et_time().date()
            
            logger.info(f"Fetching historical bars for {ticker} from yfinance for {today}")
            
            # Run yfinance call in executor to not block async loop
            loop = asyncio.get_event_loop()
            
            def fetch_yfinance_data():
                stock = yf.Ticker(ticker)
                # Get today's 1-minute bars
                # period="1d" with interval="1m" gets today's minute data
                hist = stock.history(period="1d", interval="1m")
                return hist
            
            hist = await loop.run_in_executor(None, fetch_yfinance_data)
            
            if hist is None or hist.empty:
                logger.warning(f"No yfinance data returned for {ticker} - market may be closed")
                return None
            
            # Debug: Log what we got
            logger.info(f"yfinance returned {len(hist)} bars for {ticker}")
            if not hist.empty:
                logger.info(f"  Time range: {hist.index[0]} to {hist.index[-1]}")
            
            # Filter to ORB window (9:30-9:45 AM ET)
            # yfinance returns timestamps in the exchange timezone (ET for US stocks)
            orb_start_time = self.market_open  # time(9, 30)
            orb_end_time = self.orb_end  # time(9, 45)
            
            # Convert index to ET timezone if needed and filter
            orb_bars = []
            for idx, row in hist.iterrows():
                # Get the time component
                bar_time = idx.time()
                
                # Check if bar falls within ORB window
                if orb_start_time <= bar_time <= orb_end_time:
                    orb_bars.append({
                        'time': idx,
                        'open': row['Open'],
                        'high': row['High'],
                        'low': row['Low'],
                        'close': row['Close'],
                        'volume': row['Volume']
                    })
            
            if not orb_bars:
                logger.warning(f"No bars found in ORB window (9:30-9:45) for {ticker}")
                logger.info(f"  Available times: {[idx.time() for idx in hist.index[:10]]}...")
                return None
            
            logger.info(f"Found {len(orb_bars)} bars in ORB window for {ticker}")
            
            # Calculate ORB from the filtered bars
            highs = [Decimal(str(bar['high'])) for bar in orb_bars]
            lows = [Decimal(str(bar['low'])) for bar in orb_bars]
            volumes = [int(bar['volume']) for bar in orb_bars]
            
            orb_high = max(highs)
            orb_low = min(lows)
            opening_price = Decimal(str(orb_bars[0]['open']))  # First bar's open
            total_volume = sum(volumes)
            
            orb_data = {
                "high": orb_high,
                "low": orb_low,
                "open": opening_price,
                "volume": total_volume
            }
            
            logger.info(
                f"[HISTORICAL ORB via yfinance] {ticker}: "
                f"High={orb_high}, Low={orb_low}, Open={opening_price}, "
                f"Volume={total_volume}, Bars={len(orb_bars)}"
            )
            
            return orb_data
            
        except Exception as e:
            logger.error(f"Error fetching historical ORB for {ticker} via yfinance: {e}", exc_info=True)
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

            # TODO skip retrieving from DB - fetch historical ORL and ORH from yfinance to ensure accurate data
            # Check if it's in the database for today
            # existing = await self._get_orb_range_from_db(ticker)
            # if existing:
            #     self.orb_ranges[ticker] = existing
            #     logger.info(
            #         f"  {ticker}: Loaded from DB - "
            #         f"High={existing['high']}, Low={existing['low']}"
            #     )
            #     continue

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

            # Initialize monitoring state with all required fields
            state_record = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "opening_price": opening_price,
                "orb_high": orb_high,
                "orb_low": orb_low,
                "current_price": orb_high,  # Initialize with high (will be updated as bars come in)
                "volume": volume,
                "breakout_type": "none",
                "breakout_price": None,  # NULL when breakout_type is 'none'
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

    async def _fetch_market_data(self, ticker: str) -> Dict[str, Optional[float]]:
        """
        Fetch market data needed for breakout confirmation (VWAP, ATR, avg volume).
        
        Architecture:
        - Uses yfinance for efficient data fetching
        - Calculates VWAP from recent intraday bars
        - Calculates ATR from daily bars
        - Fetches average volume from ticker info
        
        Performance:
        - Cached results could be added for frequently accessed tickers
        - Runs in executor to avoid blocking async loop
        """
        try:
            loop = asyncio.get_event_loop()
            
            def fetch_data():
                stock = yf.Ticker(ticker)
                info = stock.info
                
                # Get average volume
                avg_volume = info.get("averageVolume", 0) or info.get("averageVolume10days", 0) or 0
                
                # Get intraday data for VWAP calculation (last 20 minutes)
                try:
                    intraday = stock.history(period="1d", interval="1m")
                    vwap = None
                    if not intraday.empty and len(intraday) > 0:
                        # Calculate VWAP: sum(price * volume) / sum(volume)
                        typical_price = (intraday['High'] + intraday['Low'] + intraday['Close']) / 3
                        total_volume = intraday['Volume'].sum()
                        if total_volume > 0:
                            vwap = float((typical_price * intraday['Volume']).sum() / total_volume)
                        else:
                            vwap = None
                except Exception as e:
                    logger.warning(f"Could not calculate VWAP for {ticker}: {e}")
                    vwap = None
                
                # Get daily data for ATR calculation (last 14 days)
                try:
                    daily = stock.history(period="14d", interval="1d")
                    atr = None
                    if not daily.empty and len(daily) >= 14:
                        # Calculate True Range
                        high_low = daily['High'] - daily['Low']
                        high_close = abs(daily['High'] - daily['Close'].shift(1))
                        low_close = abs(daily['Low'] - daily['Close'].shift(1))
                        true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
                        # ATR is 14-period SMA of True Range
                        atr = float(true_range.tail(14).mean())
                except Exception as e:
                    logger.warning(f"Could not calculate ATR for {ticker}: {e}")
                    atr = None
                
                return {
                    "avg_volume": float(avg_volume),
                    "vwap": vwap,
                    "atr": atr
                }
            
            result = await loop.run_in_executor(None, fetch_data)
            return result
            
        except Exception as e:
            logger.error(f"Error fetching market data for {ticker}: {e}")
            return {
                "avg_volume": 0.0,
                "vwap": None,
                "atr": None
            }

    async def record_breakout(self, ticker: str, breakout_type: str, price: Decimal, bar_data: Optional[Bar] = None):
        """
        Record a breakout event and trigger notifications with enhanced breakout analysis.
        
        Architecture:
        - Evaluates breakout quality using BreakoutConfirmation
        - Fetches market data (VWAP, ATR, avg volume) for scoring
        - Sends initial notification with detailed metrics
        - Starts 3-minute confirmation timer
        
        Performance:
        - Market data fetching runs in parallel where possible
        - Confirmation timer uses asyncio.sleep for non-blocking delay
        """
        try:
            trade_date = self.get_current_et_time().date()
            orb_data = self.orb_ranges.get(ticker, {})

            # Convert Decimals to floats for JSON serialization
            breakout_price = float(price) if isinstance(price, Decimal) else price
            orb_high = float(orb_data.get("high", 0)) if isinstance(orb_data.get("high", 0), Decimal) else orb_data.get("high", 0)
            orb_low = float(orb_data.get("low", 0)) if isinstance(orb_data.get("low", 0), Decimal) else orb_data.get("low", 0)

            # Get current bar data for breakout evaluation
            current_close = breakout_price
            current_volume = bar_data.volume if bar_data else 0

            # Fetch market data for breakout confirmation
            market_data = await self._fetch_market_data(ticker)
            avg_volume_val = market_data.get("avg_volume", 0)
            avg_volume = int(avg_volume_val) if avg_volume_val else 0
            vwap = market_data.get("vwap")
            atr = market_data.get("atr")

            # Evaluate breakout with BreakoutConfirmation
            breakout_evaluator = BreakoutConfirmation(ticker, orb_high, orb_low)
            breakout_analysis = breakout_evaluator.evaluate_breakout(
                current_close=current_close,
                current_volume=current_volume,
                avg_volume=avg_volume,
                vwap=vwap if vwap else current_close,  # Fallback to current price if VWAP unavailable
                atr=atr
            )

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

            # Update monitoring state in DB with breakout information
            # Map "above" to "Bullish" and "below" to "Bearish" for frontend consistency
            breakout_type_display = "Bullish" if breakout_type == "above" else "Bearish"
            
            state_update = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "current_price": breakout_price,
                "breakout_type": breakout_type_display,
                "breakout_price": breakout_price,
                "orb_high": orb_high,  # Ensure ORB high is persisted
                "orb_low": orb_low,    # Ensure ORB low is persisted
            }

            if breakout_type == "above":
                state_update["high_broken"] = True
                self.monitoring_state[ticker]["high_broken"] = True
            else:
                state_update["low_broken"] = True
                self.monitoring_state[ticker]["low_broken"] = True

            self.supabase.table("orb_monitoring_state").upsert(state_update).execute()

            # Send initial notification with enhanced breakout data
            await self.send_notifications(
                ticker, 
                breakout_type, 
                price, 
                breakout_analysis=breakout_analysis,
                orb_high=orb_high,
                orb_low=orb_low
            )

            # Start 3-minute confirmation timer
            if ticker in self._confirmation_timers:
                # Cancel existing timer if any
                self._confirmation_timers[ticker].cancel()
            
            confirmation_task = asyncio.create_task(
                self._wait_for_confirmation(ticker, breakout_type, orb_high, orb_low)
            )
            self._confirmation_timers[ticker] = confirmation_task

            logger.info(
                f"[BREAKOUT RECORDED] {ticker} broke {breakout_type} ORB at ${breakout_price:.2f} "
                f"(ORB High=${orb_high:.2f}, ORB Low=${orb_low:.2f}) "
                f"Score: {breakout_analysis.get('score', 'N/A')}/100 "
                f"Confidence: {breakout_analysis.get('confidence', 'N/A')}"
            )

        except Exception as e:
            logger.error(f"Error recording breakout for {ticker}: {e}", exc_info=True)

    async def _wait_for_confirmation(self, ticker: str, breakout_type: str, orb_high: float, orb_low: float, breakout_timer: int = 180):
        """
        Wait 3 minutes after breakout, then check if price closed outside ORB.
        If confirmed, send BREAKOUT CONFIRMED notification.
        
        Architecture:
        - Non-blocking timer using asyncio.sleep
        - Fetches current price after 3 minutes
        - Validates breakout is still valid (price outside ORB)
        - Sends confirmation notification
        
        Edge Cases:
        - Handles case where breakout is invalidated before confirmation
        - Cancels if ticker is no longer being monitored
        """
        try:
            # Wait breakout_timer in minutes (default is 3 minutes/180 seconds)
            await asyncio.sleep(breakout_timer)
            
            # Check if still monitoring this ticker
            if ticker not in self.orb_ranges:
                logger.info(f"[CONFIRMATION] {ticker} no longer in monitoring, skipping confirmation")
                return
            
            # Fetch current price to check if breakout is confirmed
            try:
                loop = asyncio.get_event_loop()
                def get_current_price():
                    stock = yf.Ticker(ticker)
                    info = stock.info
                    return info.get("currentPrice") or info.get("regularMarketPrice")
                
                current_price = await loop.run_in_executor(None, get_current_price)
                
                if current_price is None:
                    logger.warning(f"[CONFIRMATION] Could not fetch current price for {ticker}")
                    return
                
                # Check if breakout is confirmed (price still outside ORB)
                is_confirmed = False
                if breakout_type == "above":
                    is_confirmed = current_price > orb_high
                else:
                    is_confirmed = current_price < orb_low
                
                if is_confirmed:
                    logger.info(
                        f"[BREAKOUT CONFIRMED] {ticker} breakout confirmed after 3 minutes. "
                        f"Price: ${current_price:.2f}, ORB High: ${orb_high:.2f}, ORB Low: ${orb_low:.2f}"
                    )
                    # Update monitoring state: breakout confirmed (keep as Bullish/Bearish)
                    breakout_type_display = "Confirmed Bullish" if breakout_type == "above" else "Confirmed Bearish"
                    trade_date = self.get_current_et_time().date()
                    self.supabase.table("orb_monitoring_state").upsert({
                        "ticker": ticker,
                        "trade_date": str(trade_date),
                        "current_price": current_price,
                        "breakout_type": breakout_type_display,
                        "orb_high": orb_high,  # Ensure ORB high is persisted
                        "orb_low": orb_low,    # Ensure ORB low is persisted
                        # breakout_price remains the same (initial breakout price)
                    }).execute()
                    await self.send_confirmation_notification(ticker, breakout_type, current_price, orb_high, orb_low)
                else:
                    logger.info(
                        f"[BREAKOUT INVALIDATED] {ticker} price returned inside ORB. "
                        f"Price: ${current_price:.2f}, ORB High: ${orb_high:.2f}, ORB Low: ${orb_low:.2f}"
                    )
                    # Update monitoring state: breakout invalidated
                    trade_date = self.get_current_et_time().date()
                    self.supabase.table("orb_monitoring_state").upsert({
                        "ticker": ticker,
                        "trade_date": str(trade_date),
                        "current_price": current_price,
                        "breakout_type": "invalidated",
                        "breakout_price": None,  # Clear breakout price on invalidation
                        "orb_high": orb_high,  # Ensure ORB high is persisted
                        "orb_low": orb_low,    # Ensure ORB low is persisted
                    }).execute()
                    await self.send_invalidation_notification(ticker, breakout_type, current_price, orb_high, orb_low)
                    
            except Exception as e:
                logger.error(f"Error checking confirmation for {ticker}: {e}")
                
        except asyncio.CancelledError:
            logger.info(f"[CONFIRMATION] Timer cancelled for {ticker}")
        except Exception as e:
            logger.error(f"Error in confirmation timer for {ticker}: {e}")
        finally:
            # Clean up timer reference
            if ticker in self._confirmation_timers:
                del self._confirmation_timers[ticker]

    async def get_eligible_users(self, ticker: str) -> list:
        """
        Get eligible users for ORB notifications for a given ticker.
        
        Architecture:
        - Queries users following the ticker with ORB enabled
        - Fetches user profiles with push tokens
        - Filters for users with valid tokens and enabled notifications
        
        Returns:
            List of eligible user dictionaries with id, expo_push_token, and notification_preferences
            Empty list if no eligible users found
        """
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
                return []

            user_ids = [user['user_id'] for user in users_response.data]

            profiles_response = (
                self.supabase.table("user_profiles")
                .select("id, expo_push_token, notification_preferences")
                .in_("id", user_ids)
                .neq("expo_push_token", "null")
                .execute()
            )

            if not profiles_response.data:
                logger.info(f"No users with push tokens for {ticker}")
                return []

            # Filter for users with valid tokens and proper notification settings
            eligible_users = [
                user for user in profiles_response.data
                if user.get("expo_push_token")  # Ensure token exists
                and user.get("notification_preferences", {}).get("enabled", True)
                # and user.get("notification_preferences", {}).get("orb_alerts", True)
            ]

            if not eligible_users:
                logger.info(f"No eligible users for {ticker} ORB notification")
                return []

            return eligible_users

        except Exception as e:
            logger.error(f"Error getting eligible users for {ticker}: {e}")
            return []

    async def send_confirmation_notification(self, ticker: str, breakout_type: str, price: float, orb_high: float, orb_low: float):
        """Send BREAKOUT CONFIRMED notification after 3-minute validation"""
        try:
            eligible_users = await self.get_eligible_users(ticker)
            
            if not eligible_users:
                return

            direction_emoji = "🟢" if breakout_type == "above" else "🔴"
            direction_text = "BULLISH" if breakout_type == "above" else "BEARISH"

            notification_tasks = []
            for user in eligible_users:
                message_title = f"{direction_emoji} {ticker} BREAKOUT CONFIRMED"
                message_body = (
                    f"{ticker} {direction_text} breakout confirmed after 3-minute close. "
                    f"Price: ${price:.2f}"
                )

                message = {
                    "sound": "default",
                    "title": message_title,
                    "body": message_body,
                    "data": {
                        "type": "orb_breakout_confirmed",
                        "ticker": ticker,
                        "breakout_type": breakout_type,
                        "price": price,
                        "orb_high": orb_high,
                        "orb_low": orb_low,
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
                    price=Decimal(str(price))
                )
                notification_tasks.append(task)

            results = await asyncio.gather(*notification_tasks, return_exceptions=True)
            successful = sum(1 for r in results if r is True)
            failed = len(results) - successful

            logger.info(
                f"Breakout confirmation notifications sent for {ticker}: "
                f"{successful} successful, {failed} failed"
            )

        except Exception as e:
            logger.error(f"Error sending confirmation notifications for {ticker}: {e}")

    async def send_invalidation_notification(self, ticker: str, breakout_type: str, price: float, orb_high: float, orb_low: float):
        """
        Send BREAKOUT INVALIDATED notification when price returns inside ORB after 3-minute timer.
        
        Architecture:
        - Uses same eligible users logic as confirmation notifications
        - Provides clear messaging about invalidation
        - Includes current price and ORB levels for context
        
        Design:
        - Warning-style notification with appropriate emoji
        - Helps users understand the breakout failed to sustain
        """
        try:
            eligible_users = await self.get_eligible_users(ticker)
            
            if not eligible_users:
                return

            direction_text = "BULLISH" if breakout_type == "above" else "BEARISH"

            notification_tasks = []
            for user in eligible_users:
                message_title = f"⚠️ {ticker} BREAKOUT INVALIDATED"
                message_body = (
                    f"{ticker} {direction_text} breakout invalidated after 3-minute close. "
                    f"Price returned inside ORB range. Current: ${price:.2f}"
                )

                message = {
                    "sound": "default",
                    "title": message_title,
                    "body": message_body,
                    "data": {
                        "type": "orb_breakout_invalidated",
                        "ticker": ticker,
                        "breakout_type": breakout_type,
                        "price": price,
                        "orb_high": orb_high,
                        "orb_low": orb_low,
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
                    price=Decimal(str(price))
                )
                notification_tasks.append(task)

            results = await asyncio.gather(*notification_tasks, return_exceptions=True)
            successful = sum(1 for r in results if r is True)
            failed = len(results) - successful

            logger.info(
                f"Breakout invalidation notifications sent for {ticker}: "
                f"{successful} successful, {failed} failed"
            )

        except Exception as e:
            logger.error(f"Error sending invalidation notifications for {ticker}: {e}")

    async def send_notifications(
        self, 
        ticker: str, 
        breakout_type: str, 
        price: Decimal,
        breakout_analysis: Optional[Dict] = None,
        orb_high: Optional[float] = None,
        orb_low: Optional[float] = None
    ):
        """
        Send push notifications with enhanced breakout data.
        
        Architecture:
        - Formats notification with detailed breakout metrics
        - Includes confidence score, reasons, and trading information
        - Maintains backward compatibility if breakout_analysis is not provided
        
        Notification Format:
        - Title: Emoji + ticker + confidence level
        - Body: Detailed breakout information with entry, stop loss, risk
        - Data: Complete breakout analysis for app display
        """
        try:
            eligible_users = await self.get_eligible_users(ticker)
            
            if not eligible_users:
                return

            price_float = float(price) if isinstance(price, Decimal) else price
            
            # Build enhanced notification if breakout analysis is available
            if breakout_analysis and breakout_analysis.get("signal"):
                signal = breakout_analysis.get("signal", "")
                score = breakout_analysis.get("score", 0)
                confidence = breakout_analysis.get("confidence", "MEDIUM")
                reasons = breakout_analysis.get("reasons", [])
                entry_price = breakout_analysis.get("entry_price", price_float)
                stop_loss = breakout_analysis.get("stop_loss", orb_low if breakout_type == "above" else orb_high)
                risk_per_share = breakout_analysis.get("risk_per_share", 0)
                
                # Determine emoji based on direction
                emoji = "🟢" if signal == "BULLISH" else "🔴"
                
                # Build title
                message_title = f"{emoji} {ticker} ORB BREAKOUT ({confidence} CONFIDENCE - {score}/100)"
                
                # Build detailed body
                direction_text = "BULLISH (Call opportunity)" if signal == "BULLISH" else "BEARISH (Put opportunity)"
                body_lines = [
                    f"Direction: {direction_text}",
                    f"Entry: ${entry_price:.2f}",
                    f"ORB High: ${orb_high:.2f}" if orb_high else "",
                    f"ORB Low: ${orb_low:.2f}" if orb_low else "",
                    f"Stop Loss: ${stop_loss:.2f} ({'ORL' if signal == 'BULLISH' else 'ORH'})" if stop_loss else "",
                    "",
                ]
                
                # Add reasons with checkmarks
                for reason in reasons:
                    if reason.startswith("⚠️"):
                        body_lines.append(reason)
                    else:
                        body_lines.append(f"✓ {reason}")
                
                # Add risk
                if risk_per_share > 0:
                    body_lines.append("")
                    body_lines.append(f"Risk: ${risk_per_share:.2f} per share")
                
                message_body = "\n".join([line for line in body_lines if line])
                
            else:
                # Fallback to simple notification if no analysis available
                message_title = f"🚨 ORB Alert: {ticker}"
                direction = "above ORB high" if breakout_type == "above" else "below ORB low"
                message_body = f"{ticker} broke {direction} at ${price_float:.2f}"

            notification_tasks = []
            for user in eligible_users:
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
                
                # Add enhanced breakout data if available
                if breakout_analysis:
                    message["data"].update({
                        "breakout_analysis": breakout_analysis,
                        "orb_high": orb_high,
                        "orb_low": orb_low,
                        "confidence": breakout_analysis.get("confidence"),
                        "score": breakout_analysis.get("score"),
                        "reasons": breakout_analysis.get("reasons", []),
                        "entry_price": breakout_analysis.get("entry_price", price_float),
                        "stop_loss": breakout_analysis.get("stop_loss"),
                        "risk_per_share": breakout_analysis.get("risk_per_share", 0),
                        "rvol": breakout_analysis.get("rvol", 0),
                        "vwap_aligned": breakout_analysis.get("vwap_aligned", False)
                    })

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
                "is_read": False,
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
                .execute()
            )

            if not profiles_response.data:
                logger.warning("No profiles obtained")
                return []

            logger.debug(f"Profiles: {profiles_response}")
            # Filter out users without push tokens and without proper notification settings
            eligible_users = [
                user for user in profiles_response.data
                if user.get("expo_push_token")  # Ensure token exists
                and user.get("notification_preferences", {}).get("enabled", True)
                # TODO [2025-12-26] apply logic when multiple users , right now just testing for @vintvgx
                # or user.get("notification_preferences", {}).get("orb_alerts", True)
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
        
        # Cancel stream monitoring task if bars are being received
        # Use fire-and-forget to avoid blocking bar processing
        if self._stream_monitor_task is not None and not self._stream_monitor_task.done():
            if self._bars_received_count > self._bars_received_at_start:
                logger.info("Stream is receiving data, cancelling startup monitoring")
                monitor_task = self._stream_monitor_task
                self._stream_monitor_task = None
                
                # Cancel and handle cleanup in background
                monitor_task.cancel()
                asyncio.create_task(self._cleanup_monitor_task(monitor_task))
        
        if self._bars_received_count <= 5 or self._bars_received_count % 10 == 0:
            logger.info(
                f"[BAR #{self._bars_received_count}] {ticker}: "
                f"O={data.open} H={data.high} L={data.low} C={data.close} V={data.volume}"
            )

        if self.calculation_phase:
            # During ORB calculation, track the TRUE high and low from bar data
            trade_date = self.get_current_et_time().date()
            
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
                
                # Initialize monitoring state in database with first bar data
                try:
                    self.supabase.table("orb_monitoring_state").upsert({
                        "ticker": ticker,
                        "trade_date": str(trade_date),
                        "opening_price": float(bar_open),
                        "orb_high": float(bar_high),
                        "orb_low": float(bar_low),
                        "current_price": float(bar_close),
                        "volume": data.volume,
                        "breakout_type": "none",
                        "breakout_price": None,
                        "high_broken": False,
                        "low_broken": False,
                        "monitoring_active": True,
                    }).execute()
                except Exception as e:
                    logger.warning(f"Failed to initialize monitoring state for {ticker}: {e}")
            else:
                old_high = self.orb_ranges[ticker]["high"]
                old_low = self.orb_ranges[ticker]["low"]
                
                # Update with bar's high/low, not just close
                self.orb_ranges[ticker]["high"] = max(old_high, bar_high)
                self.orb_ranges[ticker]["low"] = min(old_low, bar_low)
                self.orb_ranges[ticker]["volume"] += data.volume

                # Update monitoring state in database in real-time during calculation
                try:
                    self.supabase.table("orb_monitoring_state").upsert({
                        "ticker": ticker,
                        "trade_date": str(trade_date),
                        "orb_high": float(self.orb_ranges[ticker]["high"]),
                        "orb_low": float(self.orb_ranges[ticker]["low"]),
                        "current_price": float(bar_close),
                        "volume": self.orb_ranges[ticker]["volume"],
                    }).execute()
                except Exception as e:
                    logger.warning(f"Failed to update monitoring state for {ticker} during calculation: {e}")

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
            
            # Update current_price in database (use bar close as current price)
            # Also include orb_high and orb_low to ensure they persist
            trade_date = self.get_current_et_time().date()
            try:
                self.supabase.table("orb_monitoring_state").upsert({
                    "ticker": ticker,
                    "trade_date": str(trade_date),
                    "current_price": float(bar_close),
                    "orb_high": float(orb_high),  # Ensure ORB high is persisted
                    "orb_low": float(orb_low),    # Ensure ORB low is persisted
                }).execute()
            except Exception as e:
                logger.warning(f"Failed to update current_price for {ticker}: {e}")
            
            state = self.monitoring_state[ticker]

            # Check breakouts - use bar_high for upper breakout, bar_low for lower
            # This catches intrabar breakouts, not just close-based
            if not state["high_broken"] and bar_high > orb_high:
                logger.info(
                    f"[BREAKOUT DETECTED] {ticker} above ORB high! "
                    f"Bar High={bar_high}, ORB High={orb_high}"
                )
                await self.record_breakout(ticker, "above", bar_close, bar_data=data)

            elif not state["low_broken"] and bar_low < orb_low:
                logger.info(
                    f"[BREAKOUT DETECTED] {ticker} below ORB low! "
                    f"Bar Low={bar_low}, ORB Low={orb_low}"
                )
                await self.record_breakout(ticker, "below", bar_close, bar_data=data)

    async def _bar_handler(self, data: Bar):
        """
        Async handler for bar data.
        Alpaca's subscribe_bars requires a coroutine function.
        """
        try:
            await self.handle_bar(data)
        except Exception as e:
            logger.error(f"Error in bar handler: {e}")

    async def subscribe_to_tickers(self):
        """Subscribe to bar data for followed tickers"""
        try: 
            tickers = await self.load_followed_stocks()

            if not tickers:
                logger.warning("No tickers to monitor - check user_stock_follows table")
                return False

            self.active_tickers = tickers

            # Create fresh stream instance
            self._create_stock_stream()

            if not self.stock_stream:
                logger.error(f"Unable to create stock stream")
                raise RuntimeError("Unable to create stock stream")
            
            # Subscribe using the async handler (Alpaca requires a coroutine)
            self.stock_stream.subscribe_bars(self._bar_handler, *list(tickers))
            self.subscribed_tickers = tickers.copy()

            logger.info(f"Subscribed to bars for {len(tickers)} tickers: {list(tickers)}")
            return True
        except Exception as e:
            logger.error(f"Error subscribing to tickers: {e}")
            return False

    def _unsubscribe_ticker_blocking(self, ticker: str):
        """
        Helper method to unsubscribe from a single ticker.
        This is a blocking synchronous method that will be run in a thread pool.
        """
        if self.stock_stream:
            self.stock_stream.unsubscribe_bars(ticker)

    async def unsubscribe_all(self):
        """
        Unsubscribe from all tickers before closing.
        
        Note: unsubscribe_bars() is a blocking synchronous call from the Alpaca SDK
        that waits on a future. We run it in a thread pool executor to avoid blocking
        the event loop, with a timeout to prevent indefinite hanging.
        """
        if not self.subscribed_tickers:
            logger.info("No tickers to unsubscribe from")
            return

        try:
            logger.info(f"Unsubscribing from {len(self.subscribed_tickers)} tickers")

            if self.stock_stream:
                # Run blocking unsubscribe calls in thread pool with timeout
                loop = asyncio.get_running_loop()
                
                for ticker in list(self.subscribed_tickers):  # Copy list to avoid mutation during iteration
                    try:
                        # Run the blocking unsubscribe_bars() call in a thread pool
                        # with a 5-second timeout per ticker to prevent indefinite hanging
                        await asyncio.wait_for(
                            loop.run_in_executor(
                                None,
                                self._unsubscribe_ticker_blocking,
                                ticker
                            ),
                            timeout=5.0
                        )
                        logger.debug(f"Unsubscribed from {ticker}")
                    except asyncio.TimeoutError:
                        logger.warning(f"Timeout unsubscribing from {ticker} (exceeded 5s), continuing...")
                    except Exception as e:
                        logger.warning(f"Error unsubscribing from {ticker}: {e}")

            await asyncio.sleep(0.5)

            self.subscribed_tickers.clear()
            logger.info("Unsubscribed from all tickers successfully")

        except Exception as e:
            logger.error(f"Error during unsubscribe: {e}", exc_info=True)

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

            # Record start time and initial bar count for monitoring
            self._stream_start_time = self.get_current_et_time()
            self._bars_received_at_start = self._bars_received_count

            self._stream_task = asyncio.create_task(self.stock_stream._run_forever())
            self._stream_started = True

            # Start monitoring task to check if stream receives data within 2 minutes
            self._start_stream_monitoring()

            await asyncio.sleep(2)

            logger.info(
                f"Stream started successfully. Monitoring {len(self.subscribed_tickers)} tickers. "
                f"Waiting for bar data..."
            )
        except Exception as e:
            logger.error(f"Failed to start stock stream: {e}", exc_info=True)
            raise

    def _start_stream_monitoring(self):
        """
        Start a background task to monitor if the stream receives data within 2 minutes.
        If no data is received, sends a notification and attempts to restart the stream.
        """
        # Cancel any existing monitoring task
        if self._stream_monitor_task is not None and not self._stream_monitor_task.done():
            logger.warning("Cancelling existing stream monitoring task")
            self._stream_monitor_task.cancel()
            self._stream_monitor_task = None

        # Start new monitoring task
        self._stream_monitor_task = asyncio.create_task(self._monitor_stream_startup())
        logger.info("Started stream startup monitoring (2 minute timeout)")

    async def _cleanup_monitor_task(self, task: asyncio.Task):
        """
        Helper method to clean up a cancelled monitoring task.
        This is called asynchronously to avoid blocking bar processing.
        """
        try:
            await task
        except asyncio.CancelledError:
            logger.info("Stream monitoring cancelled - stream is healthy")
        except Exception as e:
            logger.error(f"Error cleaning up stream monitoring task: {e}")

    async def _monitor_stream_startup(self):
        """
        Monitor stream startup to ensure data is received within 2 minutes.
        If no bars are received, sends notification and attempts restart.
        """
        try:
            # Wait 2 minutes (120 seconds)
            await asyncio.sleep(120)

            # Check if stream is still running and if we received any bars
            if not self._stream_started:
                logger.info("Stream was stopped during monitoring, cancelling check")
                return

            bars_received_since_start = self._bars_received_count - self._bars_received_at_start

            if bars_received_since_start == 0:
                logger.error(
                    f"Stream startup timeout: No bars received after 2 minutes. "
                    f"Subscribed tickers: {list(self.subscribed_tickers)}"
                )

                # Send notification to users
                await self._send_stream_failure_notification()

                # Attempt to restart the stream
                logger.info("Attempting to restart stream after timeout...")
                try:
                    await self.stop_stream()
                    await asyncio.sleep(2)  # Brief pause before restart

                    # Recreate stream if needed
                    if not self.stock_stream:
                        self._create_stock_stream()
                        await self.subscribe_to_tickers()

                    await self.start_stream()
                    logger.info("Stream restart attempted after timeout")
                except Exception as restart_error:
                    logger.error(
                        f"Failed to restart stream after timeout: {restart_error}",
                        exc_info=True
                    )
            else:
                await self._send_stream_started_notification()
                logger.info(
                    f"Stream startup successful: Received {bars_received_since_start} bars "
                    f"within 2 minutes"
                )

        except asyncio.CancelledError:
            logger.info("Stream startup monitoring cancelled (stream is receiving data)")
        except Exception as e:
            logger.error(f"Error in stream startup monitoring: {e}", exc_info=True)

    async def _send_stream_failure_notification(self):
        """
        Send push notification to all ORB users about stream startup failure.
        """
        try:
            users = await self._get_all_orb_users()

            if not users:
                logger.info("No eligible users for stream failure notification")
                return

            message = {
                "sound": "default",
                "title": "⚠️ Stream Connection Issue",
                "body": (
                    "The stock data stream did not start successfully. "
                    "Attempting to reconnect automatically..."
                ),
                "data": {
                    "type": "stream_failure",
                    "status": "timeout",
                    "screen": "home",
                    "timestamp": self.get_current_et_time().isoformat()
                },
                "badge": 1,
                "priority": "high",
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
                f"Stream failure notifications sent: "
                f"{successful} successful, {failed} failed"
            )

        except Exception as e:
            logger.error(f"Error sending stream failure notification: {e}", exc_info=True)

    async def _send_stream_started_notification(self):
        """
        Send push notification to all ORB users about stream successful start.
        """
        try:
            users = await self._get_all_orb_users()

            if not users:
                logger.info("No eligible users for stream failure notification")
                return

            message = {
                "sound": "default",
                "title": "🌐 Stream Started Successfully",
                "body": (
                    "The stock data stream started successfully. "
                ),
                "data": {
                    "type": "stream_start",
                    "status": "success",
                    "screen": "home",
                    "timestamp": self.get_current_et_time().isoformat()
                },
                "badge": 1,
                "priority": "high",
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
                f"Stream failure notifications sent: "
                f"{successful} successful, {failed} failed"
            )

        except Exception as e:
            logger.error(f"Error sending stream failure notification: {e}", exc_info=True)
    async def stop_stream(self):
        """
        Stop the WebSocket stream with proper cleanup.
        
        Order of operations:
        1. Cancel the stream task first to stop the WebSocket connection
        2. Then try to unsubscribe (this is safer and avoids hanging on unsubscribe)
        3. Finally close the stream connection
        """
        if not self._stream_started:
            logger.info("Stream was never started, skipping cleanup")
            return

        try:
            # Cancel the stream monitoring task if it exists
            if self._stream_monitor_task is not None:
                logger.info("Cancelling stream monitoring task")
                self._stream_monitor_task.cancel()
                try:
                    await self._stream_monitor_task
                except asyncio.CancelledError:
                    logger.info("Stream monitoring task cancelled successfully")
                except Exception as e:
                    logger.error(f"Error cancelling stream monitoring task: {e}")
                finally:
                    self._stream_monitor_task = None

            # Cancel the stream task first to stop the WebSocket connection
            # This helps prevent hanging on unsubscribe operations
            if self._stream_task is not None:
                logger.info("Cancelling stream task")
                self._stream_task.cancel()
                try:
                    # Wait up to 2 seconds for task cancellation
                    await asyncio.wait_for(self._stream_task, timeout=2.0)
                except asyncio.TimeoutError:
                    logger.warning("Stream task cancellation timed out, forcing cleanup")
                except asyncio.CancelledError:
                    logger.info("Stream task cancelled successfully")
                except Exception as e:
                    logger.error(f"Error awaiting stream task cancellation: {e}")
                finally:
                    self._stream_task = None

            # Now try to unsubscribe (with timeout protection)
            await self.unsubscribe_all()

            # Close the stream connection
            if self.stock_stream:
                try:
                    await asyncio.wait_for(
                        self.stock_stream.close(),
                        timeout=5.0
                    )
                    logger.info("Stock stream connection closed")
                except asyncio.TimeoutError:
                    logger.warning("Stream close timed out, continuing cleanup")
                except Exception as e:
                    logger.error(f"Error closing stock stream: {e}")

            self._stream_started = False
            self.stock_stream = None
            self._stream_start_time = None
            self._bars_received_at_start = 0

        except Exception as e:
            logger.error(f"Error stopping stream: {e}", exc_info=True)

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