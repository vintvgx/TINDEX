"""
ORB (Opening Range Breakout) Service

This service handles all ORB-related business logic:
- ORB calculation (9:30-9:45 AM window)
- Breakout detection and confirmation
- Notifications (push notifications via Expo)
- Database operations (saving/loading ORB ranges, monitoring state)
- Service lifecycle management

Architecture:
- Uses StockStreamingService interface (can work with Alpaca or Tradier)
- Separated from streaming concerns (streaming services only handle data flow)
- Handles all ORB-specific business logic
- Maintains state and coordinates between streaming and notifications

Design Pattern:
- Service layer pattern
- Dependency injection (streaming service passed in constructor)
- Clear separation of concerns
"""

import asyncio
from decimal import Decimal
import os
from typing import Dict, Set, Optional, Callable
import pytz
from datetime import date, datetime, time, timedelta
import logging
import aiohttp
import pandas as pd

from supabase import create_client, Client
import yfinance as yf

from alpaca.data.models import Bar

from services.utils.stock_streaming_base import StockStreamingService, StockBar
from services.utils.breakout_confirmation import BreakoutConfirmation
from services.utils.monitoring_state_cache import MonitoringStateCache, MonitoringState
from services.utils.orb_data_hub import get_orb_data_hub, OrbBar, OrbStatus
from services.gap_analysis_service import get_gap_analysis_service, compute_gap_context

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Tickers the strategy engines always need streamed, regardless of user follows.
# These are integral to the ORB trading engine, so the service hardcodes them as
# always-followed and publishes their bars/ORB status to the engines via the hub.
STRATEGY_CORE_TICKERS = frozenset({"SPY", "QQQ", "IWM"})


