"""
Base classes and interfaces for stock streaming services.

This module provides:
- Standardized Bar data model for consistent data representation
- Base class interface for streaming services (Alpaca, Tradier, etc.)
- Type definitions for streaming handlers

Architecture:
- Abstract base class pattern for streaming services
- Standardized data models across different providers
- Clean separation of streaming logic from business logic
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
from typing import Callable, Set, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class StockBar:
    """
    Standardized bar data model for stock price bars.
    
    This model is provider-agnostic and used across all streaming services
    to ensure consistent data representation.
    
    Attributes:
        symbol: Stock ticker symbol (e.g., 'AAPL')
        open: Opening price
        high: Highest price in the bar
        low: Lowest price in the bar
        close: Closing price
        volume: Trading volume
        timestamp: Bar timestamp (optional)
    """
    symbol: str
    open: Decimal | None
    high: Decimal | None
    low: Decimal | None
    close: Decimal | None
    volume: int
    timestamp: Optional[datetime] = None


class StockStreamingService(ABC):
    """
    Abstract base class for stock streaming services.
    
    This interface defines the contract that all streaming services must implement,
    allowing the ORB service to work with any provider (Alpaca, Tradier, etc.).
    
    Architecture:
    - Provider-agnostic interface
    - Async streaming support
    - Standardized bar data format
    - Lifecycle management (start/stop/subscribe)
    
    Implementation Notes:
    - Each provider (Alpaca, Tradier) implements this interface
    - The ORB service uses this interface, not concrete implementations
    - Allows for easy swapping between providers
    """
    
    def __init__(self):
        """Initialize the streaming service."""
        self._is_running = False
        self._subscribed_tickers: Set[str] = set()
        self._bar_handler: Optional[Callable[[StockBar], None]] = None
    
    @abstractmethod
    async def subscribe(self, tickers: Set[str], bar_handler: Callable[[StockBar], None]) -> bool:
        """
        Subscribe to bar data for the given tickers.
        
        Args:
            tickers: Set of ticker symbols to subscribe to
            bar_handler: Async callback function that receives StockBar objects
            
        Returns:
            True if subscription successful, False otherwise
        """
        pass
    
    @abstractmethod
    async def unsubscribe(self, tickers: Optional[Set[str]] = None) -> bool:
        """
        Unsubscribe from tickers.
        
        Args:
            tickers: Set of tickers to unsubscribe from. If None, unsubscribe from all.
            
        Returns:
            True if successful, False otherwise
        """
        pass
    
    @abstractmethod
    async def start_stream(self) -> bool:
        """
        Start the streaming connection.
        
        Returns:
            True if stream started successfully, False otherwise
        """
        pass
    
    @abstractmethod
    async def stop_stream(self) -> bool:
        """
        Stop the streaming connection and clean up resources.
        
        Returns:
            True if stream stopped successfully, False otherwise
        """
        pass
    
    @property
    def is_running(self) -> bool:
        """Check if the stream is currently running."""
        return self._is_running
    
    @property
    def subscribed_tickers(self) -> Set[str]:
        """Get the set of currently subscribed tickers."""
        return self._subscribed_tickers.copy()
    
    def _convert_to_stock_bar(self, symbol: str, open_price: float, high: float, 
                              low: float, close: float, volume: int, 
                              timestamp: Optional[datetime] = None) -> StockBar:
        """
        Helper method to create a standardized StockBar from provider-specific data.
        
        Args:
            symbol: Ticker symbol
            open_price: Opening price
            high: High price
            low: Low price
            close: Closing price
            volume: Volume
            timestamp: Optional timestamp
            
        Returns:
            StockBar instance with Decimal precision
        """
        return StockBar(
            symbol=symbol,
            open=Decimal(str(open_price)),
            high=Decimal(str(high)),
            low=Decimal(str(low)),
            close=Decimal(str(close)),
            volume=int(volume),
            timestamp=timestamp
        )

