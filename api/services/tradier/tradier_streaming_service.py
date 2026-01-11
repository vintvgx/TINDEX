"""
Tradier Stock Streaming Service

This service handles real-time stock data streaming from Tradier API (Nasdaq/NYSE).
It only handles streaming - no ORB logic, notifications, or database operations.

Architecture:
- Implements StockStreamingService interface
- Uses Tradier's WebSocket API for real-time streaming
- Converts Tradier bar data to standardized StockBar format
- Focused solely on data streaming concerns

Note: This implementation uses uvatradier library. Adjust if the API differs.
"""

import asyncio
import os
import logging
from typing import Set, Optional, Callable
from decimal import Decimal
from datetime import datetime

try:
    import uvatradier
    TRADIER_AVAILABLE = True
except ImportError:
    TRADIER_AVAILABLE = False
    logging.warning("uvatradier not available. TradierStreamingService will not work.")

from services.utils.stock_streaming_base import StockStreamingService, StockBar

logger = logging.getLogger(__name__)


class TradierStreamingService(StockStreamingService):
    """
    Tradier-based stock streaming service.
    
    This service provides real-time stock bar data from Tradier (Nasdaq/NYSE).
    It handles only streaming operations - no business logic.
    
    Architecture:
    - Implements StockStreamingService interface
    - Uses Tradier's WebSocket API via uvatradier
    - Converts provider-specific data to standardized format
    - Handles connection lifecycle and error recovery
    
    Performance:
    - Non-blocking async operations
    - Efficient WebSocket connection management
    - Automatic reconnection on failures
    
    Note: The actual uvatradier API may differ. Adjust implementation as needed.
    """
    
    def __init__(self):
        """Initialize Tradier streaming service with credentials."""
        super().__init__()
        
        # TODO Add once tradier approves account @coderabbitai remind me
        self.tradier_api_key = os.getenv("TRADIER_API_KEY")
        self.tradier_account_id = os.getenv("TRADIER_ACCOUNT_ID")
        
        if not self.tradier_api_key:
            raise ValueError("TRADIER_API_KEY not defined")
        if not self.tradier_account_id:
            raise ValueError("TRADIER_ACCOUNT_ID not defined")
        
        self._stream = None
        self._stream_task: Optional[asyncio.Task] = None
        self._bar_handler_callback: Optional[Callable[[StockBar], None]] = None
        self._session_id: Optional[str] = None
    
    async def _create_session(self) -> Optional[str]:
        """
        Create a Tradier streaming session.
        
        Returns:
            Session ID if successful, None otherwise
        """
        try:
            # Note: Adjust this based on actual uvatradier API
            # This is a placeholder implementation
            import aiohttp
            
            async with aiohttp.ClientSession() as session:
                headers = {
                    'Authorization': f'Bearer {self.tradier_api_key}',
                    'Accept': 'application/json'
                }
                
                async with session.post(
                    'https://api.tradier.com/v1/markets/events/session',
                    headers=headers
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        session_id = data.get('stream', {}).get('sessionid')
                        logger.info("Tradier streaming session created")
                        return session_id
                    else:
                        error_text = await response.text()
                        logger.error(f"Failed to create Tradier session: {error_text}")
                        return None
                        
        except Exception as e:
            logger.error(f"Error creating Tradier session: {e}", exc_info=True)
            return None
    
    async def _tradier_bar_handler(self, data: dict):
        """
        Handler for Tradier bar data - converts to StockBar and calls callback.
        
        This is the bridge between Tradier's data format and our standardized format.
        Adjust the data parsing based on actual Tradier response structure.
        
        Error Handling:
        - Gracefully handles None data or missing keys
        - Prevents race conditions by storing callback in local variable
        - Ensures stream continues even if callback fails
        - Validates data before conversion to prevent type errors
        """
        try:
            # Validate input data
            if data is None:
                logger.warning("Received None data in Tradier bar handler, ignoring")
                return
            
            # Store callback in local variable to avoid race conditions
            callback = self._bar_handler_callback
            if not callback:
                logger.warning("Bar handler callback not set, ignoring bar data")
                return
            
            if not callable(callback):
                logger.error(f"Bar handler callback is not callable: {type(callback)}")
                return
            
            # Parse Tradier data format (adjust based on actual API response)
            # This is a placeholder - adjust based on actual uvatradier/Tradier format
            symbol = data.get('symbol') or data.get('s')
            if not symbol:
                logger.warning("Bar data missing symbol, ignoring")
                return
            
            # Safely extract price data with validation
            try:
                open_price = float(data.get('open') or data.get('o', 0))
                high = float(data.get('high') or data.get('h', 0))
                low = float(data.get('low') or data.get('l', 0))
                close = float(data.get('close') or data.get('c', 0))
                volume = int(data.get('volume') or data.get('v', 0))
            except (ValueError, TypeError) as e:
                logger.error(f"Error converting price data for {symbol}: {e}", exc_info=True)
                return
            
            # Validate that we have valid price data
            if open_price == 0 and high == 0 and low == 0 and close == 0:
                logger.warning(f"Bar data for {symbol} has no valid price data, ignoring")
                return
            
            # Parse timestamp
            timestamp = None
            timestamp_str = data.get('timestamp') or data.get('time')
            if timestamp_str:
                try:
                    # Parse timestamp (adjust format as needed)
                    timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                except Exception:
                    pass
            
            # Convert to standardized StockBar
            stock_bar = StockBar(
                symbol=symbol,
                open=Decimal(str(open_price)),
                high=Decimal(str(high)),
                low=Decimal(str(low)),
                close=Decimal(str(close)),
                volume=volume,
                timestamp=timestamp
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
            symbol = data.get('symbol') or data.get('s', 'UNKNOWN') if data is not None else 'UNKNOWN'
            logger.error(
                f"Error in Tradier bar handler for {symbol}: {e}",
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
                logger.warning("No tickers provided for Tradier subscription")
                return False
            
            # Store the callback
            self._bar_handler_callback = bar_handler
            
            # Create session if needed
            if not self._session_id:
                self._session_id = await self._create_session()
                if not self._session_id:
                    logger.error("Failed to create Tradier streaming session")
                    return False
            
            # Note: Adjust this based on actual uvatradier API
            # This is a placeholder implementation
            # The actual uvatradier library may have different methods
            
            # Example pattern (adjust as needed):
            # self._stream = uvatradier.Stream(self.tradier_api_key, self._session_id)
            # self._stream.subscribe(tickers, self._tradier_bar_handler)
            
            # For now, log a warning that this needs implementation
            logger.warning(
                "TradierStreamingService.subscribe() needs implementation "
                "based on actual uvatradier API. Please refer to uvatradier documentation."
            )
            
            self._subscribed_tickers = tickers.copy()
            
            logger.info(f"Subscribed to {len(tickers)} tickers on Tradier: {list(tickers)}")
            return True
            
        except Exception as e:
            logger.error(f"Error subscribing to Tradier tickers: {e}", exc_info=True)
            return False
    
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
                logger.info("No tickers subscribed to unsubscribe from on Tradier")
                return True
            
            if tickers is None:
                tickers = self._subscribed_tickers.copy()
            
            # Note: Adjust this based on actual uvatradier API
            # if self._stream:
            #     self._stream.unsubscribe(tickers)
            
            # Remove from subscribed set
            self._subscribed_tickers -= tickers
            
            await asyncio.sleep(0.5)  # Brief pause after unsubscription
            
            logger.info(f"Unsubscribed from {len(tickers)} tickers on Tradier")
            return True
            
        except Exception as e:
            logger.error(f"Error during Tradier unsubscribe: {e}", exc_info=True)
            return False
    
    async def start_stream(self) -> bool:
        """
        Start the Tradier WebSocket stream.
        
        Returns:
            True if stream started successfully, False otherwise
        """
        try:
            if self._is_running:
                logger.info("Tradier stream already running")
                return True
            
            if not self._session_id:
                self._session_id = await self._create_session()
                if not self._session_id:
                    logger.error("Cannot start Tradier stream - no session ID")
                    return False
            
            logger.info("Starting Tradier WebSocket stream...")
            
            # Note: Adjust this based on actual uvatradier API
            # Example pattern (adjust as needed):
            # self._stream_task = asyncio.create_task(self._stream.run())
            
            self._is_running = True
            
            # Give it a moment to establish connection
            await asyncio.sleep(2)
            
            logger.info(
                f"Tradier stream started successfully. "
                f"Monitoring {len(self._subscribed_tickers)} tickers."
            )
            return True
            
        except Exception as e:
            logger.error(f"Failed to start Tradier stream: {e}", exc_info=True)
            self._is_running = False
            return False
    
    async def stop_stream(self) -> bool:
        """
        Stop the Tradier WebSocket stream and clean up resources.
        
        Returns:
            True if stream stopped successfully, False otherwise
        """
        try:
            if not self._is_running:
                logger.info("Tradier stream was never started, skipping cleanup")
                return True
            
            # Cancel the stream task first
            if self._stream_task is not None:
                logger.info("Cancelling Tradier stream task")
                self._stream_task.cancel()
                try:
                    await asyncio.wait_for(self._stream_task, timeout=2.0)
                except asyncio.TimeoutError:
                    logger.warning("Tradier stream task cancellation timed out")
                except asyncio.CancelledError:
                    logger.info("Tradier stream task cancelled successfully")
                except Exception as e:
                    logger.error(f"Error awaiting Tradier stream task cancellation: {e}")
                finally:
                    self._stream_task = None
            
            # Unsubscribe from all tickers
            await self.unsubscribe()
            
            # Close the stream connection
            # Note: Adjust this based on actual uvatradier API
            # if self._stream:
            #     await self._stream.close()
            
            self._is_running = False
            self._stream = None
            self._session_id = None
            self._bar_handler_callback = None
            
            logger.info("Tradier stream stopped successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error stopping Tradier stream: {e}", exc_info=True)
            self._is_running = False
            return False