class OrbService:
    """
    ORB (Opening Range Breakout) monitoring service.
    
    This service coordinates ORB calculation, breakout detection, and notifications.
    It uses a streaming service (Alpaca or Tradier) for real-time data but handles
    all ORB-specific business logic separately.
    
    Architecture:
    - Dependency injection: accepts StockStreamingService in constructor
    - Handles ORB calculation periods (9:30-9:45 AM)
    - Monitors breakouts and sends notifications
    - Manages database state and monitoring lifecycle
    
    Usage:
        # With Alpaca
        alpaca_stream = AlpacaStreamingService()
        orb_service = OrbService(alpaca_stream)
        await orb_service.start(debug_mode=False)
        
        # With Tradier
        tradier_stream = TradierStreamingService()
        orb_service = OrbService(tradier_stream)
        await orb_service.start(debug_mode=False)
    """
    
    def __init__(self, streaming_service: StockStreamingService):
        """
        Initialize ORB service with a streaming service.
        
        Args:
            streaming_service: Instance of StockStreamingService (Alpaca or Tradier)
        """
        self.streaming_service = streaming_service
        
        # Supabase setup
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("Supabase credentials not defined")
        
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)

        # ORB data hub: publishes bars + ORB status to the strategy engines.
        # Single coupling point so the engines never re-fetch market data.
        self._hub = get_orb_data_hub()

        # Initialize monitoring state cache
        self._state_cache = MonitoringStateCache(
            supabase=self.supabase,
            sync_interval=5.0,
            max_batch_size=50,
        )
        
        # Market timezone
        self.et_timezone = pytz.timezone("America/New_York")
        
        # Market hours
        self.market_open = time(9, 15)
        self.orb_end = time(9, 45)
        self.market_close = time(16, 0)
        
        # ORB tracking
        self.orb_ranges: Dict[str, Dict] = {}
        # Legacy monitoring state dict (kept for backward compatibility)
        # This tracks high_broken/low_broken flags locally
        self.monitoring_state: Dict[str, Dict] = {}
        self.active_tickers: Set[str] = set()
        
        # Service state
        self.is_running = False
        self.calculation_phase = False
        self._debug_mode = False
        self._bars_received_count = 0
        # Gap analysis: prefetch at ~9:25 AM ET once per trade date
        self._gap_prefetch_date: Optional[date] = None
        # Periodic ticker list refresh (re-load from DB so add/remove tickers takes effect)
        self._last_ticker_refresh_at: Optional[datetime] = None
        
        # Expo push URL
        self.expo_push_url = "https://exp.host/--/api/v2/push/send"
        
        # Breakout confirmation timers: {ticker: asyncio.Task}
        self._confirmation_timers: Dict[str, asyncio.Task] = {}
    
        # Bar history for VWAP calculation and reversal detection
        # {ticker: [StockBar, ...]} - stores recent bars (max 100 bars per ticker)
        self._bar_history: Dict[str, list] = {}
        self._max_bar_history = 100  # Keep last 100 bars for VWAP calculation
        
        # Previous close cache: {ticker: {"previous_close": float, "data_source": str}}
        # Cached during calculation period to avoid repeated API calls
        self._previous_close_cache: Dict[str, Dict] = {}
        
        # Track bar handling tasks for proper cleanup
        self._bar_tasks: Set[asyncio.Task] = set()
        
        # Reversal scoring state: populated after a breakout is confirmed (3-min timer).
        # Each bar after confirmation updates the score; when score >= threshold the
        # reversal entry signal is published to the hub.
        # {ticker: {
        #   "direction": "CALL"|"PUT",    original breakout direction
        #   "score": int,                 current total score (len of signals_hit)
        #   "signals_hit": set[str],      unique signal names that have fired
        #   "max_extension": float,       max distance past ORH/ORL since confirmed
        #   "consec_wrong_side": int,     consecutive bars closing on wrong side of level
        #   "bars_counted": int,          bars evaluated since confirmation
        #   "fired": bool,                True after entry published (prevents re-fire)
        # }}
        self._rev_state: Dict[str, Dict] = {}
        # Minimum composite score (out of 5) required to fire a reversal entry.
        self._reversal_fire_threshold = 3
    
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
            
            # Always include the strategy engine core tickers (SPY/QQQ/IWM) so the
            # service streams them and publishes their data to the engines even when
            # no user follows them.
            tickers = {row["ticker"] for row in response.data} | set(STRATEGY_CORE_TICKERS)
            logger.info(f"Loaded {len(tickers)} tickers for ORB monitoring: {list(tickers)}")
            return tickers
        except Exception as e:
            logger.error(f"Error loading followed stocks: {e}")
            # Still return the core tickers so engines keep receiving data on DB errors.
            return set(STRATEGY_CORE_TICKERS)
    
    async def fetch_orb_range_historical(self, ticker: str) -> Optional[Dict]:
        """
        Fetch ORB range using yfinance historical data (9:30-9:45 AM window).
        
        Uses yfinance instead of provider APIs for consistency and free access
        to intraday minute data for the current day.
        """
        try:
            today = self.get_current_et_time().date()
            
            logger.info(f"Fetching historical bars for {ticker} from yfinance for {today}")
            
            loop = asyncio.get_event_loop()
            
            def fetch_yfinance_data():
                stock = yf.Ticker(ticker)
                hist = stock.history(period="1d", interval="1m")
                return hist
            
            hist = await loop.run_in_executor(None, fetch_yfinance_data)
            
            if hist is None or hist.empty:
                logger.warning(f"No yfinance data returned for {ticker} - market may be closed")
                return None
            
            logger.info(f"yfinance returned {len(hist)} bars for {ticker}")
            if not hist.empty:
                logger.info(f"  Time range: {hist.index[0]} to {hist.index[-1]}")
            
            # Filter to ORB window (9:30-9:45 AM ET)
            orb_start_time = self.market_open
            orb_end_time = self.orb_end
            
            orb_bars = []
            for idx, row in hist.iterrows():
                bar_time = idx.time()
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
            opening_price = Decimal(str(orb_bars[0]['open']))
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
        
        if self.is_orb_calculation_period():
            logger.info("Still in ORB calculation period, using real-time data")
            return
        
        if current_time < self.market_open:
            logger.info("Before market open, no ORB ranges to fetch")
            return
        
        tickers = await self.load_followed_stocks()
        if not tickers:
            logger.warning("No tickers to ensure ORB ranges for")
            return
        
        logger.info(f"Ensuring ORB ranges for {len(tickers)} tickers...")
        
        for ticker in tickers:
            if ticker in self.orb_ranges:
                logger.info(f"  {ticker}: Already in memory")
                continue
            
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

    async def _run_gap_prefetch_background(
        self, tickers: Set[str], trade_date: date
    ) -> None:
        """
        Run gap prior-day OHLC fetch in the background; update _gap_prefetch_date
        when done. Exceptions are caught and logged so they do not affect the
        caller. Used so subscribe/start_stream are not delayed by yfinance prefetch.
        """
        try:
            count = await get_gap_analysis_service().fetch_and_cache_prior_day_ohlc(
                list(tickers), trade_date
            )
            if count > 0:
                self._gap_prefetch_date = trade_date
                logger.info(
                    "[GAP] Pre-fetch done for %d/%d tickers (trade_date=%s)",
                    count, len(tickers), trade_date,
                )
        except Exception as e:
            logger.exception("Gap pre-fetch background task failed: %s", e)

    async def save_orb_range(self, ticker: str, data: Dict):
        """Save calculated ORB range to database."""
        try:
            trade_date = self.get_current_et_time().date()
            
            orb_high = float(data["high"]) if isinstance(data["high"], Decimal) else data["high"]
            orb_low = float(data["low"]) if isinstance(data["low"], Decimal) else data["low"]
            # Convert opening_price to float if present, otherwise None (not 0)
            # Avoid persisting ambiguous zero values - use None instead
            opening_price_raw = data.get("open")
            if opening_price_raw is not None:
                opening_price = float(opening_price_raw) if isinstance(opening_price_raw, Decimal) else opening_price_raw
                # Set to None if equals 0 to avoid ambiguous sentinel value
                opening_price = opening_price if opening_price != 0 else None
            else:
                opening_price = None
            volume = int(data.get("volume", 0))
            
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
                "opening_price": opening_price,  # Now None instead of 0 when missing/invalid
            }
            
            # Merge gap/trend context when we have prior-day cache and today_open
            today_open_float = float(opening_price) if opening_price is not None else None
            if today_open_float and today_open_float > 0:
                prior = get_gap_analysis_service().get_cached_prior(ticker, trade_date)
                if prior:
                    gap_ctx = compute_gap_context(
                        prior["prior_close"],
                        prior["prior_day_open"],
                        today_open_float,
                    )
                    orb_record["prior_close"] = gap_ctx["prior_close"]
                    orb_record["today_open"] = gap_ctx["today_open"]
                    orb_record["gap_points"] = gap_ctx["gap_points"]
                    orb_record["gap_percent"] = gap_ctx["gap_percent"]
                    orb_record["gap_direction"] = gap_ctx["gap_direction"]
                    orb_record["prior_day_open"] = gap_ctx["prior_day_open"]
                    orb_record["prior_day_trend"] = gap_ctx["prior_day_trend"]
                    orb_record["trend_continuation"] = gap_ctx["trend_continuation"]
                    # Keep in memory for record_breakout / notifications
                    if ticker in self.orb_ranges:
                        self.orb_ranges[ticker]["gap_percent"] = gap_ctx["gap_percent"]
                        self.orb_ranges[ticker]["gap_points"] = gap_ctx["gap_points"]
                        self.orb_ranges[ticker]["gap_direction"] = gap_ctx["gap_direction"]
                        self.orb_ranges[ticker]["prior_day_trend"] = gap_ctx["prior_day_trend"]
                        self.orb_ranges[ticker]["trend_continuation"] = gap_ctx["trend_continuation"]
            
            self.supabase.table("orb_ranges").upsert(orb_record).execute()
            
            # Determine current_price: prefer real last trade/close value if available
            # Check previous_close_cache for a valid previous close value
            current_price = None
            if ticker in self._previous_close_cache:
                previous_close = self._previous_close_cache[ticker].get("previous_close")
                if previous_close and previous_close > 0:
                    current_price = previous_close
                    logger.debug(f"Using previous_close as current_price for {ticker}: {current_price}")
            
            # Update cache state (no database call - cached)
            self._state_cache.update_state(
                ticker=ticker,
                trade_date=trade_date,
                opening_price=opening_price,  # Now None instead of 0 when missing/invalid
                orb_high=orb_high,
                orb_low=orb_low,
                current_price=current_price,  # None instead of orb_high, or previous_close if available
                volume=volume,
                breakout_type="none",
                breakout_price=None,
                high_broken=False,
                low_broken=False,
                monitoring_active=True,
                timestamp=self.get_current_et_time().isoformat(),
            )
            
            logger.info(f"[DB SAVE] Saved ORB range for {ticker}: High={orb_high}, Low={orb_low}")
            
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
            
            # First, build a mapping of ticker -> opening_price from orb_monitoring_state
            # This will be used to fill missing opening_price values
            state_response = (
                self.supabase.table("orb_monitoring_state")
                .select("*")
                .eq("trade_date", str(trade_date))
                .eq("monitoring_active", True)
                .execute()
            )
            
            # Create a mapping of ticker -> opening_price from monitoring_state
            opening_price_from_state = {}
            for row in state_response.data:
                ticker = row["ticker"]
                opening_price = row.get("opening_price")
                if opening_price is not None:
                    opening_price_from_state[ticker] = opening_price
                self.monitoring_state[ticker] = {
                    "high_broken": row["high_broken"],
                    "low_broken": row["low_broken"],
                }
            
            # Load orb_ranges and populate opening_price, using monitoring_state as fallback
            for row in response.data:
                ticker = row["ticker"]
                opening_price = row.get("opening_price")
                
                # If opening_price is None (no longer using 0 as sentinel), try to get it from monitoring_state
                if opening_price is None:
                    if ticker in opening_price_from_state:
                        opening_price = opening_price_from_state[ticker]
                        logger.debug(f"Using opening_price from monitoring_state for {ticker}: {opening_price}")
                    else:
                        opening_price = None
                        logger.warning(f"No opening_price found for {ticker} in orb_ranges or monitoring_state")
                # Handle legacy 0 values (shouldn't happen with new code, but for backward compatibility)
                elif opening_price == 0:
                    logger.debug(f"Found legacy 0 opening_price for {ticker}, treating as None")
                    if ticker in opening_price_from_state:
                        opening_price = opening_price_from_state[ticker]
                        logger.debug(f"Using opening_price from monitoring_state for {ticker}: {opening_price}")
                    else:
                        opening_price = None
                
                # Convert opening_price to Decimal, handling None case
                opening_price_decimal = Decimal(str(opening_price)) if opening_price is not None else None
                
                orb_entry = {
                    "high": Decimal(str(row["orb_high"])),
                    "low": Decimal(str(row["orb_low"])),
                    "open": opening_price_decimal,  # Now properly handles None
                    "volume": row.get("volume_in_range", 0),
                }
                if row.get("gap_percent") is not None:
                    orb_entry["gap_percent"] = row["gap_percent"]
                    orb_entry["gap_points"] = row.get("gap_points")
                    orb_entry["gap_direction"] = row.get("gap_direction")
                    orb_entry["prior_day_trend"] = row.get("prior_day_trend")
                    orb_entry["trend_continuation"] = row.get("trend_continuation")
                self.orb_ranges[ticker] = orb_entry
            
            logger.info(f"Loaded {len(self.orb_ranges)} ORB ranges from DB")
            
        except Exception as e:
            logger.error(f"Error loading ORB ranges: {e}", exc_info=True)
    
    def _handle_bar_task_done(self, task: asyncio.Task):
        """
        Done callback for bar handling tasks.
        
        Logs exceptions and removes the task from the tracking set.
        This ensures exceptions don't go silent and tasks are properly cleaned up.
        
        Args:
            task: The completed asyncio.Task
        """
        try:
            # Remove from tracking set
            self._bar_tasks.discard(task)
            
            # Check for exceptions and log them
            if task.cancelled():
                logger.debug("Bar handling task was cancelled")
            elif task.exception():
                logger.error(
                    f"Exception in bar handling task: {task.exception()}",
                    exc_info=task.exception()
                )
        except Exception as e:
            # Don't let the callback itself raise exceptions
            logger.error(f"Error in bar task done callback: {e}", exc_info=True)
    
    def _create_bar_handler_wrapper(self) -> Callable[[StockBar], None]:
        """
        Create a synchronous wrapper for the async handle_bar method.
        
        This wrapper:
        - Schedules handle_bar as an asyncio task
        - Tracks the task in _bar_tasks for cleanup
        - Attaches _handle_bar_task_done callback for exception handling
        
        Returns:
            A synchronous callable that can be passed to streaming service subscribe()
        """
        def handle_bar_sync(bar: StockBar):
            task = asyncio.create_task(self.handle_bar(bar))
            self._bar_tasks.add(task)
            task.add_done_callback(self._handle_bar_task_done)
        
        return handle_bar_sync
    
    async def _fetch_previous_close(self, ticker: str) -> Dict[str, Optional[float | str]]:
        """
        Fetch previous day's closing price.
        
        Strategy:
        1. Try yfinance first (most reliable and up-to-date)
        2. Fallback to supabase (orb_monitoring_state from previous day)
        
        Returns:
            Dict with previous_close and data_source
        """
        try:
            loop = asyncio.get_event_loop()
            
            def fetch_from_yfinance():
                try:
                    stock = yf.Ticker(ticker)
                    info = stock.info
                    previous_close = info.get("previousClose")
                    if previous_close and previous_close > 0:
                        return {"previous_close": float(previous_close), "data_source": "yfinance"}
                except Exception as e:
                    logger.warning(f"Could not fetch previous close from yfinance for {ticker}: {e}")
                return None
            
            # Try yfinance first
            yfinance_result = await loop.run_in_executor(None, fetch_from_yfinance)
            if yfinance_result and yfinance_result.get("previous_close"):
                logger.info(f"[PREVIOUS CLOSE] {ticker}: ${yfinance_result['previous_close']:.2f} from yfinance")
                return yfinance_result
            
                # Fallback to supabase - get previous day's closing price
            try:
                trade_date = self.get_current_et_time().date()
                
                # Try to find previous trading day (skip weekends)
                max_days_back = 5  # Look back up to 5 days to find last trading day
                for days_back in range(1, max_days_back + 1):
                    check_date = trade_date - timedelta(days=days_back)
                    response = (
                        self.supabase.table("orb_monitoring_state")
                        .select("current_price")
                        .eq("ticker", ticker)
                        .eq("trade_date", str(check_date))
                        .order("timestamp", desc=True)
                        .limit(1)
                        .execute()
                    )
                    
                    if response.data and len(response.data) > 0:
                        previous_close = response.data[0].get("current_price")
                        if previous_close and previous_close > 0:
                            logger.info(f"[PREVIOUS CLOSE] {ticker}: ${previous_close:.2f} from supabase (date: {check_date})")
                            return {
                                "previous_close": float(previous_close),
                                "data_source": "supabase"
                            }
                
                logger.warning(f"Could not find previous close for {ticker} in supabase")
            except Exception as e:
                logger.warning(f"Error fetching previous close from supabase for {ticker}: {e}")
            
            return {"previous_close": None, "data_source": None}
            
        except Exception as e:
            logger.error(f"Error fetching previous close for {ticker}: {e}")
            return {"previous_close": None, "data_source": None}
    
    async def _fetch_market_data(self, ticker: str) -> Dict[str, Optional[float]]:
        """Fetch market data needed for breakout confirmation (VWAP, ATR, avg volume)."""
        try:
            loop = asyncio.get_event_loop()
            
            def fetch_data():
                stock = yf.Ticker(ticker)
                info = stock.info
                avg_volume = info.get("averageVolume", 0) or info.get("averageVolume10days", 0) or 0
                
                try:
                    intraday = stock.history(period="1d", interval="1m")
                    vwap = None
                    if not intraday.empty and len(intraday) > 0:
                        typical_price = (intraday['High'] + intraday['Low'] + intraday['Close']) / 3
                        total_volume = intraday['Volume'].sum()
                        if total_volume > 0:
                            vwap = float((typical_price * intraday['Volume']).sum() / total_volume)
                except Exception as e:
                    logger.warning(f"Could not calculate VWAP for {ticker}: {e}")
                    vwap = None
                
                try:
                    daily = stock.history(period="14d", interval="1d")
                    atr = None
                    if not daily.empty and len(daily) >= 14:
                        high_low = daily['High'] - daily['Low']
                        high_close = abs(daily['High'] - daily['Close'].shift(1))
                        low_close = abs(daily['Low'] - daily['Close'].shift(1))
                        true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
                        atr = float(true_range.tail(14).mean())
                except Exception as e:
                    logger.warning(f"Could not calculate ATR for {ticker}: {e}")
                    atr = None
                
                return {"avg_volume": float(avg_volume), "vwap": vwap, "atr": atr}
            
            return await loop.run_in_executor(None, fetch_data)
            
        except Exception as e:
            logger.error(f"Error fetching market data for {ticker}: {e}")
            return {"avg_volume": 0.0, "vwap": None, "atr": None}
    
    def _calculate_vwap_from_bars(self, bars: list) -> Optional[float]:
        """
        Calculate VWAP from a list of bars.
        
        VWAP = sum(typical_price * volume) / sum(volume)
        where typical_price = (high + low + close) / 3
        
        Args:
            bars: List of StockBar objects
            
        Returns:
            VWAP value or None if insufficient data
        """
        if not bars or len(bars) == 0:
            return None
        
        total_price_volume = Decimal(0)
        total_volume = 0
        
        for bar in bars:
            # Only calculate typical_price when all three price fields are present
            # Price fields (high/low/close) are now optional (Decimal | None)
            if bar.high is None or bar.low is None or bar.close is None:
                # Skip bars with missing price data
                continue
            
            typical_price = (bar.high + bar.low + bar.close) / Decimal(3)
            total_price_volume += typical_price * Decimal(bar.volume)
            total_volume += bar.volume
        
        if total_volume == 0:
            return None
        
        vwap = float(total_price_volume / Decimal(total_volume))
        return vwap
    
    def _update_bar_history(self, ticker: str, bar: StockBar):
        """
        Update bar history for a ticker, maintaining max history size.
        
        Args:
            ticker: Stock ticker symbol
            bar: StockBar to add to history
        """
        if ticker not in self._bar_history:
            self._bar_history[ticker] = []
        
        self._bar_history[ticker].append(bar)
        
        # Keep only the most recent bars
        if len(self._bar_history[ticker]) > self._max_bar_history:
            self._bar_history[ticker] = self._bar_history[ticker][-self._max_bar_history:]
    
    def _score_reversal(
        self,
        ticker: str,
        current_bar: StockBar,
        original_direction: str,  # "CALL" (breakout above ORH) or "PUT" (breakout below ORL)
        orb_high: Decimal,
        orb_low: Decimal,
    ) -> Dict:
        """
        Score the current bar's contribution to a potential reversal.

        State is accumulated in self._rev_state[ticker] across consecutive bars.
        Each of 6 distinct signals can fire at most once per breakout episode
        (tracked in signals_hit set), so no single dimension can dominate the score.
        Effective score = len(signals_hit) - penalty.  Fire when effective_score >= threshold (3).

        Signals (+score):
          level_violated    — bar closes on wrong side of ORH (CALL) / ORL (PUT)
          sustained_press   — 2+ consecutive closes on wrong side
          weak_extension    — max extension past key level < 0.25% after ≥3 bars
          momentum_shift    — lower high (CALL→PUT) / higher low (PUT→CALL) while wrong-side
          volume_surge      — current bar volume > 1.5× 5-bar avg
          deep_violation    — close ≥ 0.3% past key level (strong conviction bar)

        Penalties (-score, recalculated each bar):
          bounce_penalty    — price recovers ≥ 0.3% from worst wrong-side close
          recovery_bars     — 2+ consecutive wrong-side closes moving back toward key

        Returns {"score": int, "signals": list[str], "fire": bool}
        """
        state = self._rev_state.get(ticker)
        if state is None or state.get("fired"):
            return {"score": 0, "signals": [], "fire": False}

        if current_bar.close is None:
            return {"score": state["score"], "signals": list(state["signals_hit"]), "fire": False}

        current_close = float(current_bar.close)
        orh = float(orb_high)
        orl = float(orb_low)
        key_level = orh if original_direction == "CALL" else orl

        # Track max extension past the key level since the breakout was confirmed.
        extension = (current_close - key_level) if original_direction == "CALL" else (key_level - current_close)
        if extension > state["max_extension"]:
            state["max_extension"] = extension

        state["bars_counted"] += 1
        signals_hit: set = state["signals_hit"]

        # Determine if this bar closed on the wrong side of the key level
        wrong_side = (
            (original_direction == "CALL" and current_close < key_level) or
            (original_direction == "PUT"  and current_close > key_level)
        )

        # ── Signal 1: Level violated ─────────────────────────────────────────────
        if wrong_side:
            state["consec_wrong_side"] += 1
            if "level_violated" not in signals_hit:
                signals_hit.add("level_violated")
                logger.debug(
                    "[REV %s] +level_violated: close %.2f %s key %.2f",
                    ticker, current_close,
                    "below ORH" if original_direction == "CALL" else "above ORL",
                    key_level,
                )
        else:
            state["consec_wrong_side"] = 0

        # ── Signal 2: Sustained pressure (2+ consecutive wrong-side closes) ──────
        if state["consec_wrong_side"] >= 2 and "sustained_press" not in signals_hit:
            signals_hit.add("sustained_press")
            logger.debug(
                "[REV %s] +sustained_press: %d consecutive closes on wrong side",
                ticker, state["consec_wrong_side"],
            )

        # ── Signal 3: Weak extension (confirmed breakout barely moved) ────────────
        if (
            state["bars_counted"] >= 3
            and state["max_extension"] < key_level * 0.0025
            and "weak_extension" not in signals_hit
        ):
            signals_hit.add("weak_extension")
            logger.debug(
                "[REV %s] +weak_extension: max extension %.4f (< 0.25%% of %.2f)",
                ticker, state["max_extension"], key_level,
            )

        # ── Signal 4: Momentum shift (lower high / higher low while wrong-side) ──
        bar_history = self._bar_history.get(ticker, [])
        if len(bar_history) >= 2 and wrong_side and "momentum_shift" not in signals_hit:
            prev_bar = bar_history[-2]  # bar_history[-1] is current (already appended)
            if original_direction == "CALL":
                if (prev_bar.high is not None and current_bar.high is not None
                        and float(current_bar.high) <= float(prev_bar.high)):
                    signals_hit.add("momentum_shift")
                    logger.debug(
                        "[REV %s] +momentum_shift: lower high %.2f ≤ %.2f",
                        ticker, float(current_bar.high), float(prev_bar.high),
                    )
            else:
                if (prev_bar.low is not None and current_bar.low is not None
                        and float(current_bar.low) >= float(prev_bar.low)):
                    signals_hit.add("momentum_shift")
                    logger.debug(
                        "[REV %s] +momentum_shift: higher low %.2f ≥ %.2f",
                        ticker, float(current_bar.low), float(prev_bar.low),
                    )

        # ── Signal 5: Volume surge ────────────────────────────────────────────────
        if len(bar_history) >= 5 and "volume_surge" not in signals_hit:
            recent_vols = [b.volume for b in bar_history[-6:-1] if b.volume]
            if recent_vols:
                avg_vol = sum(recent_vols) / len(recent_vols)
                if avg_vol > 0 and current_bar.volume > avg_vol * 1.5:
                    signals_hit.add("volume_surge")
                    logger.debug(
                        "[REV %s] +volume_surge: %d vs avg %.0f",
                        ticker, current_bar.volume, avg_vol,
                    )

        # ── Signal 6: Deep violation (close ≥ 0.3% past key level) ──────────────
        if wrong_side and "deep_violation" not in signals_hit:
            violation = (
                (key_level - current_close) if original_direction == "CALL"
                else (current_close - key_level)
            )
            if violation >= key_level * 0.003:
                signals_hit.add("deep_violation")
                logger.debug(
                    "[REV %s] +deep_violation: %.2f is %.3f%% past key %.2f",
                    ticker, current_close, (violation / key_level) * 100, key_level,
                )

        # ── Track worst wrong-side close ──────────────────────────────────────────
        if wrong_side:
            if state["worst_wrong_close"] is None:
                state["worst_wrong_close"] = current_close
            elif original_direction == "CALL":
                state["worst_wrong_close"] = min(state["worst_wrong_close"], current_close)
            else:
                state["worst_wrong_close"] = max(state["worst_wrong_close"], current_close)

        # ── Track consecutive recovering closes (wrong-side bars moving back toward key) ──
        if wrong_side and state["prev_wrong_close"] is not None:
            recovering = (
                (original_direction == "CALL" and current_close > state["prev_wrong_close"]) or
                (original_direction == "PUT"  and current_close < state["prev_wrong_close"])
            )
            state["consec_recovery"] = state["consec_recovery"] + 1 if recovering else 0
        elif not wrong_side:
            state["consec_recovery"] = 0

        if wrong_side:
            state["prev_wrong_close"] = current_close

        # ── Penalty: reduce effective score when price shows recovery intent ───────
        # Recalculated fresh each bar so score auto-heals if reversal resumes.
        penalty = 0

        if wrong_side and state["worst_wrong_close"] is not None:
            worst = state["worst_wrong_close"]
            bounce_pct = (
                (current_close - worst) / worst if original_direction == "CALL"
                else (worst - current_close) / worst
            ) if worst > 0 else 0
            if bounce_pct >= 0.003:
                penalty += 1
                logger.debug(
                    "[REV %s] penalty +1 (bounce): %.2f%% recovery from worst %.2f",
                    ticker, bounce_pct * 100, worst,
                )

        if state["consec_recovery"] >= 2:
            penalty += 1
            logger.debug(
                "[REV %s] penalty +1 (recovery bars): %d consecutive closes recovering",
                ticker, state["consec_recovery"],
            )

        effective_score = max(len(signals_hit) - penalty, 0)
        state["score"] = effective_score

        # ── Minimum boundary-distance gate ────────────────────────────────────────
        # A high signal score doesn't by itself mean the failed breakout traveled
        # far enough from the ORH/ORL level to be a real reversal rather than
        # chop right at the boundary. Require the worst wrong-side close to have
        # penetrated at least 20% of the opening-range width past the key level.
        orb_range = orh - orl
        worst = state["worst_wrong_close"]
        penetration = abs(key_level - worst) if worst is not None else 0.0
        min_penetration = orb_range * 0.20 if orb_range > 0 else 0.0
        cleared_boundary_buffer = penetration >= min_penetration

        fire = effective_score >= self._reversal_fire_threshold and cleared_boundary_buffer
        if effective_score >= self._reversal_fire_threshold and not cleared_boundary_buffer:
            logger.debug(
                "[REV %s] fire suppressed: penetration %.4f < min %.4f (20%% of range %.4f)",
                ticker, penetration, min_penetration, orb_range,
            )

        return {"score": effective_score, "signals": list(signals_hit), "fire": fire}
    
    def _publish_bar_to_hub(self, stock_bar: StockBar):
        """
        Convert a StockBar to the provider-neutral OrbBar and publish it on the
        hub for the strategy engines. Uses the real bar timestamp when present
        (converted to ET) so engines align their opening-range window correctly;
        falls back to arrival time otherwise. Never raises into the bar pipeline.
        """
        try:
            ts = stock_bar.timestamp
            if ts is not None:
                ts = ts.astimezone(self.et_timezone) if ts.tzinfo else self.et_timezone.localize(ts)
            else:
                ts = self.get_current_et_time()

            self._hub.publish_bar(OrbBar(
                ticker=stock_bar.symbol,
                ts=ts,
                open=float(stock_bar.open) if stock_bar.open is not None else None,
                high=float(stock_bar.high) if stock_bar.high is not None else None,
                low=float(stock_bar.low) if stock_bar.low is not None else None,
                close=float(stock_bar.close) if stock_bar.close is not None else None,
                volume=int(stock_bar.volume),
            ))
        except Exception as e:
            logger.error(f"Error publishing bar to hub for {stock_bar.symbol}: {e}")

    def _publish_orb_status_to_hub(self, ticker: str, breakout: str = "none",
                                   last_price: Optional[float] = None):
        """
        Publish an ORB status snapshot for a ticker (informational/diagnostics).
        Engines derive their own ORH/ORL from bars; this exposes the service's
        view (and breakout state) via hub.get_status() for observability.
        """
        try:
            data = self.orb_ranges.get(ticker, {})
            orb_high = data.get("high")
            orb_low = data.get("low")
            orb_high_f = float(orb_high) if orb_high is not None else None
            orb_low_f = float(orb_low) if orb_low is not None else None
            opening = data.get("open")
            opening_f = float(opening) if opening is not None else None
            phase = "calculating" if self.calculation_phase else (
                "ready" if orb_high_f is not None else "pre_open"
            )
            self._hub.publish_orb_status(OrbStatus(
                ticker=ticker,
                session_date=self.get_current_et_time().date(),
                orh=orb_high_f,
                orl=orb_low_f,
                orb_range=(orb_high_f - orb_low_f) if (orb_high_f is not None and orb_low_f is not None) else None,
                vwap=self._calculate_vwap_from_bars(self._bar_history.get(ticker, [])),
                opening_price=opening_f,
                phase=phase,
                breakout=breakout,
                last_price=last_price,
                updated_at=self.get_current_et_time(),
            ))
        except Exception as e:
            logger.error(f"Error publishing ORB status to hub for {ticker}: {e}")

    async def handle_bar(self, stock_bar: StockBar):
        """
        Handle incoming bar data from streaming service.
        
        This method processes bars during both ORB calculation phase and monitoring phase.
        Adapted to work with standardized StockBar instead of provider-specific bar types.
        
        Note: Price fields (open/high/low/close) are now optional (Decimal | None).
        This method guards against None values and skips processing if critical fields are missing.
        """
        ticker = stock_bar.symbol
        bar_high = stock_bar.high
        bar_low = stock_bar.low
        bar_close = stock_bar.close
        bar_open = stock_bar.open
        bar_volume = stock_bar.volume
        
        # Debug: Log bar received
        self._bars_received_count += 1
        if self._bars_received_count <= 5 or self._bars_received_count % 10 == 0:
            logger.info(
                f"[BAR #{self._bars_received_count}] {ticker}: "
                f"O={bar_open} H={bar_high} L={bar_low} C={bar_close} V={bar_volume}"
            )

        # Publish the raw bar to the hub so the strategy engines receive it.
        # Engines window their own ORB from these bars (no second data feed).
        self._publish_bar_to_hub(stock_bar)

        if self.calculation_phase:
            # ORB is the 09:30–09:45 window ONLY. The stream connects at 09:15 (warm-up)
            # and may deliver pre-market bars; those are published to the hub above for
            # observability but must NOT widen the ORB or set the opening price. Skip any
            # bar timestamped before 09:30 ET so the service ORB matches the engine's
            # fixed 09:30–09:45 window exactly (ORB_WINDOW_MINUTES in orb_engine.py).
            bar_ts = stock_bar.timestamp
            if bar_ts is not None:
                bar_ts = (bar_ts.astimezone(self.et_timezone)
                          if bar_ts.tzinfo else self.et_timezone.localize(bar_ts))
            else:
                bar_ts = self.get_current_et_time()
            if bar_ts.time() < time(9, 30):
                logger.debug(f"[ORB CALC] Skipping pre-09:30 bar for {ticker} (ts={bar_ts.time()})")
                return

            # During ORB calculation, track the TRUE high and low from bar data
            # Require high, low, and close for valid ORB calculation
            # Price fields (high/low/close/open) are now optional (Decimal | None)
            if bar_high is None or bar_low is None or bar_close is None:
                logger.warning(
                    f"[ORB CALC] Skipping {ticker} - missing required price fields "
                    f"(high={bar_high}, low={bar_low}, close={bar_close})"
                )
                return
            
            trade_date = self.get_current_et_time().date()
            
            # Fetch previous close on first bar for this ticker (cache it)
            if ticker not in self._previous_close_cache:
                prev_close_data = await self._fetch_previous_close(ticker)
                self._previous_close_cache[ticker] = prev_close_data
                logger.info(
                    f"[ORB CALC] Cached previous close for {ticker}: "
                    f"${prev_close_data.get('previous_close', 'N/A')} "
                    f"(source: {prev_close_data.get('data_source', 'N/A')})"
                )
            
            previous_close = self._previous_close_cache[ticker].get("previous_close")
            prev_close_data_source = self._previous_close_cache[ticker].get("data_source", "alpaca")
            
            # Calculate percentage change if we have previous close and bar_close is not None
            percentage_change = None
            if previous_close and previous_close > 0 and bar_close is not None:
                current_price_float = float(bar_close)
                price_change = current_price_float - previous_close
                percentage_change = (price_change / previous_close) * 100
            
            if ticker not in self.orb_ranges:
                # Use close as fallback for open if open is None
                opening_price = bar_open if bar_open is not None else bar_close
                self.orb_ranges[ticker] = {
                    "high": bar_high,
                    "low": bar_low,
                    "open": opening_price,  # First bar's open is the opening price
                    "volume": int(bar_volume),
                }
                logger.info(
                    f"[ORB CALC] Started tracking {ticker}: "
                    f"High={bar_high}, Low={bar_low}, Open={opening_price}"
                )
                
                # Initialize monitoring state in cache (NO DATABASE CALL)
                data_source = "alpaca"
                if prev_close_data_source:
                    data_source = f"alpaca,prev_close:{prev_close_data_source}"
                
                opening_price_float = float(opening_price)
                self._state_cache.update_orb_calculation(
                    ticker=ticker,
                    trade_date=trade_date,
                    orb_high=float(bar_high),
                    orb_low=float(bar_low),
                    current_price=float(bar_close),
                    volume=int(bar_volume),
                    opening_price=opening_price_float,
                    previous_close=previous_close,
                    percentage_change=round(percentage_change, 2) if percentage_change is not None else None,
                    timestamp=self.get_current_et_time().isoformat(),
                    data_source=data_source,
                )
            else:
                old_high = self.orb_ranges[ticker]["high"]
                old_low = self.orb_ranges[ticker]["low"]
                
                # Update with bar's high/low, not just close
                # bar_high and bar_low are guaranteed to be not None at this point
                self.orb_ranges[ticker]["high"] = max(old_high, bar_high)
                self.orb_ranges[ticker]["low"] = min(old_low, bar_low)
                self.orb_ranges[ticker]["volume"] = int(self.orb_ranges[ticker]["volume"]) + int(bar_volume)
                
                # Update monitoring state in cache (NO DATABASE CALL)
                data_source = "alpaca"
                if prev_close_data_source:
                    data_source = f"alpaca,prev_close:{prev_close_data_source}"
                
                self._state_cache.update_orb_calculation(
                    ticker=ticker,
                    trade_date=trade_date,
                    orb_high=float(self.orb_ranges[ticker]["high"]),
                    orb_low=float(self.orb_ranges[ticker]["low"]),
                    current_price=float(bar_close),
                    volume=int(self.orb_ranges[ticker]["volume"]),
                    previous_close=previous_close,
                    percentage_change=round(percentage_change, 2) if percentage_change is not None else None,
                    timestamp=self.get_current_et_time().isoformat(),
                    data_source=data_source,
                )
                
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
            
            # Require close for monitoring phase (needed for price comparisons and breakout detection)
            # Price fields (close) are now optional (Decimal | None)
            if bar_close is None:
                logger.warning(
                    f"[MONITORING] Skipping {ticker} - missing required price field (close=None)"
                )
                return
            
            orb_high = self.orb_ranges[ticker]["high"]
            orb_low = self.orb_ranges[ticker]["low"]
            
            # Update bar history for VWAP calculation and reversal detection
            self._update_bar_history(ticker, stock_bar)
            
            # Get opening price for percentage_change calculation
            # opening_price is preloaded and cached in self.orb_ranges[ticker]["open"]
            # during load_orb_ranges(), so no DB call is needed here
            opening_price = self.orb_ranges[ticker].get("open")
            
            # Calculate percentage_change from opening price
            # bar_close is guaranteed to be not None at this point
            current_price = float(bar_close)
            percentage_change = None
            if opening_price and opening_price > 0:
                opening_price_float = float(opening_price) if isinstance(opening_price, Decimal) else opening_price
                price_change = current_price - opening_price_float
                percentage_change = (price_change / opening_price_float) * 100
            
            trade_date = self.get_current_et_time().date()
            
            # Get current state from cache (NO DATABASE CALL)
            cache_state = self._state_cache.get_or_create_state(ticker, trade_date)
            
            # Maintain backward compatibility with monitoring_state dict for breakout tracking
            if ticker not in self.monitoring_state:
                self.monitoring_state[ticker] = {"high_broken": cache_state.high_broken, "low_broken": cache_state.low_broken}
            state = self.monitoring_state[ticker]
            
            # PRIORITY 1: Check if price is currently Bullish (above ORH) or Bearish (below ORL)
            # This takes priority over reversal detection

            # Determine current bullish/bearish status based on price position
            is_above_orb_high = current_price > float(orb_high)
            is_below_orb_low = current_price < float(orb_low)
            is_within_orb = float(orb_low) <= current_price <= float(orb_high)
            
            # Update breakout_type based on current price position (prioritize this)
            breakout_type_to_set = None
            if is_above_orb_high:
                # Price is above ORB high - set to Bullish
                breakout_type_to_set = "Bullish"
                # Mark high as broken if not already
                if not state["high_broken"]:
                    logger.info(
                        f"[BREAKOUT DETECTED] {ticker} above ORB high! "
                        f"Current Price={current_price:.2f}, ORB High={orb_high:.2f}"
                    )
                    await self.record_breakout(ticker, "above", bar_close, bar_data=stock_bar)
            elif is_below_orb_low:
                # Price is below ORB low - set to Bearish
                breakout_type_to_set = "Bearish"
                # Mark low as broken if not already
                if not state["low_broken"]:
                    logger.info(
                        f"[BREAKOUT DETECTED] {ticker} below ORB low! "
                        f"Current Price={current_price:.2f}, ORB Low={orb_low:.2f}"
                    )
                    await self.record_breakout(ticker, "below", bar_close, bar_data=stock_bar)
            elif is_within_orb:
                # Price is within ORB - MUST set to "none" or keep reversal if active
                # Never show Bullish/Bearish when price is within ORB
                # Get current state from cache (NO DATABASE CALL)
                current_state = self._state_cache.get_state(ticker, trade_date)
                
                current_breakout_type = current_state.breakout_type if current_state else None
                
                # If price is within ORB, only keep "reversal" if active, otherwise set to "none"
                # Never keep "Bullish" or "Bearish" when price is within ORB
                if current_breakout_type == "reversal":
                    # Keep reversal state if active
                    breakout_type_to_set = None  # Don't change it
                else:
                    # Set to "none" - price is within ORB, no breakout/reversal
                    breakout_type_to_set = "none"
            
            # Update cache state (NO DATABASE CALL)
            if breakout_type_to_set is not None:
                self._state_cache.update_state(
                    ticker=ticker,
                    trade_date=trade_date,
                    current_price=current_price,
                    orb_high=float(orb_high),
                    orb_low=float(orb_low),
                    breakout_type=breakout_type_to_set,
                    percentage_change=round(percentage_change, 2) if percentage_change is not None else None,
                    timestamp=self.get_current_et_time().isoformat(),
                )
            else:
                self._state_cache.update_price(
                    ticker=ticker,
                    trade_date=trade_date,
                    current_price=current_price,
                    orb_high=float(orb_high),
                    orb_low=float(orb_low),
                    percentage_change=round(percentage_change, 2) if percentage_change is not None else None,
                    timestamp=self.get_current_et_time().isoformat(),
                )
            
            # PRIORITY 2: Reversal scoring — runs every bar once a breakout was
            # confirmed (rev_state is populated by _wait_for_confirmation).
            if ticker in self._rev_state and not self._rev_state[ticker].get("fired"):
                rev = self._rev_state[ticker]
                original_direction = rev["direction"]

                # If price has re-broken above ORH (CALL) or below ORL (PUT), the
                # original breakout is resuming — reset all scoring state.
                if original_direction == "CALL" and current_price > float(orb_high):
                    rev["signals_hit"].clear()
                    rev["consec_wrong_side"] = 0
                    rev["score"] = 0
                    rev["worst_wrong_close"] = None
                    rev["prev_wrong_close"]  = None
                    rev["consec_recovery"]   = 0
                    logger.debug("[REV] %s price re-broke above ORH — reversal state reset", ticker)
                elif original_direction == "PUT" and current_price < float(orb_low):
                    rev["signals_hit"].clear()
                    rev["consec_wrong_side"] = 0
                    rev["score"] = 0
                    rev["worst_wrong_close"] = None
                    rev["prev_wrong_close"]  = None
                    rev["consec_recovery"]   = 0
                    logger.debug("[REV] %s price re-broke below ORL — reversal state reset", ticker)
                else:
                    result = self._score_reversal(
                        ticker=ticker,
                        current_bar=stock_bar,
                        original_direction=original_direction,
                        orb_high=orb_high,
                        orb_low=orb_low,
                    )

                    if result["fire"]:
                        reversal_direction = "PUT" if original_direction == "CALL" else "CALL"
                        rev["fired"] = True  # prevent re-fire before state is cleaned up

                        # Publish to hub FIRST — trade timing is critical.
                        self._hub.publish_reversal_confirmed(
                            ticker, reversal_direction, current_price, result["score"]
                        )

                        # Record notification + DB (async; runs after hub publish).
                        try:
                            await self.record_reversal(
                                ticker=ticker,
                                original_breakout_type="above" if original_direction == "CALL" else "below",
                                price=bar_close,
                                reversal_result={
                                    "confidence": (
                                        "HIGH" if result["score"] >= 4 else
                                        "MEDIUM" if result["score"] == 3 else "LOW"
                                    ),
                                    "indicators": result["signals"],
                                },
                                orb_high=orb_high,
                                orb_low=orb_low,
                            )
                        except Exception as e:
                            logger.exception("Error recording reversal for %s: %s", ticker, e)

                        # Reset breakout flags so a fresh breakout can be detected later.
                        # Intentionally NOT resetting breakout_type here — record_reversal()
                        # already set it to "reversal" so the ORB card displays it. The next
                        # bar or a new breakout will naturally overwrite it.
                        if ticker in self.monitoring_state:
                            self.monitoring_state[ticker]["high_broken"] = False
                            self.monitoring_state[ticker]["low_broken"] = False
                        self._state_cache.update_state(
                            ticker=ticker,
                            trade_date=trade_date,
                            high_broken=False,
                            low_broken=False,
                            current_price=current_price,
                            timestamp=self.get_current_et_time().isoformat(),
                        )
                        self._rev_state.pop(ticker, None)
    
    async def record_breakout(self, ticker: str, breakout_type: str, price: Decimal, bar_data: Optional[StockBar] = None):
        """
        Record a breakout event and trigger notifications with enhanced breakout analysis.
        
        Architecture:
        - Evaluates breakout quality using BreakoutConfirmation
        - Fetches market data (VWAP, ATR, avg volume) for scoring
        - Sends initial notification with detailed metrics
        - Starts 3-minute confirmation timer
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
                vwap=vwap if vwap else current_close,
                atr=atr
            )
            
            gap_direction = orb_data.get("gap_direction")
            prior_day_trend = orb_data.get("prior_day_trend")
            trend_continuation = orb_data.get("trend_continuation")
            if gap_direction == "up":
                breakout_aligns_gap = breakout_type == "above"
            elif gap_direction == "down":
                breakout_aligns_gap = breakout_type == "below"
            else:
                breakout_aligns_gap = None
            
            breakout_record = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "breakout_type": breakout_type,
                "breakout_price": breakout_price,
                "breakout_time": self.get_current_et_time().isoformat(),
                "orb_high": orb_high,
                "orb_low": orb_low,
            }
            if orb_data.get("gap_percent") is not None:
                breakout_record["gap_percent"] = orb_data.get("gap_percent")
                breakout_record["gap_direction"] = gap_direction
                breakout_record["prior_day_trend"] = prior_day_trend
                breakout_record["trend_continuation"] = trend_continuation
                breakout_record["breakout_aligns_gap"] = breakout_aligns_gap
            
            gap_context = None
            if gap_direction is not None:
                gap_context = {
                    "gap_percent": orb_data.get("gap_percent"),
                    "gap_points": orb_data.get("gap_points"),
                    "gap_direction": gap_direction,
                    "prior_day_trend": prior_day_trend,
                    "trend_continuation": trend_continuation,
                    "breakout_aligns_gap": breakout_aligns_gap,
                }
            
            logger.info(f"[DB SAVE] Recording breakout: {breakout_record}")
            
            self.supabase.table("orb_breakouts").insert(breakout_record).execute()
            
            # Update monitoring state in cache (NO DATABASE CALL)
            breakout_type_display = "Bullish" if breakout_type == "above" else "Bearish"
            
            # Update monitoring_state dict for backward compatibility
            if ticker not in self.monitoring_state:
                self.monitoring_state[ticker] = {"high_broken": False, "low_broken": False}
            
            if breakout_type == "above":
                self.monitoring_state[ticker]["high_broken"] = True
            else:
                self.monitoring_state[ticker]["low_broken"] = True
            
            # Clear any stale reversal scoring state when a new breakout occurs.
            if ticker in self._rev_state:
                logger.debug("Clearing reversal scoring state for %s due to new breakout", ticker)
                del self._rev_state[ticker]
            
            # Update cache state (NO DATABASE CALL)
            self._state_cache.set_breakout(
                ticker=ticker,
                trade_date=trade_date,
                breakout_type=breakout_type_display,
                breakout_price=breakout_price,
                is_high_broken=(breakout_type == "above"),
                is_low_broken=(breakout_type == "below"),
                timestamp=self.get_current_et_time().isoformat(),
            )
            
            # Publish the breakout state to the hub (informational for engines).
            self._publish_orb_status_to_hub(ticker, breakout=breakout_type, last_price=breakout_price)

            # Send initial notification with enhanced breakout data
            await self.send_notifications(
                ticker,
                breakout_type,
                price,
                breakout_analysis=breakout_analysis,
                orb_high=orb_high,
                orb_low=orb_low,
                gap_context=gap_context,
            )
            
            # Start 3-minute confirmation timer
            if ticker in self._confirmation_timers:
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
    
    async def record_reversal(
        self, 
        ticker: str, 
        original_breakout_type: str, 
        price: Decimal | None,
        reversal_result: Dict,
        orb_high: Decimal,
        orb_low: Decimal
    ):
        """
        Record a reversal event after a breakout and update monitoring state.
        
        Architecture:
        - Updates orb_monitoring_state with reversal information
        - Logs reversal detection with confidence and indicators
        - Sends notification to users about the reversal
        
        Args:
            ticker: Stock ticker symbol
            original_breakout_type: "above" or "below" (original breakout direction)
            price: Current price when reversal detected
            reversal_result: Result from _score_reversal method
            orb_high: ORB high level
            orb_low: ORB low level
        """
        try:
            if price is None:
                logger.error(f"Cannot record reversal for {ticker}: price is None")
                return
            
            trade_date = self.get_current_et_time().date()
            price_float = float(price) if isinstance(price, Decimal) else price
            orb_high_float = float(orb_high) if isinstance(orb_high, Decimal) else orb_high
            orb_low_float = float(orb_low) if isinstance(orb_low, Decimal) else orb_low
            
            confidence = reversal_result.get("confidence", "LOW")
            indicators = reversal_result.get("indicators", [])
            
            # Prepare reversal data as JSON object for JSONB column
            reversal_data = {
                "original_breakout_type": original_breakout_type,
                "reversal_detected_at": self.get_current_et_time().isoformat(),
                "confidence": confidence,
                "indicators": indicators,
                "reversal_price": price_float,
                "orb_high": orb_high_float,
                "orb_low": orb_low_float,
                "detection_metadata": {
                    "bars_analyzed": len(self._bar_history.get(ticker, [])),
                    "reversal_detection_method": "multi_bar_score",
                    "indicators_count": len(indicators)
                }
            }
            
            # Update cache state with reversal briefly (for notification context)
            self._state_cache.set_reversal(
                ticker=ticker,
                trade_date=trade_date,
                reversal_data=reversal_data,
                current_price=price_float,
                timestamp=self.get_current_et_time().isoformat(),
            )
            
            logger.info(
                f"[REVERSAL DETECTED] {ticker} reversal after {original_breakout_type} breakout. "
                f"Price: ${price_float:.2f}, Confidence: {confidence}, "
                f"Indicators: {', '.join(indicators)}."
            )
            
            # Send reversal notification (user is notified once)
            await self.send_reversal_notification(
                ticker=ticker,
                original_breakout_type=original_breakout_type,
                price=price_float,
                confidence=confidence,
                indicators=indicators,
                orb_high=orb_high_float,
                orb_low=orb_low_float
            )
            # State reset (breakout flags, cache, _rev_state) is handled by the
            # caller (handle_bar) after this coroutine returns, so it happens
            # atomically with the hub publish rather than here.
            
        except Exception as e:
            logger.error(f"Error recording reversal for {ticker}: {e}", exc_info=True)
    
    async def send_reversal_notification(
        self,
        ticker: str,
        original_breakout_type: str,
        price: float,
        confidence: str,
        indicators: list,
        orb_high: float,
        orb_low: float
    ):
        """Send push notification about reversal detection."""
        try:
            eligible_users = await self.get_eligible_users(ticker)
            
            if not eligible_users:
                return
            
            direction_emoji = "🔄"
            original_direction = "BULLISH" if original_breakout_type == "above" else "BEARISH"
            
            notification_tasks = []
            for user in eligible_users:
                message_title = f"{direction_emoji} {ticker} REVERSAL DETECTED ({confidence})"
                
                body_lines = [
                    f"{ticker} {original_direction} breakout has reversed.",
                    f"Current Price: ${price:.2f}",
                    f"ORB High: ${orb_high:.2f}",
                    f"ORB Low: ${orb_low:.2f}",
                ]
                
                if indicators:
                    body_lines.append("")
                    body_lines.append("Reversal Signals:")
                    for indicator in indicators[:5]:  # Limit to 5 indicators
                        body_lines.append(f"• {indicator}")
                
                message_body = "\n".join(body_lines)
                
                message = {
                    "sound": "default",
                    "title": message_title,
                    "body": message_body,
                    "data": {
                        "type": "orb_reversal",
                        "ticker": ticker,
                        "original_breakout_type": original_breakout_type,
                        "price": price,
                        "confidence": confidence,
                        "indicators": indicators,
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
                    breakout_type="reversal",
                    price=Decimal(str(price))
                )
                notification_tasks.append(task)
            
            results = await asyncio.gather(*notification_tasks, return_exceptions=True)
            successful = sum(1 for r in results if r is True)
            failed = len(results) - successful
            
            logger.info(
                f"Reversal notifications sent for {ticker}: "
                f"{successful} successful, {failed} failed"
            )
            
        except Exception as e:
            logger.error(f"Error sending reversal notifications for {ticker}: {e}")
    
    async def _wait_for_confirmation(self, ticker: str, breakout_type: str, orb_high: float, orb_low: float, breakout_timer: int = 180):
        """
        Wait 3 minutes after breakout, then check if price closed outside ORB.
        If confirmed, send BREAKOUT CONFIRMED notification.
        """
        try:
            await asyncio.sleep(breakout_timer)
            
            if ticker not in self.orb_ranges:
                logger.info(f"[CONFIRMATION] {ticker} no longer in monitoring, skipping confirmation")
                return
            
            # Fetch current price to check if breakout is confirmed.
            # Use the live Alpaca bar price already maintained in the state cache
            # (updated every bar in handle_bar) instead of yfinance — yfinance's
            # `.info` call is slow, frequently rate-limited, and can silently
            # return None or a stale quote, which previously meant confirmation
            # (and therefore entry) just never fired with no visible error.
            try:
                trade_date = self.get_current_et_time().date()
                cached_state = self._state_cache.get_state(ticker, trade_date)
                current_price = cached_state.current_price if cached_state else None

                if current_price is None:
                    logger.warning(
                        f"[CONFIRMATION] No cached price for {ticker}, falling back to yfinance"
                    )
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

                    # Invoke the strategy engine: a confirmed 3-min breakout is the
                    # sole entry trigger. Engines subscribed to this ticker enter the
                    # trade using their own ORB/fib; the hub keeps streaming bars for
                    # exit management. Runs regardless of user follows.
                    direction = "CALL" if breakout_type == "above" else "PUT"
                    self._hub.publish_breakout_confirmed(ticker, direction, float(current_price))

                    # Arm reversal scoring for this ticker. Per-bar scoring starts on
                    # the next bar via handle_bar → _score_reversal. Clears any stale
                    # state from a previous breakout on the same day.
                    self._rev_state[ticker] = {
                        "direction":          direction,
                        "score":              0,
                        "signals_hit":        set(),
                        "max_extension":      0.0,
                        "consec_wrong_side":  0,
                        "bars_counted":       0,
                        "fired":              False,
                        "worst_wrong_close":  None,
                        "prev_wrong_close":   None,
                        "consec_recovery":    0,
                    }
                    logger.info("[REV] %s reversal scoring armed (original=%s)", ticker, direction)

                    breakout_type_display = "Confirmed Bullish" if breakout_type == "above" else "Confirmed Bearish"
                    trade_date = self.get_current_et_time().date()
                    # Update cache state (NO DATABASE CALL)
                    self._state_cache.update_state(
                        ticker=ticker,
                        trade_date=trade_date,
                        current_price=current_price,
                        breakout_type=breakout_type_display,
                        orb_high=orb_high,
                        orb_low=orb_low,
                        timestamp=self.get_current_et_time().isoformat(),
                    )
                    await self.send_confirmation_notification(ticker, breakout_type, current_price, orb_high, orb_low)
                else:
                    logger.info(
                        f"[BREAKOUT INVALIDATED] {ticker} price returned inside ORB. "
                        f"Price: ${current_price:.2f}, ORB High: ${orb_high:.2f}, ORB Low: ${orb_low:.2f}"
                    )
                    trade_date = self.get_current_et_time().date()
                    # Update cache state (NO DATABASE CALL)
                    self._state_cache.update_state(
                        ticker=ticker,
                        trade_date=trade_date,
                        current_price=current_price,
                        breakout_type="invalidated",
                        breakout_price=None,
                        orb_high=orb_high,
                        orb_low=orb_low,
                        timestamp=self.get_current_et_time().isoformat(),
                    )
                    await self.send_invalidation_notification(ticker, breakout_type, current_price, orb_high, orb_low)
                    
            except Exception as e:
                logger.error(f"Error checking confirmation for {ticker}: {e}")
                
        except asyncio.CancelledError:
            logger.info(f"[CONFIRMATION] Timer cancelled for {ticker}")
        except Exception as e:
            logger.error(f"Error in confirmation timer for {ticker}: {e}")
        finally:
            if ticker in self._confirmation_timers:
                del self._confirmation_timers[ticker]
    
    async def get_eligible_users(self, ticker: str) -> list:
        """Get eligible users for ORB notifications for a given ticker."""
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
            
            eligible_users = [
                user for user in profiles_response.data
                if user.get("expo_push_token")
                and user.get("notification_preferences", {}).get("enabled", True)
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
        """Send BREAKOUT INVALIDATED notification when price returns inside ORB after 3-minute timer."""
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
    
    def _format_gap_trend_line(
        self,
        ticker: str,
        breakout_type: str,
        gap_context: Optional[Dict],
    ) -> str:
        """Format one-line gap/prior-day/continuation for notification body."""
        if not gap_context:
            return ""
        direction_char = "↑" if breakout_type == "above" else "↓"
        gap_dir = gap_context.get("gap_direction")
        gap_pct = gap_context.get("gap_percent")
        gap_pts = gap_context.get("gap_points")
        prior_trend = gap_context.get("prior_day_trend")
        breakout_aligns = gap_context.get("breakout_aligns_gap")
        if gap_dir == "flat":
            gap_str = "Flat"
        elif gap_pct is not None and gap_pts is not None:
            gap_str = f"{gap_pct:+.1f}% ({gap_pts:+.1f} pts)"
        else:
            gap_str = str(gap_pct) if gap_pct is not None else "—"
        prior_str = (prior_trend or "—").capitalize()
        if breakout_aligns is True:
            suffix = "Continuation ✓"
        elif breakout_aligns is False:
            suffix = "Against Gap ⚠"
        else:
            suffix = "—"
        return f"{ticker} ORB Break {direction_char} | Gap: {gap_str} | Prior Day: {prior_str} | {suffix}"

    async def send_notifications(
        self,
        ticker: str,
        breakout_type: str,
        price: Decimal,
        breakout_analysis: Optional[Dict] = None,
        orb_high: Optional[float] = None,
        orb_low: Optional[float] = None,
        gap_context: Optional[Dict] = None,
    ):
        """Send push notifications with enhanced breakout data and optional gap/trend context."""
        try:
            eligible_users = await self.get_eligible_users(ticker)
            
            if not eligible_users:
                return
            
            price_float = float(price) if isinstance(price, Decimal) else price
            
            gap_trend_line = self._format_gap_trend_line(ticker, breakout_type, gap_context)
            
            # Build enhanced notification if breakout analysis is available
            if breakout_analysis and breakout_analysis.get("signal"):
                signal = breakout_analysis.get("signal", "")
                score = breakout_analysis.get("score", 0)
                confidence = breakout_analysis.get("confidence", "MEDIUM")
                reasons = breakout_analysis.get("reasons", [])
                entry_price = breakout_analysis.get("entry_price", price_float)
                stop_loss = breakout_analysis.get("stop_loss", orb_low if breakout_type == "above" else orb_high)
                risk_per_share = breakout_analysis.get("risk_per_share", 0)
                
                emoji = "🟢" if signal == "BULLISH" else "🔴"
                message_title = f"{emoji} {ticker} ORB BREAKOUT ({confidence} CONFIDENCE - {score}/100)"
                
                direction_text = "BULLISH (Call opportunity)" if signal == "BULLISH" else "BEARISH (Put opportunity)"
                body_lines = []
                if gap_trend_line:
                    body_lines.append(gap_trend_line)
                    body_lines.append("")
                body_lines.extend([
                    f"Direction: {direction_text}",
                    f"Entry: ${entry_price:.2f}",
                    f"ORB High: ${orb_high:.2f}" if orb_high else "",
                    f"ORB Low: ${orb_low:.2f}" if orb_low else "",
                    f"Stop Loss: ${stop_loss:.2f} ({'ORL' if signal == 'BULLISH' else 'ORH'})" if stop_loss else "",
                    "",
                ])
                
                for reason in reasons:
                    if reason.startswith("⚠️"):
                        body_lines.append(reason)
                    else:
                        body_lines.append(f"✓ {reason}")
                
                if risk_per_share > 0:
                    body_lines.append("")
                    body_lines.append(f"Risk: ${risk_per_share:.2f} per share")
                
                message_body = "\n".join([line for line in body_lines if line])
                
            else:
                message_title = f"🚨 ORB Alert: {ticker}"
                direction = "above ORB high" if breakout_type == "above" else "below ORB low"
                message_body = (
                    f"{gap_trend_line}\n\n" if gap_trend_line
                    else ""
                ) + f"{ticker} broke {direction} at ${price_float:.2f}"
            
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
                if gap_context:
                    message["data"].update({
                        "gap_percent": gap_context.get("gap_percent"),
                        "gap_points": gap_context.get("gap_points"),
                        "gap_direction": gap_context.get("gap_direction"),
                        "prior_day_trend": gap_context.get("prior_day_trend"),
                        "trend_continuation": gap_context.get("trend_continuation"),
                        "breakout_aligns_gap": gap_context.get("breakout_aligns_gap"),
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
                    self.get_current_et_time() + timedelta(days=7)
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
            
            eligible_users = [
                user for user in profiles_response.data
                if user.get("expo_push_token")
                and user.get("notification_preferences", {}).get("enabled", True)
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
    
    async def run_service(self):
        """Main service loop"""
        logger.info("Starting ORB Monitoring Service loop")
        
        while self.is_running:
            try:
                current_time = self.get_current_et_time()
                trade_date = current_time.date()
                
                # Skip market hours check in debug mode
                if not self._debug_mode and not self.is_market_hours():
                    if self.streaming_service.is_running:
                        logger.info("Market closed, stopping stream")
                        await self.streaming_service.stop_stream()
                    
                    logger.info("Outside market hours, waiting...")
                    await asyncio.sleep(60)
                    continue
                
                # ~9:25 AM ET: pre-fetch prior-day OHLC for gap/trend (before ORB window 9:30)
                if (
                    current_time.time() >= time(9, 25)
                    and current_time.time() < self.market_open
                    and (self._gap_prefetch_date is None or self._gap_prefetch_date != trade_date)
                ):
                    tickers = await self.load_followed_stocks()
                    if tickers:
                        gap_service = get_gap_analysis_service()
                        count = await gap_service.fetch_and_cache_prior_day_ohlc(
                            list(tickers), trade_date
                        )
                        if count == len(tickers):
                            self._gap_prefetch_date = trade_date
                            logger.info("[GAP] Pre-fetch done for %d tickers (trade_date=%s)", count, trade_date)
                
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
                        
                        tickers = await self.load_followed_stocks()
                        if tickers:
                            self.active_tickers = tickers
                            # Pre-fetch gap prior-day OHLC in background (in case 9:25 was missed)
                            # so subscribe/start_stream are not delayed by yfinance
                            if self._gap_prefetch_date != trade_date:
                                asyncio.create_task(
                                    self._run_gap_prefetch_background(tickers, trade_date)
                                )
                            subscribed = await self.streaming_service.subscribe(tickers, self._create_bar_handler_wrapper())
                            if subscribed:
                                await self.streaming_service.start_stream()
                            else:
                                logger.error("Failed to subscribe to any tickers!")
                        else:
                            logger.warning("No tickers to monitor")
                
                elif self.calculation_phase:
                    # Just exited ORB period - save ranges
                    logger.info("=" * 50)
                    logger.info(f"ORB calculation complete. Total bars received: {self._bars_received_count}")
                    logger.info(f"ORB ranges calculated: {list(self.orb_ranges.keys())}")
                    logger.info("=" * 50)
                    self.calculation_phase = False
                    
                    for ticker, data in self.orb_ranges.items():
                        await self.save_orb_range(ticker, data)
                        # Publish finalized ORB status to the hub (engines use bars,
                        # this is for observability + late-start diagnostics).
                        self._publish_orb_status_to_hub(ticker)
                        logger.info(
                            f"  {ticker}: High={data['high']}, Low={data['low']}, "
                            f"Open={data.get('open', 'N/A')}, Volume={data.get('volume', 0)}"
                        )
                
                # Periodic ticker list refresh: re-load from DB and re-subscribe if changed
                # (so add/remove tickers takes effect without restart; interval avoids DB hammering)
                if not self.is_orb_calculation_period():
                    now = self.get_current_et_time()
                    interval_sec = 120  # 2 minutes
                    if (
                        self._last_ticker_refresh_at is None
                        or (now - self._last_ticker_refresh_at).total_seconds() >= interval_sec
                    ):
                        self._last_ticker_refresh_at = now
                        tickers = await self.load_followed_stocks()
                        if tickers != self.active_tickers:
                            logger.info(
                                "Ticker list changed: refreshing subscription. Previous=%s, New=%s",
                                sorted(self.active_tickers),
                                sorted(tickers),
                            )
                            await self.ensure_orb_ranges()
                            if self.streaming_service.is_running:
                                await self.streaming_service.stop_stream()
                            self.active_tickers = tickers
                            if tickers:
                                subscribed = await self.streaming_service.subscribe(
                                    tickers, self._create_bar_handler_wrapper()
                                )
                                if subscribed:
                                    await self.streaming_service.start_stream()
                                else:
                                    logger.error("Failed to re-subscribe after ticker list refresh")
                            else:
                                logger.warning("No tickers to monitor after refresh")
                
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
            # Tell the strategy engines the bar feed is live so they may trade.
            self._hub.set_service_running(True)
            
            logger.info("=" * 60)
            logger.info("ORB MONITORING SERVICE STARTING")
            logger.info(f"Debug mode: {debug_mode}")
            logger.info(f"Current ET time: {self.get_current_et_time()}")
            logger.info(f"Market hours: {self.is_market_hours()}")
            logger.info(f"ORB calculation period: {self.is_orb_calculation_period()}")
            logger.info(f"Cache sync interval: {self._state_cache.sync_interval}s")
            logger.info("=" * 60)
            
            # Start the cache background sync
            await self._state_cache.cache_monitoring_start()
            
            # Warm cache from database
            await self._state_cache.load_from_database(self.get_current_et_time().date())

            # NOTE: The "started" push is intentionally not sent here. The strategy
            # engine sends a single combined "ORB Service + Engine started"
            # notification (StrategyNotifier.notify_start) from the start endpoint,
            # so emitting one here too would double-notify. The "stopped"
            # notification is still sent from stop().

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
                
                tickers = await self.load_followed_stocks()
                if tickers:
                    self.active_tickers = tickers
                    subscribed = await self.streaming_service.subscribe(tickers, self._create_bar_handler_wrapper())
                    if subscribed:
                        logger.info(f"DEBUG MODE: Subscribed to {len(tickers)} tickers")
                        await self.streaming_service.start_stream()
                        logger.info("DEBUG MODE: Waiting 30 seconds to receive data...")
                        
                        for i in range(6):
                            await asyncio.sleep(5)
                            logger.info(f"DEBUG MODE: [{(i+1)*5}s] Bars received: {self._bars_received_count}")
                        
                        logger.info(f"DEBUG MODE: Test complete. Total bars: {self._bars_received_count}")
                    else:
                        logger.error("DEBUG MODE: Failed to subscribe to any tickers")
                else:
                    logger.error("DEBUG MODE: No tickers to monitor")
                return
            
            # Normal operation
            # If past ORB calculation period, ensure we have ranges (fetch historically if needed)
            if not self.is_orb_calculation_period():
                await self.ensure_orb_ranges()
                
                if self.orb_ranges:
                    logger.info(f"Starting monitoring with {len(self.orb_ranges)} ORB ranges")
                    tickers = await self.load_followed_stocks()
                    if tickers:
                        self.active_tickers = tickers
                        subscribed = await self.streaming_service.subscribe(tickers, self._create_bar_handler_wrapper())
                        if subscribed:
                            await self.streaming_service.start_stream()
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
        # Engines must stop acting/notifying once the bar feed is gone.
        self._hub.set_service_running(False)

        # Cancel all confirmation timers
        for ticker, timer_task in list(self._confirmation_timers.items()):
            timer_task.cancel()
        self._confirmation_timers.clear()
        
        # Cancel and wait for all bar handling tasks
        if self._bar_tasks:
            logger.info(f"Cancelling {len(self._bar_tasks)} bar handling tasks...")
            for task in list(self._bar_tasks):
                if not task.done():
                    task.cancel()
            
            # Wait for all tasks to complete (with timeout)
            if self._bar_tasks:
                try:
                    await asyncio.wait_for(
                        asyncio.gather(*self._bar_tasks, return_exceptions=True),
                        timeout=5.0
                    )
                except asyncio.TimeoutError:
                    logger.warning("Timeout waiting for bar tasks to complete")
                except Exception as e:
                    logger.error(f"Error waiting for bar tasks: {e}", exc_info=True)
            
            self._bar_tasks.clear()
            logger.info("All bar handling tasks cancelled")
        
        # Stop streaming service
        await self.streaming_service.stop_stream()
        
        # Stop cache (flushes remaining dirty entries)
        await self._state_cache.cache_monitoring_stop()
        
        await self.send_service_status_notification("stopped")
        
        logger.info("ORB Monitoring Service stopped")

