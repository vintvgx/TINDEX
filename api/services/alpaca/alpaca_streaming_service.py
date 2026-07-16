"""
Alpaca Stock Streaming Service

This service handles real-time stock data streaming from Alpaca API.
It only handles streaming - no ORB logic, notifications, or database operations.

Architecture:
- Implements StockStreamingService interface
- Uses Alpaca's StockDataStream for WebSocket streaming
- Converts Alpaca Bar objects to standardized StockBar format
- Focused solely on data streaming concerns
"""

import asyncio
import os
import logging
from typing import Set, Optional, Callable
from decimal import Decimal

from alpaca.data.live import StockDataStream
from alpaca.data.enums import DataFeed
from alpaca.data.models import Bar as AlpacaBar

from services.utils.stock_streaming_base import StockStreamingService, StockBar

logger = logging.getLogger(__name__)


class AlpacaStreamingService(StockStreamingService):
    """
    Alpaca-based stock streaming service.
    
    This service provides real-time stock bar data from Alpaca's IEX feed.
    It handles only streaming operations - no business logic.
    
    Architecture:
    - Implements StockStreamingService interface
    - Uses Alpaca's async streaming API
    - Converts provider-specific data to standardized format
    - Handles connection lifecycle and error recovery
    
    Performance:
    - Non-blocking async operations
    - Efficient WebSocket connection management
    - Automatic reconnection on failures
    """
    
    def __init__(self):
        """Initialize Alpaca streaming service with credentials."""
        super().__init__()
        
        self.alpaca_api_key = os.getenv("ALPACA_LIVE_API_KEY")
        self.alpaca_secret_key = os.getenv("ALPACA_LIVE_SECRET_KEY")

        if not self.alpaca_api_key:
            raise ValueError("ALPACA_LIVE_API_KEY not defined")
        if not self.alpaca_secret_key:
            raise ValueError("ALPACA_LIVE_SECRET_KEY not defined")
        
        self._stock_stream: Optional[StockDataStream] = None
        self._stream_task: Optional[asyncio.Task] = None
        self._stream_loop: Optional[asyncio.AbstractEventLoop] = None
        self._bar_handler_callback: Optional[Callable[[StockBar], None]] = None
    
    def _create_stock_stream(self):
        """Create a fresh stock stream instance."""
        self._stock_stream = StockDataStream(
            self.alpaca_api_key,
            self.alpaca_secret_key,
            feed=DataFeed.IEX
        )
        logger.info("Created new Alpaca StockDataStream instance")
    
    async def _alpaca_bar_handler(self, data: AlpacaBar):
        """
        Handler for Alpaca bar data - converts to StockBar and calls callback.
        
        This is the bridge between Alpaca's data format and our standardized format.
        
        Error Handling:
        - Gracefully handles None data or missing attributes
        - Prevents race conditions by storing callback in local variable
        - Ensures stream continues even if callback fails
        - Validates data before conversion to prevent type errors
        """
        try:
            # Validate input data
            if data is None:
                logger.warning("Received None data in Alpaca bar handler, ignoring")
                return
            
            # Store callback in local variable to avoid race conditions
            callback = self._bar_handler_callback
            if not callback:
                logger.warning("Bar handler callback not set, ignoring bar data")
                return
            
            if not callable(callback):
                logger.error(f"Bar handler callback is not callable: {type(callback)}")
                return
            
            # Validate required data attributes before conversion
            symbol = getattr(data, 'symbol', None)
            if not symbol:
                logger.warning("Bar data missing symbol, ignoring")
                return
            
            # Safely extract and convert price data with None checks
            try:
                open_price = Decimal(str(data.open)) if data.open is not None else None
                high_price = Decimal(str(data.high)) if data.high is not None else None
                low_price = Decimal(str(data.low)) if data.low is not None else None
                close_price = Decimal(str(data.close)) if data.close is not None else None
                
                # Validate that we have at least one price
                if open_price is None and high_price is None and low_price is None and close_price is None:
                    logger.warning(f"Bar data for {symbol} has no valid price data, ignoring")
                    return
                
                # Find first available price to use as fallback
                fallback_price = close_price or high_price or low_price or open_price
                
                # Use fallback for any missing prices
                open_price = open_price if open_price is not None else fallback_price
                high_price = high_price if high_price is not None else fallback_price
                low_price = low_price if low_price is not None else fallback_price
                close_price = close_price if close_price is not None else fallback_price
                
            except (ValueError, TypeError, AttributeError) as e:
                logger.error(f"Error converting price data for {symbol}: {e}", exc_info=True)
                return
            
            # Convert Alpaca Bar to standardized StockBar
            stock_bar = StockBar(
                symbol=symbol,
                open=open_price,
                high=high_price,
                low=low_price,
                close=close_price,
                volume=int(data.volume) if data.volume is not None else 0,
                timestamp=getattr(data, 'timestamp', None) if hasattr(data, 'timestamp') else None
            )
            
            # Call the registered handler (synchronous callback, no await needed)
            try:
                callback(stock_bar)
            except Exception as callback_error:
                # Log callback errors but don't let them stop the stream
                logger.error(
                    f"Error in bar handler callback for {symbol}: {callback_error}",
                    exc_info=True
                )
            
        except Exception as e:
            # Get symbol safely for error logging
            symbol = getattr(data, 'symbol', 'UNKNOWN') if data is not None else 'UNKNOWN'
            logger.error(
                f"Error in Alpaca bar handler for {symbol}: {e}",
                exc_info=True
            )
            # Don't re-raise - let the stream continue processing other bars
    
    async def subscribe(self, tickers: Set[str], bar_handler: Callable[[StockBar], None]) -> bool:
        """
        Subscribe to bar data for the given tickers.
        
        Args:
            tickers: Set of ticker symbols to subscribe to
            bar_handler: Async callback function that receives StockBar objects
            
        Returns:
            True if subscription successful, False otherwise
        """
        try:
            if not tickers:
                logger.warning("No tickers provided for subscription")
                return False
            
            # Store the callback
            self._bar_handler_callback = bar_handler
            
            # Create stream instance if needed
            if not self._stock_stream:
                self._create_stock_stream()
            
            if not self._stock_stream:
                logger.error("Unable to create Alpaca stock stream")
                return False
            
            # Subscribe to bars
            self._stock_stream.subscribe_bars(self._alpaca_bar_handler, *list(tickers))
            self._subscribed_tickers = tickers.copy()
            
            logger.info(f"Subscribed to {len(tickers)} tickers on Alpaca: {list(tickers)}")
            return True
            
        except Exception as e:
            logger.error(f"Error subscribing to Alpaca tickers: {e}", exc_info=True)
            return False
    
    def _unsubscribe_ticker_blocking(self, ticker: str):
        """
        Helper method to unsubscribe from a single ticker (blocking).
        This runs in a thread pool to avoid blocking the event loop.
        """
        if self._stock_stream:
            try:
                self._stock_stream.unsubscribe_bars(ticker)
            except Exception as e:
                logger.warning(f"Error unsubscribing {ticker} from Alpaca: {e}")
    
    async def unsubscribe(self, tickers: Optional[Set[str]] = None) -> bool:
        """
        Unsubscribe from tickers.
        
        Args:
            tickers: Set of tickers to unsubscribe from. If None, unsubscribe from all.
            
        Returns:
            True if successful, False otherwise
        """
        try:
            if not self._subscribed_tickers:
                logger.info("No tickers subscribed to unsubscribe from")
                return True
            
            if tickers is None:
                tickers = self._subscribed_tickers.copy()
            
            if not self._stock_stream:
                logger.warning("No stream instance to unsubscribe from")
                self._subscribed_tickers.clear()
                return True
            
            # Run blocking unsubscribe calls in thread pool with timeout
            loop = asyncio.get_running_loop()
            
            for ticker in list(tickers):  # Copy to avoid mutation during iteration
                try:
                    await asyncio.wait_for(
                        loop.run_in_executor(
                            None,
                            self._unsubscribe_ticker_blocking,
                            ticker
                        ),
                        timeout=5.0
                    )
                    logger.debug(f"Unsubscribed {ticker} from Alpaca")
                except asyncio.TimeoutError:
                    logger.warning(f"Timeout unsubscribing {ticker} from Alpaca (exceeded 5s)")
                except Exception as e:
                    logger.warning(f"Error unsubscribing {ticker} from Alpaca: {e}")
            
            # Remove from subscribed set
            self._subscribed_tickers -= tickers
            
            await asyncio.sleep(0.5)  # Brief pause after unsubscription
            
            logger.info(f"Unsubscribed from {len(tickers)} tickers on Alpaca")
            return True
            
        except Exception as e:
            logger.error(f"Error during Alpaca unsubscribe: {e}", exc_info=True)
            return False
    
    async def start_stream(self) -> bool:
        """
        Start the Alpaca WebSocket stream.
        
        Returns:
            True if stream started successfully, False otherwise
        """
        try:
            if self._is_running:
                logger.info("Alpaca stream already running")
                return True
            
            if not self._stock_stream:
                logger.error("Cannot start stream - stock_stream not initialized")
                return False
            
            logger.info("Starting Alpaca WebSocket stream...")

            # Start the stream in a background task. Record the loop it's
            # actually running on — every OrbService.start() runs in its own
            # dedicated background thread with its own fresh event loop
            # (asyncio.new_event_loop(), see monitoring_routes.py), so this is
            # NEVER the same loop that a later stop() call runs on (stop() is
            # invoked via asyncio.run(...) from a Flask request thread, which
            # creates yet another new loop). stop_stream() needs this to
            # actually reach the running task instead of silently giving up.
            self._stream_loop = asyncio.get_running_loop()
            self._stream_task = asyncio.create_task(self._stock_stream._run_forever())
            self._is_running = True
            
            # Give it a moment to establish connection
            await asyncio.sleep(2)
            
            logger.info(
                f"Alpaca stream started successfully. "
                f"Monitoring {len(self._subscribed_tickers)} tickers."
            )
            return True
            
        except Exception as e:
            logger.error(f"Failed to start Alpaca stream: {e}", exc_info=True)
            self._is_running = False
            return False
    
    async def _cancel_and_close(self, stream_task: "asyncio.Task") -> None:
        """The actual teardown — cancel the running task, wait for it, close
        the connection. MUST run on the same event loop that started the
        stream (self._stream_loop) — see stop_stream() for why."""
        stream_task.cancel()
        try:
            await asyncio.wait_for(stream_task, timeout=2.0)
        except asyncio.TimeoutError:
            logger.warning("Alpaca stream task cancellation timed out")
        except asyncio.CancelledError:
            logger.info("Alpaca stream task cancelled successfully")
        except Exception as e:
            logger.error(f"Error awaiting Alpaca stream task cancellation: {e}", exc_info=True)

        await self.unsubscribe()

        if self._stock_stream:
            try:
                await asyncio.wait_for(self._stock_stream.close(), timeout=5.0)
                logger.info("Alpaca stock stream connection closed")
            except asyncio.TimeoutError:
                logger.warning("Alpaca stream close timed out")
            except Exception as e:
                logger.error(f"Error closing Alpaca stock stream: {e}")

    async def stop_stream(self) -> bool:
        """
        Stop the Alpaca WebSocket stream and clean up resources.

        Returns:
            True if stream stopped successfully, False otherwise
        """
        try:
            if not self._is_running:
                logger.info("Alpaca stream was never started, skipping cleanup")
                return True

            if self._stream_task is not None:
                stream_task = self._stream_task
                self._stream_task = None  # Clear reference immediately to prevent reuse

                current_loop = asyncio.get_running_loop()
                stream_loop = self._stream_loop

                if stream_loop is not None and stream_loop is not current_loop and stream_loop.is_running():
                    # This is the normal case, not an edge case: every
                    # OrbService.start() runs in its own dedicated thread with
                    # its own fresh event loop, and stop() is called via
                    # asyncio.run(...) from a Flask request thread — a THIRD,
                    # unrelated loop. Actually cancelling and closing the
                    # connection has to happen on stream_loop itself.
                    #
                    # Previously this branch just logged a warning and gave up
                    # without awaiting anything — meaning the old stream's
                    # _run_forever() task, and its own internal reconnect loop,
                    # kept running forever, orphaned, on a thread nothing was
                    # tracking anymore. Every restart (including every watchdog
                    # cycle) left one more of these behind; each one kept
                    # retrying its connection to Alpaca indefinitely, and since
                    # Alpaca allows only one live connection per account for
                    # this feed, enough accumulated zombies is exactly what
                    # produces a flood of "connection limit exceeded" / HTTP 429
                    # rejections — including against the *new*, legitimate
                    # connection this stop() is making room for.
                    logger.info("Cancelling Alpaca stream task on its own event loop")
                    future = asyncio.run_coroutine_threadsafe(
                        self._cancel_and_close(stream_task), stream_loop
                    )
                    try:
                        await current_loop.run_in_executor(None, future.result, 8.0)
                    except Exception as e:
                        logger.error(
                            f"Cross-loop stream teardown failed or timed out: {e}", exc_info=True
                        )
                else:
                    logger.info("Cancelling Alpaca stream task")
                    await self._cancel_and_close(stream_task)
            elif self._stock_stream:
                # No task on record (shouldn't normally happen — start_stream()
                # always sets both together) but a stream object still exists;
                # fall back to at least unsubscribing/closing it directly rather
                # than silently leaving it referenced with nothing tearing it down.
                await self.unsubscribe()
                try:
                    await asyncio.wait_for(self._stock_stream.close(), timeout=5.0)
                except Exception as e:
                    logger.error(f"Error closing Alpaca stock stream: {e}")

            self._is_running = False
            self._stock_stream = None
            self._stream_loop = None
            self._bar_handler_callback = None
            
            logger.info("Alpaca stream stopped successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error stopping Alpaca stream: {e}", exc_info=True)
            self._is_running = False
            return False

