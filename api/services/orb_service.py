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
from datetime import datetime, time, timedelta
import logging
import aiohttp
import pandas as pd

from supabase import create_client, Client
import yfinance as yf

from alpaca.data.models import Bar

from services.stock_streaming_base import StockStreamingService, StockBar
from services.breakout_confirmation import BreakoutConfirmation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
        
        # Market timezone
        self.et_timezone = pytz.timezone("America/New_York")
        
        # Market hours
        self.market_open = time(9, 30)
        self.orb_end = time(9, 45)
        self.market_close = time(16, 0)
        
        # ORB tracking
        self.orb_ranges: Dict[str, Dict] = {}
        self.monitoring_state: Dict[str, Dict] = {}
        self.active_tickers: Set[str] = set()
        
        # Service state
        self.is_running = False
        self.calculation_phase = False
        self._debug_mode = False
        self._bars_received_count = 0
        
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
        
        # Reversal tracking: {ticker: {"detected_at": datetime, "bars_since": int, "original_breakout_type": str}}
        # Tracks when reversals were detected so we can clear them after a period
        self._reversal_tracking: Dict[str, Dict] = {}
        
        # Reversal display duration settings
        # Alpaca provides 1-minute bars, so 25 bars ≈ 25 minutes
        self._reversal_display_bars = 5  # Clear reversal after 5 bars have been processed (5 minutes)
    
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
    
    async def save_orb_range(self, ticker: str, data: Dict):
        """Save calculated ORB range to database."""
        try:
            trade_date = self.get_current_et_time().date()
            
            orb_high = float(data["high"]) if isinstance(data["high"], Decimal) else data["high"]
            orb_low = float(data["low"]) if isinstance(data["low"], Decimal) else data["low"]
            opening_price = float(data.get("open", 0)) if isinstance(data.get("open", 0), Decimal) else data.get("open", 0)
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
                "opening_price": opening_price,
            }
            
            self.supabase.table("orb_ranges").upsert(orb_record).execute()
            
            state_record = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "opening_price": opening_price,
                "orb_high": orb_high,
                "orb_low": orb_low,
                "current_price": orb_high,
                "volume": volume,
                "breakout_type": "none",
                "breakout_price": None,
                "high_broken": False,
                "low_broken": False,
                "monitoring_active": True,
                "timestamp": self.get_current_et_time().isoformat(),
            }
            
            self.supabase.table("orb_monitoring_state").upsert(state_record).execute()
            self.monitoring_state[ticker] = {"high_broken": False, "low_broken": False}
            
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
            
            for row in response.data:
                ticker = row["ticker"]
                self.orb_ranges[ticker] = {
                    "high": Decimal(str(row["orb_high"])),
                    "low": Decimal(str(row["orb_low"])),
                    "open": Decimal(str(row.get("opening_price", 0))),
                    "volume": row.get("volume_in_range", 0),
                }
            
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
    
    def _detect_reversal(
        self, 
        ticker: str, 
        current_bar: StockBar, 
        breakout_type: str,
        orb_high: Decimal,
        orb_low: Decimal
    ) -> Dict:
        """
        Hybrid approach to detect reversal after a breakout.
        
        Uses multiple indicators:
        1. VWAP cross: Price crossing back through VWAP
        2. ORB re-entry: Price returning inside ORB range
        3. Volume pattern: Decreasing volume on reversal move
        4. Momentum: Price moving opposite to breakout direction
        5. Price action: Multiple consecutive bars in reversal direction
        
        Args:
            ticker: Stock ticker symbol
            current_bar: Current bar data
            breakout_type: "above" or "below" (original breakout direction)
            orb_high: ORB high level
            orb_low: ORB low level
            
        Returns:
            Dict with reversal detection result:
            {
                "is_reversal": bool,
                "confidence": "HIGH" | "MEDIUM" | "LOW",
                "indicators": list of indicator signals,
                "vwap": float or None
            }
        """
        if ticker not in self._bar_history or len(self._bar_history[ticker]) < 5:
            return {"is_reversal": False, "confidence": "LOW", "indicators": [], "vwap": None}
        
        bars = self._bar_history[ticker]
        current_close = float(current_bar.close)
        current_high = float(current_bar.high)
        current_low = float(current_bar.low)
        current_volume = current_bar.volume
        
        # Calculate VWAP from recent bars
        vwap = self._calculate_vwap_from_bars(bars)
        
        if vwap is None:
            return {"is_reversal": False, "confidence": "LOW", "indicators": [], "vwap": None}
        
        indicators = []
        reversal_score = 0
        max_score = 0
        
        # Indicator 1: VWAP Cross (30 points)
        # For bullish breakout: reversal if price crosses below VWAP
        # For bearish breakout: reversal if price crosses above VWAP
        max_score += 30
        if breakout_type == "above":
            # Bullish breakout - reversal if price goes below VWAP
            if current_close < vwap:
                # Check if previous bar was above VWAP (cross confirmation)
                if len(bars) >= 2:
                    prev_close = float(bars[-2].close)
                    if prev_close >= vwap:
                        reversal_score += 30
                        indicators.append(f"VWAP cross below (${vwap:.2f})")
                    else:
                        reversal_score += 15
                        indicators.append(f"Price below VWAP (${vwap:.2f})")
        else:
            # Bearish breakout - reversal if price goes above VWAP
            if current_close > vwap:
                # Check if previous bar was below VWAP (cross confirmation)
                if len(bars) >= 2:
                    prev_close = float(bars[-2].close)
                    if prev_close <= vwap:
                        reversal_score += 30
                        indicators.append(f"VWAP cross above (${vwap:.2f})")
                    else:
                        reversal_score += 15
                        indicators.append(f"Price above VWAP (${vwap:.2f})")
        
        # Indicator 2: ORB Re-entry (25 points)
        # Price returning inside ORB range after breakout
        max_score += 25
        if breakout_type == "above":
            # Bullish breakout - reversal if price returns below ORB high
            if current_close < float(orb_high):
                reversal_score += 25
                indicators.append(f"Price re-entered ORB (below ${orb_high:.2f})")
            elif current_low < float(orb_high):
                reversal_score += 15
                indicators.append(f"Price touched ORB high (${orb_high:.2f})")
        else:
            # Bearish breakout - reversal if price returns above ORB low
            if current_close > float(orb_low):
                reversal_score += 25
                indicators.append(f"Price re-entered ORB (above ${orb_low:.2f})")
            elif current_high > float(orb_low):
                reversal_score += 15
                indicators.append(f"Price touched ORB low (${orb_low:.2f})")
        
        # Indicator 3: Volume Pattern (20 points)
        # Decreasing volume on reversal move suggests weak continuation
        max_score += 20
        if len(bars) >= 3:
            recent_volumes = [b.volume for b in bars[-3:]]
            avg_recent_volume = sum(recent_volumes) / len(recent_volumes)
            
            # Check if current volume is decreasing
            if current_volume < avg_recent_volume * 0.7:
                reversal_score += 20
                indicators.append("Decreasing volume on reversal")
            elif current_volume < avg_recent_volume * 0.85:
                reversal_score += 10
                indicators.append("Moderate volume decrease")
        
        # Indicator 4: Momentum Shift (15 points)
        # Multiple consecutive bars moving opposite to breakout direction
        max_score += 15
        if len(bars) >= 3:
            recent_closes = [float(b.close) for b in bars[-3:]]
            
            if breakout_type == "above":
                # Bullish breakout - check for consecutive down moves
                down_moves = sum(1 for i in range(1, len(recent_closes)) 
                               if recent_closes[i] < recent_closes[i-1])
                if down_moves >= 2:
                    reversal_score += 15
                    indicators.append(f"{down_moves} consecutive down bars")
            else:
                # Bearish breakout - check for consecutive up moves
                up_moves = sum(1 for i in range(1, len(recent_closes)) 
                             if recent_closes[i] > recent_closes[i-1])
                if up_moves >= 2:
                    reversal_score += 15
                    indicators.append(f"{up_moves} consecutive up bars")
        
        # Indicator 5: Price Action - Strong Reversal Candle (10 points)
        # Strong opposite-direction candle (e.g., bearish candle after bullish breakout)
        max_score += 10
        if breakout_type == "above":
            # Bullish breakout - look for bearish candle
            if current_close < float(current_bar.open):
                body_size = abs(current_close - float(current_bar.open))
                candle_range = current_high - current_low
                if candle_range > 0 and body_size / candle_range > 0.6:  # Strong body
                    reversal_score += 10
                    indicators.append("Strong bearish reversal candle")
        else:
            # Bearish breakout - look for bullish candle
            if current_close > float(current_bar.open):
                body_size = abs(current_close - float(current_bar.open))
                candle_range = current_high - current_low
                if candle_range > 0 and body_size / candle_range > 0.6:  # Strong body
                    reversal_score += 10
                    indicators.append("Strong bullish reversal candle")
        
        # Determine if reversal is detected
        # Require at least 40% of max score for low confidence
        # 60% for medium, 75% for high
        score_percentage = (reversal_score / max_score * 100) if max_score > 0 else 0
        
        is_reversal = score_percentage >= 40
        if score_percentage >= 75:
            confidence = "HIGH"
        elif score_percentage >= 60:
            confidence = "MEDIUM"
        else:
            confidence = "LOW"
        
        return {
            "is_reversal": is_reversal,
            "confidence": confidence,
            "indicators": indicators,
            "vwap": vwap,
            "score": reversal_score,
            "max_score": max_score,
            "score_percentage": score_percentage
        }
    
    async def handle_bar(self, stock_bar: StockBar):
        """
        Handle incoming bar data from streaming service.
        
        This method processes bars during both ORB calculation phase and monitoring phase.
        Adapted to work with standardized StockBar instead of provider-specific bar types.
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
        
        if self.calculation_phase:
            # During ORB calculation, track the TRUE high and low from bar data
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
            
            # Calculate percentage change if we have previous close
            percentage_change = None
            if previous_close and previous_close > 0:
                current_price_float = float(bar_close)
                price_change = current_price_float - previous_close
                percentage_change = (price_change / previous_close) * 100
            
            if ticker not in self.orb_ranges:
                self.orb_ranges[ticker] = {
                    "high": bar_high,
                    "low": bar_low,
                    "open": bar_open,  # First bar's open is the opening price
                    "volume": int(bar_volume),
                }
                logger.info(
                    f"[ORB CALC] Started tracking {ticker}: "
                    f"High={bar_high}, Low={bar_low}, Open={bar_open}"
                )
                
                # Initialize monitoring state in database with first bar data
                try:
                    state_update = {
                        "ticker": ticker,
                        "trade_date": str(trade_date),
                        "opening_price": float(bar_open),
                        "orb_high": float(bar_high),
                        "orb_low": float(bar_low),
                        "current_price": float(bar_close),
                        "volume": int(bar_volume),
                        "breakout_type": "none",
                        "breakout_price": None,
                        "high_broken": False,
                        "low_broken": False,
                        "monitoring_active": True,
                        "timestamp": self.get_current_et_time().isoformat(),
                        "data_source": "alpaca",  # Streaming data from Alpaca
                    }
                    
                    # Add previous close and percentage change if available
                    if previous_close:
                        state_update["previous_close"] = previous_close
                    if percentage_change is not None:
                        state_update["percentage_change"] = round(percentage_change, 2)
                    if prev_close_data_source:
                        # Track both data sources: streaming (alpaca) and previous close source
                        state_update["data_source"] = f"alpaca,prev_close:{prev_close_data_source}"
                    
                    self.supabase.table("orb_monitoring_state").upsert(state_update).execute()
                except Exception as e:
                    logger.warning(f"Failed to initialize monitoring state for {ticker}: {e}")
            else:
                old_high = self.orb_ranges[ticker]["high"]
                old_low = self.orb_ranges[ticker]["low"]
                
                # Update with bar's high/low, not just close
                self.orb_ranges[ticker]["high"] = max(old_high, bar_high)
                self.orb_ranges[ticker]["low"] = min(old_low, bar_low)
                self.orb_ranges[ticker]["volume"] = int(self.orb_ranges[ticker]["volume"]) + int(bar_volume)
                
                # Update monitoring state in database in real-time during calculation
                try:
                    state_update = {
                        "ticker": ticker,
                        "trade_date": str(trade_date),
                        "orb_high": float(self.orb_ranges[ticker]["high"]),
                        "orb_low": float(self.orb_ranges[ticker]["low"]),
                        "current_price": float(bar_close),
                        "volume": int(self.orb_ranges[ticker]["volume"]),
                        "timestamp": self.get_current_et_time().isoformat(),
                        "data_source": "alpaca",  # Streaming data from Alpaca
                    }
                    
                    # Add previous close and percentage change if available
                    if previous_close:
                        state_update["previous_close"] = previous_close
                    if percentage_change is not None:
                        state_update["percentage_change"] = round(percentage_change, 2)
                    if prev_close_data_source:
                        # Track both data sources: streaming (alpaca) and previous close source
                        state_update["data_source"] = f"alpaca,prev_close:{prev_close_data_source}"
                    
                    self.supabase.table("orb_monitoring_state").upsert(state_update).execute()
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
            
            # Update bar history for VWAP calculation and reversal detection
            self._update_bar_history(ticker, stock_bar)
            
            # Update current_price in database (use bar close as current price)
            trade_date = self.get_current_et_time().date()
            try:
                self.supabase.table("orb_monitoring_state").upsert({
                    "ticker": ticker,
                    "trade_date": str(trade_date),
                    "current_price": float(bar_close),
                    "orb_high": float(orb_high),
                    "orb_low": float(orb_low),
                    "timestamp": self.get_current_et_time().isoformat(),
                    "data_source": "alpaca",  # Streaming data from Alpaca
                }).execute()
            except Exception as e:
                logger.warning(f"Failed to update current_price for {ticker}: {e}")
            
            state = self.monitoring_state[ticker]
            
            # Check for reversals if a breakout has already occurred
            # IMPORTANT: Only check for reversals if there was an actual breakout (ORH or ORL broken)
            if state["high_broken"] or state["low_broken"]:
                # First, check if we should clear an existing reversal
                await self._check_and_clear_reversal(ticker, trade_date, orb_high, orb_low, bar_close)
                
                # Determine original breakout type
                original_breakout_type = "above" if state["high_broken"] else "below"
                
                # Only check for new reversals if we're not already showing a reversal
                # (to avoid constantly re-triggering on price fluctuations)
                current_state = None
                try:
                    current_state = (
                        self.supabase.table("orb_monitoring_state")
                        .select("breakout_type, reversal_data")
                        .eq("ticker", ticker)
                        .eq("trade_date", str(trade_date))
                        .execute()
                    )
                except Exception as e:
                    logger.warning(f"Error fetching current state for {ticker}: {e}")
                
                current_breakout_type = None
                if current_state and current_state.data and len(current_state.data) > 0:
                    current_breakout_type = current_state.data[0].get("breakout_type")
                
                # Only check for reversal if not already in reversal state
                if current_breakout_type != "reversal":
                    # Check for reversal
                    reversal_result = self._detect_reversal(
                        ticker=ticker,
                        current_bar=stock_bar,
                        breakout_type=original_breakout_type,
                        orb_high=orb_high,
                        orb_low=orb_low
                    )
                    
                    if reversal_result["is_reversal"]:
                        # Only record if reversal hasn't already been recorded
                        try:
                            await self.record_reversal(
                                ticker=ticker,
                                original_breakout_type=original_breakout_type,
                                price=bar_close,
                                reversal_result=reversal_result,
                                orb_high=orb_high,
                                orb_low=orb_low
                            )
                        except Exception as e:
                            logger.error(f"Error recording reversal for {ticker}: {e}")
                else:
                    # We're in reversal state - update the bar count
                    if ticker in self._reversal_tracking:
                        self._reversal_tracking[ticker]["bars_since"] += 1
            
            # Check breakouts - use bar_high for upper breakout, bar_low for lower
            # This catches intrabar breakouts, not just close-based
            if not state["high_broken"] and bar_high > orb_high:
                logger.info(
                    f"[BREAKOUT DETECTED] {ticker} above ORB high! "
                    f"Bar High={bar_high}, ORB High={orb_high}"
                )
                await self.record_breakout(ticker, "above", bar_close, bar_data=stock_bar)
            
            elif not state["low_broken"] and bar_low < orb_low:
                logger.info(
                    f"[BREAKOUT DETECTED] {ticker} below ORB low! "
                    f"Bar Low={bar_low}, ORB Low={orb_low}"
                )
                await self.record_breakout(ticker, "below", bar_close, bar_data=stock_bar)
    
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
            breakout_type_display = "Bullish" if breakout_type == "above" else "Bearish"
            
            state_update = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "current_price": breakout_price,
                "breakout_type": breakout_type_display,
                "breakout_price": breakout_price,
                "orb_high": orb_high,
                "orb_low": orb_low,
                "timestamp": self.get_current_et_time().isoformat(),
            }
            
            if breakout_type == "above":
                state_update["high_broken"] = True
                self.monitoring_state[ticker]["high_broken"] = True
            else:
                state_update["low_broken"] = True
                self.monitoring_state[ticker]["low_broken"] = True
            
            # Clear any existing reversal tracking when a new breakout occurs
            if ticker in self._reversal_tracking:
                logger.debug(f"Clearing reversal tracking for {ticker} due to new breakout")
                del self._reversal_tracking[ticker]
            
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
        price: Decimal,
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
            reversal_result: Result from _detect_reversal method
            orb_high: ORB high level
            orb_low: ORB low level
        """
        try:
            trade_date = self.get_current_et_time().date()
            price_float = float(price) if isinstance(price, Decimal) else price
            orb_high_float = float(orb_high) if isinstance(orb_high, Decimal) else orb_high
            orb_low_float = float(orb_low) if isinstance(orb_low, Decimal) else orb_low
            
            confidence = reversal_result.get("confidence", "LOW")
            indicators = reversal_result.get("indicators", [])
            vwap = reversal_result.get("vwap")
            score_percentage = reversal_result.get("score_percentage", 0)
            score = reversal_result.get("score", 0)
            max_score = reversal_result.get("max_score", 0)
            
            # Prepare reversal data as JSON object for JSONB column
            reversal_data = {
                "original_breakout_type": original_breakout_type,
                "reversal_detected_at": self.get_current_et_time().isoformat(),
                "confidence": confidence,
                "score": score,
                "max_score": max_score,
                "score_percentage": round(score_percentage, 2),
                "vwap": vwap,
                "indicators": indicators,
                "reversal_price": price_float,
                "orb_high": orb_high_float,
                "orb_low": orb_low_float,
                "detection_metadata": {
                    "bars_analyzed": len(self._bar_history.get(ticker, [])),
                    "reversal_detection_method": "hybrid",
                    "indicators_count": len(indicators)
                }
            }
            
            # Update monitoring state with reversal and reversal data
            state_update = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "current_price": price_float,
                "breakout_type": "reversal",
                "orb_high": orb_high_float,
                "orb_low": orb_low_float,
                "reversal_data": reversal_data,  # JSONB field
                "timestamp": self.get_current_et_time().isoformat(),
                "data_source": "alpaca",  # Streaming data from Alpaca
            }
            
            self.supabase.table("orb_monitoring_state").upsert(state_update).execute()
            
            # Track reversal detection for auto-clearing
            self._reversal_tracking[ticker] = {
                "detected_at": self.get_current_et_time(),
                "bars_since": 0,
                "original_breakout_type": original_breakout_type
            }
            
            logger.info(
                f"[REVERSAL DETECTED] {ticker} reversal after {original_breakout_type} breakout. "
                f"Price: ${price_float:.2f}, Confidence: {confidence}, "
                f"Score: {score_percentage:.1f}%, VWAP: ${vwap:.2f if vwap else 'N/A'}, "
                f"Indicators: {', '.join(indicators)}. "
                f"Will auto-clear after {self._reversal_display_bars} bars (≈{self._reversal_display_bars} minutes for 1-min bars)."
            )
            
            # Send reversal notification
            await self.send_reversal_notification(
                ticker=ticker,
                original_breakout_type=original_breakout_type,
                price=price_float,
                confidence=confidence,
                indicators=indicators,
                vwap=vwap,
                orb_high=orb_high_float,
                orb_low=orb_low_float
            )
            
        except Exception as e:
            logger.error(f"Error recording reversal for {ticker}: {e}", exc_info=True)
    
    async def _check_and_clear_reversal(
        self,
        ticker: str,
        trade_date,
        orb_high: Decimal,
        orb_low: Decimal,
        current_price: Decimal
    ):
        """
        Check if a reversal should be cleared based on bar count.
        
        Reversals are automatically cleared after 25 bars have been processed.
        Alpaca provides 1-minute bars, so 25 bars ≈ 25 minutes.
        
        When cleared, the breakout_type is set to "none" (only if it was "reversal").
        
        Args:
            ticker: Stock ticker symbol
            trade_date: Current trade date
            orb_high: ORB high level
            orb_low: ORB low level
            current_price: Current price
        """
        if ticker not in self._reversal_tracking:
            return  # No reversal to clear
        
        try:
            reversal_info = self._reversal_tracking[ticker]
            bars_since = reversal_info["bars_since"]
            
            # Check if enough bars have passed (5 bars ≈ 5 minutes for 1-minute bars)
            bars_exceeded = bars_since >= self._reversal_display_bars
            
            if bars_exceeded:
                # Verify current breakout_type is "reversal" before clearing
                current_state = None
                try:
                    current_state = (
                        self.supabase.table("orb_monitoring_state")
                        .select("breakout_type")
                        .eq("ticker", ticker)
                        .eq("trade_date", str(trade_date))
                        .execute()
                    )
                except Exception as e:
                    logger.warning(f"Error fetching current state for {ticker} during reversal clear: {e}")
                
                current_breakout_type = None
                if current_state and current_state.data and len(current_state.data) > 0:
                    current_breakout_type = current_state.data[0].get("breakout_type")
                
                # Only clear if current type is "reversal"
                if current_breakout_type == "reversal":
                    # Clear the reversal and set breakout_type to "none"
                    logger.info(
                        f"[REVERSAL CLEARED] {ticker} reversal cleared after {bars_since} bars "
                        f"(≈{bars_since} minutes). Setting breakout_type to 'none'."
                    )
                    
                    # Update monitoring state to set breakout_type to "none"
                    state_update = {
                        "ticker": ticker,
                        "trade_date": str(trade_date),
                        "current_price": float(current_price),
                        "breakout_type": "none",  # Set to "none" after reversal period
                        "orb_high": float(orb_high),
                        "orb_low": float(orb_low),
                        "timestamp": self.get_current_et_time().isoformat(),
                        "data_source": "alpaca",
                        # Keep reversal_data for historical reference
                    }
                    
                    self.supabase.table("orb_monitoring_state").upsert(state_update).execute()
                else:
                    logger.debug(
                        f"[REVERSAL CLEAR] {ticker} reversal tracking cleared but breakout_type "
                        f"was '{current_breakout_type}', not 'reversal'. Skipping update."
                    )
                
                # Remove from tracking regardless
                del self._reversal_tracking[ticker]
                
        except Exception as e:
            logger.error(f"Error checking/clearing reversal for {ticker}: {e}", exc_info=True)
    
    async def send_reversal_notification(
        self,
        ticker: str,
        original_breakout_type: str,
        price: float,
        confidence: str,
        indicators: list,
        vwap: Optional[float],
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
                
                if vwap:
                    body_lines.append(f"VWAP: ${vwap:.2f}")
                
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
                        "vwap": vwap,
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
                    breakout_type_display = "Confirmed Bullish" if breakout_type == "above" else "Confirmed Bearish"
                    trade_date = self.get_current_et_time().date()
                    self.supabase.table("orb_monitoring_state").upsert({
                        "ticker": ticker,
                        "trade_date": str(trade_date),
                        "current_price": current_price,
                        "breakout_type": breakout_type_display,
                        "orb_high": orb_high,
                        "orb_low": orb_low,
                        "timestamp": self.get_current_et_time().isoformat(),
                    }).execute()
                    await self.send_confirmation_notification(ticker, breakout_type, current_price, orb_high, orb_low)
                else:
                    logger.info(
                        f"[BREAKOUT INVALIDATED] {ticker} price returned inside ORB. "
                        f"Price: ${current_price:.2f}, ORB High: ${orb_high:.2f}, ORB Low: ${orb_low:.2f}"
                    )
                    trade_date = self.get_current_et_time().date()
                    self.supabase.table("orb_monitoring_state").upsert({
                        "ticker": ticker,
                        "trade_date": str(trade_date),
                        "current_price": current_price,
                        "breakout_type": "invalidated",
                        "breakout_price": None,
                        "orb_high": orb_high,
                        "orb_low": orb_low,
                        "timestamp": self.get_current_et_time().isoformat(),
                        "data_source": "yfinance",  # Confirmation check uses yfinance
                    }).execute()
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
    
    async def send_notifications(
        self, 
        ticker: str, 
        breakout_type: str, 
        price: Decimal,
        breakout_analysis: Optional[Dict] = None,
        orb_high: Optional[float] = None,
        orb_low: Optional[float] = None
    ):
        """Send push notifications with enhanced breakout data."""
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
                
                emoji = "🟢" if signal == "BULLISH" else "🔴"
                message_title = f"{emoji} {ticker} ORB BREAKOUT ({confidence} CONFIDENCE - {score}/100)"
                
                direction_text = "BULLISH (Call opportunity)" if signal == "BULLISH" else "BEARISH (Put opportunity)"
                body_lines = [
                    f"Direction: {direction_text}",
                    f"Entry: ${entry_price:.2f}",
                    f"ORB High: ${orb_high:.2f}" if orb_high else "",
                    f"ORB Low: ${orb_low:.2f}" if orb_low else "",
                    f"Stop Loss: ${stop_loss:.2f} ({'ORL' if signal == 'BULLISH' else 'ORH'})" if stop_loss else "",
                    "",
                ]
                
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
                
                # Skip market hours check in debug mode
                if not self._debug_mode and not self.is_market_hours():
                    if self.streaming_service.is_running:
                        logger.info("Market closed, stopping stream")
                        await self.streaming_service.stop_stream()
                    
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
                        
                        tickers = await self.load_followed_stocks()
                        if tickers:
                            self.active_tickers = tickers
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
        
        await self.send_service_status_notification("stopped")
        
        logger.info("ORB Monitoring Service stopped")

