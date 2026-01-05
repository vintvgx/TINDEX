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

from services.stock_streaming_base import StockStreamingService, StockBar

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
        
        self.alpaca_api_key = os.getenv("ALPACA_API_KEY")
        self.alpaca_secret_key = os.getenv("ALPACA_SECRET_KEY")
        
        if not self.alpaca_api_key:
            raise ValueError("ALPACA_API_KEY not defined")
        if not self.alpaca_secret_key:
            raise ValueError("ALPACA_SECRET_KEY not defined")
        
        self._stock_stream: Optional[StockDataStream] = None
        self._stream_task: Optional[asyncio.Task] = None
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
        """
        try:
            if not self._bar_handler_callback:
                logger.warning("Bar handler callback not set, ignoring bar data")
                return
            
            # Convert Alpaca Bar to standardized StockBar
            stock_bar = StockBar(
                symbol=data.symbol,
                open=Decimal(str(data.open)),
                high=Decimal(str(data.high)),
                low=Decimal(str(data.low)),
                close=Decimal(str(data.close)),
                volume=data.volume,
                timestamp=data.timestamp if hasattr(data, 'timestamp') else None
            )
            
            # Call the registered handler
            await self._bar_handler_callback(stock_bar)
            
        except Exception as e:
            logger.error(f"Error in Alpaca bar handler for {data.symbol}: {e}", exc_info=True)
    
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
            
            # Start the stream in a background task
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
            
            # Cancel the stream task first
            if self._stream_task is not None:
                logger.info("Cancelling Alpaca stream task")
                self._stream_task.cancel()
                try:
                    await asyncio.wait_for(self._stream_task, timeout=2.0)
                except asyncio.TimeoutError:
                    logger.warning("Alpaca stream task cancellation timed out")
                except asyncio.CancelledError:
                    logger.info("Alpaca stream task cancelled successfully")
                except Exception as e:
                    logger.error(f"Error awaiting Alpaca stream task cancellation: {e}")
                finally:
                    self._stream_task = None
            
            # Unsubscribe from all tickers
            await self.unsubscribe()
            
            # Close the stream connection
            if self._stock_stream:
                try:
                    await asyncio.wait_for(
                        self._stock_stream.close(),
                        timeout=5.0
                    )
                    logger.info("Alpaca stock stream connection closed")
                except asyncio.TimeoutError:
                    logger.warning("Alpaca stream close timed out")
                except Exception as e:
                    logger.error(f"Error closing Alpaca stock stream: {e}")
            
            self._is_running = False
            self._stock_stream = None
            self._bar_handler_callback = None
            
            logger.info("Alpaca stream stopped successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error stopping Alpaca stream: {e}", exc_info=True)
            self._is_running = False
            return False

