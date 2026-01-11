"""
Tradier Options Service

This service handles options data retrieval from Tradier API using the uvatradier SDK.
It provides options data for integration with ORB monitoring system.

Architecture:
- Uses uvatradier Python SDK for options data retrieval
- Uses OptionsData class for options chain requests
- Uses Quotes class for current price data
- Uses Stream class for real-time streaming (future)
- Provides filtering capabilities (strike, expiration, limit)
- Formats options data for integration with ORB monitoring

Design Pattern:
- Service layer pattern
- Singleton pattern for service instance
- Uses uvatradier SDK instead of direct HTTP requests

Installation:
    pip install uvatradier

Environment Variables Required:
    TRADIER_ACCOUNT_NUMBER - Your Tradier account number
    TRADIER_API_KEY - Your Tradier API access token
    TRADIER_LIVE_TRADE - Set to 'true' for production (default: false/sandbox)
"""

import asyncio
import os
import logging
from typing import Dict, Optional, List, Callable
from datetime import datetime, timedelta, date

from uvatradier import Quotes, OptionsData, Stream

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TradierOptionService:
    """
    Service for retrieving and streaming Tradier Options data using the uvatradier SDK.
    
    Architecture:
    - Uses uvatradier Python SDK (OptionsData) for options data retrieval
    - Supports options streaming via Stream class
    - Provides filtering capabilities (strike, expiration, limit)
    - Formats options data for integration with ORB monitoring
    
    Tradier provides consolidated exchange data with Greeks included via ORATS,
    making it ideal for comprehensive options analysis.
    
    Usage:
        option_service = get_tradier_option_service()
        options = await option_service.get_options(
            ticker="IWM",
            limit=25
        )
    """
    
    def __init__(self):
        """Initialize Tradier Options service with API credentials."""
        if not UVATRADIER_AVAILABLE:
            raise ImportError("uvatradier package is required. Install with: pip install uvatradier")
        
        self.tradier_account = os.getenv("TRADIER_ACCOUNT_NUMBER")
        self.tradier_api_key = os.getenv("TRADIER_API_KEY")
        self.live_trade = os.getenv("TRADIER_LIVE_TRADE", "false").lower() == "true"
        
        if not self.tradier_account:
            raise ValueError("TRADIER_ACCOUNT_NUMBER not defined")
        if not self.tradier_api_key:
            raise ValueError("TRADIER_ACCESS_TOKEN not defined")
        
        # Initialize uvatradier SDK clients
        self.quotes = Quotes(self.tradier_account, self.tradier_api_key, live_trade=self.live_trade)
        self.options_data = OptionsData(self.tradier_account, self.tradier_api_key, live_trade=self.live_trade)
        
        # Streaming (requires live_trade=True)
        self._stream: Optional[Stream] = None
        self._stream_task: Optional[asyncio.Task] = None
        self._is_streaming = False
        self._option_handler: Optional[Callable] = None
        
        logger.info(f"TradierOptionService initialized (live_trade={self.live_trade})")
    
    async def get_options(
        self,
        ticker: str,
        limit: int = 25,
        strike_price_gte: Optional[float] = None,
        strike_price_lte: Optional[float] = None,
        expiration_date_gte: Optional[str] = None,
        expiration_date_lte: Optional[str] = None,
        current_price: Optional[float] = None,
        include_greeks: bool = True
    ) -> Dict:
        """
        Retrieve options chain for a ticker using Tradier/uvatradier SDK.
        
        Tradier provides consolidated exchange data with Greeks included via ORATS,
        making it superior to IEX-only data sources for options analysis.
        
        Args:
            ticker: Stock/ETF ticker symbol (e.g., "IWM", "AAPL")
            limit: Maximum number of contracts to return per type (default: 25)
            strike_price_gte: Minimum strike price filter (if None, uses current_price - 10)
            strike_price_lte: Maximum strike price filter (if None, uses current_price + 10)
            expiration_date_gte: Minimum expiration date 'YYYY-MM-DD' (default: today + 7 days)
            expiration_date_lte: Maximum expiration date 'YYYY-MM-DD' (default: today + 14 days)
            current_price: Current stock price (fetched if not provided)
            include_greeks: Whether to include Greeks data (default: True)
        
        Returns:
            Dict containing options data with structure:
            {
                "ticker": str,
                "current_price": float,
                "calls": List[Dict],
                "puts": List[Dict],
                "last_updated": str (ISO timestamp),
                "source": "tradier"
            }
        
        Raises:
            ValueError: If ticker is invalid or current price cannot be retrieved
            Exception: If Tradier SDK call fails
        """
        try:
            # Validate ticker
            ticker = ticker.strip().upper()
            if not ticker or len(ticker) > 5:
                raise ValueError(f"Invalid ticker symbol: {ticker}")
            
            # Get current price if not provided
            if current_price is None:
                current_price = await self._get_current_price(ticker)
                if current_price is None:
                    logger.error(f"Could not retrieve current price for: {ticker}")
                    raise ValueError(f"Could not retrieve current price for: {ticker}")
            
            # Calculate default strike price range if not provided
            if strike_price_gte is None:
                strike_price_gte = max(0.01, current_price - 10.0)
            if strike_price_lte is None:
                strike_price_lte = current_price + 10.0
            
            # Calculate default expiration dates if not provided
            today = datetime.now().date()
            
            if expiration_date_gte:
                exp_gte_date = datetime.strptime(expiration_date_gte, '%Y-%m-%d').date()
            else:
                exp_gte_date = today + timedelta(days=7)
            
            if expiration_date_lte:
                exp_lte_date = datetime.strptime(expiration_date_lte, '%Y-%m-%d').date()
            else:
                exp_lte_date = today + timedelta(days=14)
            
            logger.info(
                f"Fetching options for {ticker} using Tradier SDK with params: "
                f"strike_gte={strike_price_gte}, strike_lte={strike_price_lte}, "
                f"exp_gte={exp_gte_date}, exp_lte={exp_lte_date}"
            )
            
            # Get expiration dates within range
            loop = asyncio.get_event_loop()
            
            def fetch_expirations():
                """Fetch available expiration dates for the ticker."""
                try:
                    expirations = self.options_data.get_expiry_dates(ticker)
                    return expirations
                except Exception as e:
                    logger.warning(f"Error fetching expirations for {ticker}: {e}")
                    return []
            
            expirations = await loop.run_in_executor(None, fetch_expirations)
            
            if not expirations or (hasattr(expirations, 'empty') and expirations.empty):
                logger.warning(f"No expiration dates found for {ticker}")
                return self._empty_options_response(ticker)
            
            # Filter expirations within date range
            # Handle both DataFrame and list returns from uvatradier
            if hasattr(expirations, 'tolist'):
                expiration_list = expirations.tolist() if hasattr(expirations, 'tolist') else list(expirations)
            elif hasattr(expirations, 'values'):
                expiration_list = expirations.values.tolist() if hasattr(expirations.values, 'tolist') else list(expirations)
            else:
                expiration_list = list(expirations) if expirations else []
            
            filtered_expirations = []
            for exp in expiration_list:
                try:
                    if isinstance(exp, str):
                        exp_date = datetime.strptime(exp, '%Y-%m-%d').date()
                    elif hasattr(exp, 'date'):
                        exp_date = exp.date()
                    else:
                        exp_date = exp
                    
                    if exp_gte_date <= exp_date <= exp_lte_date:
                        filtered_expirations.append(exp if isinstance(exp, str) else exp_date.strftime('%Y-%m-%d'))
                except (ValueError, TypeError) as e:
                    logger.warning(f"Could not parse expiration date {exp}: {e}")
                    continue
            
            if not filtered_expirations:
                logger.warning(f"No expirations found within date range for {ticker}")
                # Fall back to nearest expiration if available
                if expiration_list:
                    filtered_expirations = [expiration_list[0] if isinstance(expiration_list[0], str) 
                                           else expiration_list[0].strftime('%Y-%m-%d') if hasattr(expiration_list[0], 'strftime')
                                           else str(expiration_list[0])]
                else:
                    return self._empty_options_response(ticker)
            
            # Fetch option chains for each expiration
            all_calls = []
            all_puts = []
            
            for expiration in filtered_expirations:
                def fetch_chain(exp=expiration):
                    """Fetch option chain for a specific expiration."""
                    try:
                        # get_chain_day returns DataFrame with options data including greeks
                        chain = self.options_data.get_chain_day(ticker, exp)
                        return chain
                    except Exception as e:
                        logger.warning(f"Error fetching chain for {ticker} exp={exp}: {e}")
                        return None
                
                chain = await loop.run_in_executor(None, fetch_chain)
                
                if chain is None or (hasattr(chain, 'empty') and chain.empty):
                    continue
                
                # Process the chain data
                calls, puts = self._process_chain_data(
                    chain=chain,
                    ticker=ticker,
                    expiration=expiration,
                    strike_price_gte=strike_price_gte,
                    strike_price_lte=strike_price_lte,
                    include_greeks=include_greeks
                )
                
                all_calls.extend(calls)
                all_puts.extend(puts)
            
            # Sort by strike and apply limit
            all_calls = sorted(all_calls, key=lambda x: x.get("strike", 0))[:limit]
            all_puts = sorted(all_puts, key=lambda x: x.get("strike", 0))[:limit]
            
            return {
                "ticker": ticker,
                "current_price": current_price,
                "calls": all_calls,
                "puts": all_puts,
                "last_updated": datetime.now().isoformat() + "Z",
                "source": "tradier",
                "expirations_fetched": filtered_expirations
            }
        
        except Exception as e:
            logger.error(f"Error fetching options for {ticker}: {e}", exc_info=True)
            raise
    
    async def _get_current_price(self, ticker: str) -> Optional[float]:
        """
        Get current price for a ticker using Tradier Quotes.
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            Current price or None if unavailable
        """
        try:
            loop = asyncio.get_event_loop()
            
            def fetch_quote():
                """Fetch quote using Tradier SDK."""
                try:
                    quote = self.quotes.get_quote_day(ticker)
                    if quote is not None:
                        # Handle DataFrame return
                        if hasattr(quote, 'iloc'):
                            if 'last' in quote.columns:
                                return float(quote['last'].iloc[0])
                            elif 'close' in quote.columns:
                                return float(quote['close'].iloc[0])
                        # Handle dict return
                        elif isinstance(quote, dict):
                            return float(quote.get('last') or quote.get('close', 0))
                    return None
                except Exception as e:
                    logger.warning(f"Tradier quote fetch failed for {ticker}: {e}")
                    return None
            
            price = await loop.run_in_executor(None, fetch_quote)
            
            # Fallback to yfinance if Tradier fails
            if price is None:
                try:
                    import yfinance as yf
                    def fetch_yf_price():
                        stock = yf.Ticker(ticker)
                        info = stock.info
                        return info.get("currentPrice") or info.get("regularMarketPrice")
                    price = await loop.run_in_executor(None, fetch_yf_price)
                except Exception as e:
                    logger.warning(f"yfinance fallback failed for {ticker}: {e}")
            
            return float(price) if price else None
        
        except Exception as e:
            logger.warning(f"Could not fetch current price for {ticker}: {e}")
            return None
    
    def _process_chain_data(
        self,
        chain,
        ticker: str,
        expiration: str,
        strike_price_gte: float,
        strike_price_lte: float,
        include_greeks: bool = True
    ) -> tuple:
        """
        Process option chain data from Tradier SDK.
        
        Args:
            chain: Option chain DataFrame from uvatradier
            ticker: Underlying ticker symbol
            expiration: Expiration date string
            strike_price_gte: Minimum strike price filter
            strike_price_lte: Maximum strike price filter
            include_greeks: Whether to include Greeks data
            
        Returns:
            Tuple of (calls_list, puts_list)
        """
        calls = []
        puts = []
        
        try:
            # Handle DataFrame from uvatradier
            if hasattr(chain, 'iterrows'):
                for idx, row in chain.iterrows():
                    try:
                        contract_data = self._extract_contract_data(
                            row=row,
                            ticker=ticker,
                            expiration=expiration,
                            include_greeks=include_greeks
                        )
                        
                        if not contract_data:
                            continue
                        
                        # Apply strike price filter
                        strike = contract_data.get("strike", 0)
                        if strike < strike_price_gte or strike > strike_price_lte:
                            continue
                        
                        # Categorize as call or put
                        option_type = contract_data.get("option_type", "").upper()
                        if option_type == "CALL":
                            calls.append(contract_data)
                        elif option_type == "PUT":
                            puts.append(contract_data)
                    
                    except Exception as e:
                        logger.warning(f"Error processing contract row: {e}")
                        continue
            
            # Handle list/dict format
            elif isinstance(chain, (list, dict)):
                items = chain if isinstance(chain, list) else [chain]
                for item in items:
                    try:
                        contract_data = self._extract_contract_data(
                            row=item,
                            ticker=ticker,
                            expiration=expiration,
                            include_greeks=include_greeks
                        )
                        
                        if not contract_data:
                            continue
                        
                        strike = contract_data.get("strike", 0)
                        if strike < strike_price_gte or strike > strike_price_lte:
                            continue
                        
                        option_type = contract_data.get("option_type", "").upper()
                        if option_type == "CALL":
                            calls.append(contract_data)
                        elif option_type == "PUT":
                            puts.append(contract_data)
                    
                    except Exception as e:
                        logger.warning(f"Error processing contract item: {e}")
                        continue
        
        except Exception as e:
            logger.error(f"Error processing chain data: {e}", exc_info=True)
        
        return calls, puts
    
    def _extract_contract_data(
        self,
        row,
        ticker: str,
        expiration: str,
        include_greeks: bool = True
    ) -> Optional[Dict]:
        """
        Extract option contract data from a row/dict.
        
        Tradier returns data with fields like:
        - symbol: OCC symbol (e.g., "AAPL240119C00150000")
        - strike: Strike price
        - option_type: "call" or "put"
        - bid, ask, last: Price data
        - volume, open_interest: Volume data
        - greeks: delta, gamma, theta, vega, rho (from ORATS)
        - mid_iv: Implied volatility
        
        Args:
            row: DataFrame row or dict containing option data
            ticker: Underlying ticker symbol
            expiration: Expiration date
            include_greeks: Whether to include Greeks
            
        Returns:
            Dict with standardized option contract data
        """
        try:
            # Helper to get value from row (handles both DataFrame rows and dicts)
            def get_val(key, default=None):
                if hasattr(row, 'get'):
                    return row.get(key, default)
                elif hasattr(row, key):
                    return getattr(row, key, default)
                elif isinstance(row, dict):
                    return row.get(key, default)
                else:
                    try:
                        return row[key] if key in row.index else default
                    except:
                        return default
            
            # Extract basic fields
            symbol = get_val('symbol', '')
            strike = float(get_val('strike', 0))
            
            # Determine option type
            option_type_raw = get_val('option_type', get_val('type', ''))
            if isinstance(option_type_raw, str):
                option_type = "CALL" if option_type_raw.lower() == 'call' else "PUT"
            else:
                # Try to parse from symbol
                option_type = "CALL" if 'C' in str(symbol)[-10:-8] else "PUT"
            
            # Price data
            bid = get_val('bid')
            ask = get_val('ask')
            last = get_val('last')
            
            # Convert to float safely
            bid = float(bid) if bid is not None and str(bid) != 'nan' else None
            ask = float(ask) if ask is not None and str(ask) != 'nan' else None
            last = float(last) if last is not None and str(last) != 'nan' else None
            
            # Volume data
            volume = get_val('volume')
            open_interest = get_val('open_interest', get_val('openinterest'))
            
            volume = int(volume) if volume is not None and str(volume) != 'nan' else None
            open_interest = int(open_interest) if open_interest is not None and str(open_interest) != 'nan' else None
            
            # Implied volatility (Tradier provides mid_iv from ORATS)
            iv = get_val('mid_iv', get_val('implied_volatility', get_val('iv')))
            iv = float(iv) if iv is not None and str(iv) != 'nan' else None
            
            # Greeks (Tradier includes these from ORATS)
            delta = None
            gamma = None
            theta = None
            vega = None
            rho = None
            
            if include_greeks:
                # Check if greeks is a nested dict
                greeks_data = get_val('greeks', {})
                if isinstance(greeks_data, dict):
                    delta = greeks_data.get('delta')
                    gamma = greeks_data.get('gamma')
                    theta = greeks_data.get('theta')
                    vega = greeks_data.get('vega')
                    rho = greeks_data.get('rho')
                else:
                    # Greeks might be flat fields
                    delta = get_val('delta')
                    gamma = get_val('gamma')
                    theta = get_val('theta')
                    vega = get_val('vega')
                    rho = get_val('rho')
                
                # Convert to float safely
                delta = float(delta) if delta is not None and str(delta) != 'nan' else None
                gamma = float(gamma) if gamma is not None and str(gamma) != 'nan' else None
                theta = float(theta) if theta is not None and str(theta) != 'nan' else None
                vega = float(vega) if vega is not None and str(vega) != 'nan' else None
                rho = float(rho) if rho is not None and str(rho) != 'nan' else None
            
            return {
                "symbol": symbol,
                "ticker": ticker,
                "strike": strike,
                "expiration": expiration,
                "option_type": option_type,
                "last_price": last,
                "bid": bid,
                "ask": ask,
                "volume": volume,
                "open_interest": open_interest,
                "implied_volatility": iv,
                "delta": delta,
                "gamma": gamma,
                "theta": theta,
                "vega": vega,
                "rho": rho,
                "timestamp": datetime.now().isoformat() + "Z"
            }
        
        except Exception as e:
            logger.warning(f"Error extracting contract data: {e}")
            return None
    
    def _empty_options_response(self, ticker: str) -> Dict:
        """Return empty options response structure."""
        return {
            "ticker": ticker,
            "current_price": None,
            "calls": [],
            "puts": [],
            "last_updated": datetime.now().isoformat() + "Z",
            "source": "tradier",
            "expirations_fetched": []
        }
    
    async def get_expiration_dates(self, ticker: str) -> List[str]:
        """
        Get all available expiration dates for a ticker.
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            List of expiration date strings in 'YYYY-MM-DD' format
        """
        try:
            loop = asyncio.get_event_loop()
            
            def fetch_expirations():
                return self.options_data.get_expiry_dates(ticker)
            
            expirations = await loop.run_in_executor(None, fetch_expirations)
            
            if expirations is None:
                return []
            
            # Convert to list of strings
            if hasattr(expirations, 'tolist'):
                return expirations.tolist()
            elif hasattr(expirations, 'values'):
                return expirations.values.tolist()
            else:
                return list(expirations)
        
        except Exception as e:
            logger.error(f"Error fetching expiration dates for {ticker}: {e}")
            return []
    
    async def get_strikes(self, ticker: str, expiration: str) -> List[float]:
        """
        Get all available strike prices for a ticker and expiration.
        
        Args:
            ticker: Stock ticker symbol
            expiration: Expiration date in 'YYYY-MM-DD' format
            
        Returns:
            List of strike prices
        """
        try:
            loop = asyncio.get_event_loop()
            
            def fetch_strikes():
                # Note: uvatradier may not have a direct get_strikes method
                # We'll get it from the chain data
                chain = self.options_data.get_chain_day(ticker, expiration)
                if chain is not None and hasattr(chain, 'strike'):
                    return sorted(chain['strike'].unique().tolist())
                return []
            
            strikes = await loop.run_in_executor(None, fetch_strikes)
            return strikes
        
        except Exception as e:
            logger.error(f"Error fetching strikes for {ticker}: {e}")
            return []
    
    async def start_market_stream(
        self,
        symbols: List[str],
        handler: Callable,
        filter_list: Optional[List[str]] = None
    ) -> bool:
        """
        Start streaming market events for symbols.
        
        Note: Requires live_trade=True to be enabled.
        
        Args:
            symbols: List of symbols to stream (stocks or option symbols)
            handler: Callback function for stream events
            filter_list: Optional filter for event types ['trade', 'quote', 'summary', 'timesale']
            
        Returns:
            True if stream started successfully
        """
        if not self.live_trade:
            logger.error("Streaming requires live_trade=True")
            return False
        
        if self._is_streaming:
            logger.warning("Stream already running")
            return False
        
        try:
            self._stream = Stream(
                self.tradier_account,
                self.tradier_api_key,
                live_trade=True
            )
            
            self._option_handler = handler
            self._is_streaming = True
            
            # Start stream in background task
            async def run_stream():
                try:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(
                        None,
                        lambda: self._stream.stream_market_events(
                            symbol_list=symbols,
                            filter_list=filter_list or ['trade', 'quote'],
                            line_break=True
                        )
                    )
                except asyncio.CancelledError:
                    logger.info("Stream task cancelled")
                except Exception as e:
                    logger.error(f"Stream error: {e}")
                finally:
                    self._is_streaming = False
            
            self._stream_task = asyncio.create_task(run_stream())
            logger.info(f"Market stream started for {len(symbols)} symbols")
            return True
        
        except Exception as e:
            logger.error(f"Error starting stream: {e}", exc_info=True)
            self._is_streaming = False
            return False
    
    async def stop_market_stream(self) -> bool:
        """Stop the market stream."""
        if not self._is_streaming:
            return True
        
        try:
            if self._stream_task:
                self._stream_task.cancel()
                try:
                    await self._stream_task
                except asyncio.CancelledError:
                    pass
            
            self._is_streaming = False
            self._option_handler = None
            self._stream = None
            self._stream_task = None
            
            logger.info("Market stream stopped")
            return True
        
        except Exception as e:
            logger.error(f"Error stopping stream: {e}", exc_info=True)
            return False


# Global instance for singleton pattern
_tradier_option_service = None


def get_tradier_option_service() -> TradierOptionService:
    """Get or create the singleton TradierOptionService instance."""
    global _tradier_option_service
    
    if _tradier_option_service is None:
        try:
            _tradier_option_service = TradierOptionService()
            logger.info("TradierOptionService singleton created")
        except Exception as e:
            logger.error(f"Failed to initialize TradierOptionService: {str(e)}", exc_info=True)
            raise Exception(f"Tradier option service initialization failed: {str(e)}") from e
    
    return _tradier_option_service


def reset_tradier_option_service():
    """Reset the singleton instance (useful for testing or restarts)."""
    global _tradier_option_service
    _tradier_option_service = None
    logger.info("TradierOptionService singleton reset")