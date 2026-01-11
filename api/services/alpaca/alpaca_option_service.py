"""
Alpaca Options Service

This service handles options data retrieval and streaming from Alpaca API using the alpaca-py SDK.
It provides options data for integration with ORB monitoring system.

Architecture:
- Uses Alpaca Python SDK (alpaca-py) for options data retrieval
- Uses OptionHistoricalDataClient for one-time option data requests
- Supports options streaming via OptionDataStream (future)
- Provides filtering capabilities (strike, expiration, limit)
- Formats options data for integration with ORB monitoring

Design Pattern:
- Service layer pattern
- Singleton pattern for service instance
- Uses Alpaca SDK instead of direct HTTP requests
"""

import asyncio
import os
import logging
from typing import Dict, Optional, List, Callable
from datetime import datetime, timedelta, date
from decimal import Decimal

from alpaca.data.historical import OptionHistoricalDataClient
from alpaca.data.requests import OptionChainRequest
from alpaca.data.live import OptionDataStream
from alpaca.data.enums import DataFeed

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AlpacaOptionService:
    """
    Service for retrieving and streaming Alpaca Options data using the alpaca-py SDK.
    
    Architecture:
    - Uses Alpaca Python SDK (OptionHistoricalDataClient) for options data retrieval
    - Supports options streaming via OptionDataStream (future implementation)
    - Provides filtering capabilities (strike, expiration, limit)
    - Formats options data for integration with ORB monitoring
    
    Usage:
        option_service = get_alpaca_option_service()
        options = await option_service.get_options(
            ticker="IWM",
            feed="indicative",
            limit=25
        )
    """
    
    def __init__(self):
        """Initialize Alpaca Options service with API credentials."""
        self.alpaca_api_key = os.getenv("ALPACA_API_KEY")
        self.alpaca_secret_key = os.getenv("ALPACA_SECRET_KEY")
        
        if not self.alpaca_api_key:
            raise ValueError("ALPACA_API_KEY not defined")
        if not self.alpaca_secret_key:
            raise ValueError("ALPACA_SECRET_KEY not defined")
        
        # Initialize Alpaca SDK client for options data
        self.options_client = OptionHistoricalDataClient(
            api_key=self.alpaca_api_key,
            secret_key=self.alpaca_secret_key
        )
        
        # Options streaming (future implementation)
        self._option_stream: Optional[OptionDataStream] = None
        self._stream_task: Optional[asyncio.Task] = None
        self._is_streaming = False
        self._option_handler: Optional[Callable] = None
    
    async def get_options(
        self,
        ticker: str,
        feed: str = "indicative",
        limit: int = 25,
        strike_price_gte: Optional[float] = None,
        strike_price_lte: Optional[float] = None,
        expiration_date_gte: Optional[str] = None,
        expiration_date_lte: Optional[str] = None,
        current_price: Optional[float] = None
    ) -> Dict:
        """
        Retrieve options snapshots for a ticker using Alpaca Python SDK.
        
        Uses OptionHistoricalDataClient.get_option_chain() to retrieve options data,
        then applies client-side filtering and limit based on provided parameters.
        
        Args:
            ticker: Stock/ETF ticker symbol (e.g., "IWM", "AAPL")
            feed: Data feed ('indicative' for free, 'opra' for paid, default: 'indicative')
                 Note: OptionChainRequest may not support feed parameter directly
            limit: Maximum number of contracts to return (default: 25) - applied client-side
            strike_price_gte: Minimum strike price (if None, calculates as current_price - 10)
                             Passed to OptionChainRequest if provided
            strike_price_lte: Maximum strike price (if None, calculates as current_price + 10)
                             Passed to OptionChainRequest if provided
            expiration_date_gte: Minimum expiration date in format 'YYYY-MM-DD' 
                                 (if None, calculates as today + 7 days)
                                 Converted to date object for OptionChainRequest
            expiration_date_lte: Maximum expiration date in format 'YYYY-MM-DD'
                                 (if None, calculates as today + 14 days)
                                 Converted to date object for OptionChainRequest
            current_price: Current stock price (used for default strike calculations)
        
        Returns:
            Dict containing options data with structure:
            {
                "ticker": str,
                "current_price": float,
                "calls": List[Dict],
                "puts": List[Dict],
                "last_updated": str (ISO timestamp),
                "feed": str
            }
        
        Raises:
            ValueError: If ticker is invalid or current price cannot be retrieved
            Exception: If Alpaca SDK call fails
        """
        try:
            # Validate ticker
            ticker = ticker.strip().upper()
            if not ticker or len(ticker) > 5:
                raise ValueError(f"Invalid ticker symbol: {ticker}")
            
            # Calculate default strike prices if needed
            # Determine current price (required for default strike calculation)
            if current_price is not None:
                price_for_calculation = current_price
            else:
                fetched_price = await self._get_current_price(ticker)
                if fetched_price is not None:
                    price_for_calculation = fetched_price
                    current_price = fetched_price
                else:
                    logger.error(f"Could not retrieve current price for: {ticker}")
                    raise ValueError(f"Could not retrieve current price for: {ticker}")

            
            if strike_price_gte is None:
                strike_price_gte = max(0.01, price_for_calculation - 10.0)
            if strike_price_lte is None:
                strike_price_lte = price_for_calculation + 10.0
            
            # Calculate default expiration dates if needed
            today = datetime.now().date()
            expiration_date_gte_date: Optional[date] = None
            expiration_date_lte_date: Optional[date] = None
            
            if expiration_date_gte:
                expiration_date_gte_date = datetime.strptime(expiration_date_gte, '%Y-%m-%d').date()
            else:
                expiration_date_gte_date = today + timedelta(days=7)
            
            if expiration_date_lte:
                expiration_date_lte_date = datetime.strptime(expiration_date_lte, '%Y-%m-%d').date()
            else:
                expiration_date_lte_date = today + timedelta(days=14)
            
            logger.info(
                f"Fetching options for {ticker} using Alpaca SDK with params: "
                f"strike_gte={strike_price_gte}, strike_lte={strike_price_lte}, "
                f"exp_gte={expiration_date_gte_date}, exp_lte={expiration_date_lte_date}"
            )
            
            # Use Alpaca SDK to get option chain
            # Note: The SDK's OptionChainRequest supports filtering parameters
            # We apply limit client-side as the SDK doesn't support it
            loop = asyncio.get_event_loop()
            
            def fetch_option_chain():
                """Fetch option chain using Alpaca SDK (runs in executor)"""
                # Build OptionChainRequest with supported parameters
                # OptionChainRequest supports: underlying_symbol, strike_price_gte, strike_price_lte,
                # expiration_date_gte, expiration_date_lte, feed, type
                request = OptionChainRequest(
                    underlying_symbol=ticker,
                    strike_price_gte=strike_price_gte if strike_price_gte is not None else None,
                    strike_price_lte=strike_price_lte if strike_price_lte is not None else None,
                    expiration_date_gte=expiration_date_gte_date if expiration_date_gte_date else None,
                    expiration_date_lte=expiration_date_lte_date if expiration_date_lte_date else None,
                    # Note: feed parameter support may vary by SDK version
                )
                
                # Get option chain using SDK (returns dict of symbol -> snapshot)
                option_chain = self.options_client.get_option_chain(request)
                return option_chain
            
            # Run SDK call in executor (SDK methods are synchronous)
            option_chain = await loop.run_in_executor(None, fetch_option_chain)
            
            # Process and filter the option chain data (apply limit client-side)
            final_price = current_price if current_price is not None else price_for_calculation
            return self._process_option_chain(
                ticker=ticker,
                option_chain=option_chain,
                current_price=final_price,
                feed=feed,
                limit=limit,
                strike_price_gte=strike_price_gte,
                strike_price_lte=strike_price_lte,
                expiration_date_gte=expiration_date_gte_date,
                expiration_date_lte=expiration_date_lte_date
            )
        
        except Exception as e:
            logger.error(f"Error fetching options for {ticker}: {e}", exc_info=True)
            raise
    
    async def _get_current_price(self, ticker: str) -> Optional[float]:
        """
        Get current price for a ticker (used for default strike calculations).
        
        This is a helper method. In production, you might want to get this
        from your existing price data source.
        """
        try:
            import yfinance as yf
            loop = asyncio.get_event_loop()
            
            def fetch_price():
                stock = yf.Ticker(ticker)
                info = stock.info
                return info.get("currentPrice") or info.get("regularMarketPrice")
            
            price = await loop.run_in_executor(None, fetch_price)
            return float(price) if price else None
        except Exception as e:
            logger.warning(f"Could not fetch current price for {ticker}: {e}")
            return None
    
    def _process_option_chain(
        self,
        ticker: str,
        option_chain: Dict,
        current_price: float,
        feed: str,
        limit: int,
        strike_price_gte: Optional[float],
        strike_price_lte: Optional[float],
        expiration_date_gte: date,
        expiration_date_lte: date
    ) -> Dict:
        """
        Process option chain from Alpaca SDK and apply filters.
        
        Args:
            ticker: Stock ticker symbol
            option_chain: Option chain data from Alpaca SDK (dict of symbol -> snapshot)
            current_price: Current stock price
            feed: Data feed used
            limit: Maximum contracts to return
            strike_price_gte: Minimum strike price filter
            strike_price_lte: Maximum strike price filter
            expiration_date_gte: Minimum expiration date filter
            expiration_date_lte: Maximum expiration date filter
        
        Returns:
            Formatted options data dict with calls and puts
        """
        try:
            calls = []
            puts = []
            
            # Process each option contract in the chain
            for option_symbol, snapshot in option_chain.items():
                try:
                    # Extract option details from symbol (format: TICKERYYMMDDC/PSTRIKE)
                    # or from snapshot if available
                    contract_data = self._extract_option_data(option_symbol, snapshot, ticker)
                    
                    if not contract_data:
                        continue
                    
                    # Apply filters
                    # Filter by strike price
                    if strike_price_gte is not None and contract_data["strike"] < strike_price_gte:
                        continue
                    if strike_price_lte is not None and contract_data["strike"] > strike_price_lte:
                        continue
                    
                    # Filter by expiration date
                    if contract_data["expiration"]:
                        exp_date = datetime.strptime(contract_data["expiration"], '%Y-%m-%d').date()
                        if exp_date < expiration_date_gte or exp_date > expiration_date_lte:
                            continue
                    
                    # Categorize as call or put
                    if contract_data["option_type"] == "CALL":
                        calls.append(contract_data)
                    elif contract_data["option_type"] == "PUT":
                        puts.append(contract_data)
                
                except Exception as e:
                    logger.warning(f"Error processing option contract {option_symbol}: {e}")
                    continue
            
            # Sort and limit results
            calls = sorted(calls, key=lambda x: x.get("strike", 0))[:limit]
            puts = sorted(puts, key=lambda x: x.get("strike", 0))[:limit]
            
            return {
                "ticker": ticker,
                "current_price": current_price,
                "calls": calls,
                "puts": puts,
                "last_updated": datetime.now().isoformat() + "Z",
                "feed": feed
            }
        
        except Exception as e:
            logger.error(f"Error processing option chain: {e}", exc_info=True)
            return self._empty_options_response(ticker, feed)
    
    def _extract_option_data(self, option_symbol: str, snapshot, ticker: str) -> Optional[Dict]:
        """
        Extract option contract data from Alpaca SDK snapshot.
        
        Args:
            option_symbol: Option contract symbol (OCC format)
            snapshot: Option snapshot from Alpaca SDK
            ticker: Underlying ticker symbol
        
        Returns:
            Dict with option contract data or None if parsing fails
        """
        try:
            # Parse option type from symbol (last character before strike: C for Call, P for Put)
            # OCC format: TICKERYYMMDDC/PSTRIKE
            option_type = "CALL"
            if option_symbol and len(option_symbol) > 10:
                if option_symbol[-10] == "P":
                    option_type = "PUT"
                elif option_symbol[-10] == "C":
                    option_type = "CALL"
            
            # Extract strike price from snapshot or symbol
            strike = 0.0
            if hasattr(snapshot, 'contract') and hasattr(snapshot.contract, 'strike_price'):
                strike = float(snapshot.contract.strike_price)
            elif hasattr(snapshot, 'strike_price'):
                strike = float(snapshot.strike_price)
            
            # Extract expiration date
            expiration = ""
            if hasattr(snapshot, 'contract') and hasattr(snapshot.contract, 'expiration_date'):
                exp_date = snapshot.contract.expiration_date
                expiration = exp_date.isoformat() if hasattr(exp_date, 'isoformat') else str(exp_date)
            
            # Extract price data
            last_price = None
            bid = None
            ask = None
            if hasattr(snapshot, 'latest_trade') and snapshot.latest_trade:
                last_price = float(snapshot.latest_trade.price) if hasattr(snapshot.latest_trade, 'price') else None
            
            if hasattr(snapshot, 'latest_quote') and snapshot.latest_quote:
                if hasattr(snapshot.latest_quote, 'bid_price'):
                    bid = float(snapshot.latest_quote.bid_price)
                if hasattr(snapshot.latest_quote, 'ask_price'):
                    ask = float(snapshot.latest_quote.ask_price)
            
            # Extract Greeks
            delta = None
            gamma = None
            theta = None
            vega = None
            if hasattr(snapshot, 'greeks') and snapshot.greeks:
                delta = float(snapshot.greeks.delta) if hasattr(snapshot.greeks, 'delta') else None
                gamma = float(snapshot.greeks.gamma) if hasattr(snapshot.greeks, 'gamma') else None
                theta = float(snapshot.greeks.theta) if hasattr(snapshot.greeks, 'theta') else None
                vega = float(snapshot.greeks.vega) if hasattr(snapshot.greeks, 'vega') else None
            
            # Extract implied volatility
            iv = None
            if hasattr(snapshot, 'implied_volatility'):
                iv = float(snapshot.implied_volatility)
            
            return {
                "symbol": option_symbol,
                "ticker": ticker,
                "strike": strike,
                "expiration": expiration,
                "option_type": option_type,
                "last_price": last_price,
                "bid": bid,
                "ask": ask,
                "volume": None,  # May not be available in snapshot
                "open_interest": None,  # May not be available in snapshot
                "implied_volatility": iv,
                "delta": delta,
                "gamma": gamma,
                "theta": theta,
                "vega": vega,
                "timestamp": datetime.now().isoformat() + "Z"
            }
        
        except Exception as e:
            logger.warning(f"Error extracting option data from {option_symbol}: {e}")
            return None
    
    def _empty_options_response(self, ticker: str, feed: str) -> Dict:
        """Return empty options response structure."""
        return {
            "ticker": ticker,
            "current_price": None,
            "calls": [],
            "puts": [],
            "last_updated": datetime.now().isoformat() + "Z",
            "feed": feed
        }
    
    async def start_options_stream(
    self,
    symbols: List[str],
    option_handler: Callable,
    feed: str = "indicative"
    ) -> bool:
        """
        Start streaming options data for specified option symbols.
        
        Args:
            symbols: List of option contract symbols (OCC format, e.g., ["AAPL240119C00150000"])
            option_handler: Async callback function for option updates
            feed: Data feed ('indicative' for free, 'opra' for paid)
        
        Returns:
            True if stream started successfully, False otherwise
        """
        if self._is_streaming:
            logger.warning("Options stream already running")
            return False
        
        try:
            # Determine the feed type
            data_feed = DataFeed.INDICATIVE if feed == "indicative" else DataFeed.OPRA
            
            # Initialize OptionDataStream
            self._option_stream = OptionDataStream(
                api_key=self.alpaca_api_key,
                secret_key=self.alpaca_secret_key,
                feed=data_feed
            )
            
            self._option_handler = option_handler
            
            # Define handlers for different data types
            async def handle_quote(data):
                """Handle option quote updates"""
                try:
                    formatted_data = {
                        "type": "quote",
                        "symbol": data.symbol,
                        "bid": float(data.bid_price) if data.bid_price else None,
                        "ask": float(data.ask_price) if data.ask_price else None,
                        "bid_size": data.bid_size,
                        "ask_size": data.ask_size,
                        "timestamp": data.timestamp.isoformat() if data.timestamp else None
                    }
                    await self._option_handler(formatted_data)
                except Exception as e:
                    logger.error(f"Error handling option quote: {e}")
            
            async def handle_trade(data):
                """Handle option trade updates"""
                try:
                    formatted_data = {
                        "type": "trade",
                        "symbol": data.symbol,
                        "price": float(data.price) if data.price else None,
                        "size": data.size,
                        "timestamp": data.timestamp.isoformat() if data.timestamp else None,
                        "exchange": data.exchange if hasattr(data, 'exchange') else None
                    }
                    await self._option_handler(formatted_data)
                except Exception as e:
                    logger.error(f"Error handling option trade: {e}")
            
            # Subscribe to quotes and trades for the specified symbols
            self._option_stream.subscribe_quotes(handle_quote, *symbols)
            self._option_stream.subscribe_trades(handle_trade, *symbols)
            
            # Run the stream in a background task
            self._is_streaming = True
            self._stream_task = asyncio.create_task(self._run_option_stream())
            
            logger.info(f"Options stream started for {len(symbols)} symbols")
            return True
        
        except Exception as e:
            logger.error(f"Error starting options stream: {e}", exc_info=True)
            self._is_streaming = False
            return False
    
    async def stop_options_stream(self) -> bool:
        """Stop the options stream (future implementation)."""
        if not self._is_streaming:
            return True
        
        try:
            if self._stream_task:
                self._stream_task.cancel()
                try:
                    await self._stream_task
                except asyncio.CancelledError:
                    pass
            
            if self._option_stream:
                await self._option_stream.close()
            
            self._is_streaming = False
            self._option_handler = None
            logger.info("Options stream stopped")
            return True
        
        except Exception as e:
            logger.error(f"Error stopping options stream: {e}", exc_info=True)
            return False


# Global instance for singleton pattern
_alpaca_option_service = None


def get_alpaca_option_service() -> AlpacaOptionService:
    """Get or create the singleton AlpacaOptionService instance."""
    global _alpaca_option_service
    
    if _alpaca_option_service is None:
        try:
            _alpaca_option_service = AlpacaOptionService()
            logger.info("AlpacaOptionService singleton created")
        except Exception as e:
            logger.error(f"Failed to initialize AlpacaOptionService: {str(e)}", exc_info=True)
            raise Exception(f"Alpaca option service initialization failed: {str(e)}") from e
    
    return _alpaca_option_service


def reset_alpaca_option_service():
    """Reset the singleton instance (useful for testing or restarts)."""
    global _alpaca_option_service
    _alpaca_option_service = None
    logger.info("AlpacaOptionService singleton reset")
