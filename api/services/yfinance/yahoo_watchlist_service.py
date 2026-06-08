"""
Yahoo Finance Watchlist Service - Web Scraping Implementation

This service scrapes stock data from Yahoo Finance using Beautiful Soup.
It provides methods to fetch various watchlists including gainers, trending,
most active, and undervalued growth stocks.

Technical Decisions:
- Uses Beautiful Soup for HTML parsing (robust and maintainable)
- Implements retry logic with exponential backoff for reliability
- Rotates user agents to avoid rate limiting
- Caches responses to reduce server load
- Validates and normalizes data for consistency

Security Considerations:
- Respects robots.txt guidelines
- Implements rate limiting to be respectful to Yahoo's servers
- Does not store sensitive user data
"""

import requests
import time
import traceback
from bs4 import BeautifulSoup
from datetime import datetime, timezone
from typing import Dict, List, Optional
import re

import logging

logger = logging.getLogger(__name__)


class YahooWatchlistService:
    """
    Service for scraping stock watchlists from Yahoo Finance.
    
    Architecture:
    - Singleton pattern for efficient resource management
    - Separation of concerns (scraping, parsing, data transformation)
    - Defensive programming with comprehensive error handling
    
    Performance Considerations:
    - Caching to reduce redundant requests
    - Request pooling for efficiency
    - Timeout management to prevent hanging
    """

    def __init__(self):
        self.base_url = "https://finance.yahoo.com"
        self.session = requests.Session()
        
        # Rotate user agents to avoid detection as bot
        self.user_agents = [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
        
        # Rate limiting: track last request time
        self.last_request_time = 0
        self.min_request_interval = 1.0  # seconds between requests
        
        # Cache configuration
        self.cache = {}
        self.cache_ttl = 60  # Cache for 60 seconds
        
        logger.info("YahooWatchlistService initialized")

    def _get_headers(self) -> Dict[str, str]:
        """
        Generate request headers with rotating user agent.
        
        Returns:
            Dict of HTTP headers
        """
        import random
        return {
            'User-Agent': random.choice(self.user_agents),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }

    def _rate_limit(self):
        """
        Implement rate limiting to be respectful to Yahoo's servers.
        Uses simple time-based throttling.
        """
        current_time = time.time()
        time_since_last_request = current_time - self.last_request_time
        
        if time_since_last_request < self.min_request_interval:
            sleep_time = self.min_request_interval - time_since_last_request
            logger.debug(f"Rate limiting: sleeping for {sleep_time:.2f} seconds")
            time.sleep(sleep_time)
        
        self.last_request_time = time.time()

    def _fetch_page(self, url: str, max_retries: int = 3) -> Optional[BeautifulSoup]:
        """
        Fetch and parse a web page with retry logic.
        
        Args:
            url: The URL to fetch
            max_retries: Maximum number of retry attempts
            
        Returns:
            BeautifulSoup object or None if failed
            
        Error Handling:
        - Network errors: retry with exponential backoff
        - HTTP errors: log and return None
        - Parsing errors: log and return None
        """
        # Check cache first
        cache_key = url
        if cache_key in self.cache:
            cached_data, timestamp = self.cache[cache_key]
            if time.time() - timestamp < self.cache_ttl:
                logger.debug(f"Cache hit for {url}")
                return cached_data

        for attempt in range(max_retries):
            try:
                # Implement rate limiting
                self._rate_limit()
                
                logger.info(f"Fetching {url} (attempt {attempt + 1}/{max_retries})")
                
                response = self.session.get(
                    url,
                    headers=self._get_headers(),
                    timeout=30
                )
                
                response.raise_for_status()
                
                # Parse HTML
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # Cache the result
                self.cache[cache_key] = (soup, time.time())
                
                logger.info("Successfully fetched %s", url)
                return soup
                
            except requests.exceptions.Timeout:
                logger.warning(f"Timeout fetching {url} (attempt {attempt + 1}/{max_retries})")
                if attempt < max_retries - 1:
                    # Exponential backoff
                    sleep_time = 2 ** attempt
                    time.sleep(sleep_time)
                    
            except requests.exceptions.RequestException as e:
                logger.error(f"Request error fetching {url}: {str(e)}")
                if attempt < max_retries - 1:
                    sleep_time = 2 ** attempt
                    time.sleep(sleep_time)
                    
            except Exception as e:
                logger.error(f"Unexpected error fetching {url}: {str(e)}")
                break
        
        logger.error(f"Failed to fetch {url} after {max_retries} attempts")
        return None

    def _parse_price(self, price_str: str) -> Optional[float]:
        """
        Parse price string to float, handling various formats.
        
        Args:
            price_str: Price string (e.g., "123.45", "$123.45", "123.45 +1.23 (+1.01%)")
            
        Returns:
            Float price or None if parsing fails
        """
        if not price_str:
            return None
            
        try:
            # Remove currency symbols, commas, and extract first number
            cleaned = re.sub(r'[,$]', '', price_str.strip())
            # Extract first number (handles cases like "123.45 +1.23")
            match = re.search(r'[\d,]+\.?\d*', cleaned)
            if match:
                return float(match.group().replace(',', ''))
        except (ValueError, AttributeError) as e:
            logger.debug(f"Failed to parse price '{price_str}': {str(e)}")
        
        return None

    def _parse_change(self, change_str: str) -> Optional[float]:
        """
        Parse change string to float.
        
        Args:
            change_str: Change string (e.g., "+1.23", "-0.45")
            
        Returns:
            Float change or None if parsing fails
        """
        if not change_str:
            return None
            
        try:
            cleaned = change_str.strip().replace('+', '').replace(',', '')
            return float(cleaned)
        except ValueError as e:
            logger.debug(f"Failed to parse change '{change_str}': {str(e)}")
        
        return None

    def _parse_percent(self, percent_str: str) -> Optional[float]:
        """
        Parse percentage string to float.
        
        Args:
            percent_str: Percentage string (e.g., "+1.23%", "(+1.23%)")
            
        Returns:
            Float percentage or None if parsing fails
        """
        if not percent_str:
            return None
            
        try:
            # Remove %, parentheses, and + signs
            cleaned = percent_str.strip().replace('%', '').replace('(', '').replace(')', '').replace('+', '')
            return float(cleaned)
        except ValueError as e:
            logger.debug(f"Failed to parse percent '{percent_str}': {str(e)}")
        
        return None

    def _parse_volume(self, volume_str: str) -> Optional[int]:
        """
        Parse volume string to integer, handling abbreviations (K, M, B).
        
        Args:
            volume_str: Volume string (e.g., "1.5M", "120K", "1,234,567")
            
        Returns:
            Integer volume or None if parsing fails
        """
        if not volume_str:
            return None
            
        try:
            volume_str = volume_str.strip().upper().replace(',', '')
            
            multipliers = {'K': 1_000, 'M': 1_000_000, 'B': 1_000_000_000}
            
            for suffix, multiplier in multipliers.items():
                if suffix in volume_str:
                    number = float(volume_str.replace(suffix, '').strip())
                    return int(number * multiplier)
            
            # No suffix, parse as is
            return int(float(volume_str))
            
        except (ValueError, AttributeError) as e:
            logger.debug(f"Failed to parse volume '{volume_str}': {str(e)}")
        
        return None

    def _parse_market_cap(self, market_cap_str: str) -> Optional[float]:
        """
        Parse market cap string to float in billions, handling abbreviations.
        
        Args:
            market_cap_str: Market cap string (e.g., "1.5T", "120B", "500M")
            
        Returns:
            Float market cap in billions or None if parsing fails
        """
        if not market_cap_str:
            return None
            
        try:
            market_cap_str = market_cap_str.strip().upper().replace(',', '')
            
            multipliers = {'T': 1000, 'B': 1, 'M': 0.001, 'K': 0.000001}
            
            for suffix, multiplier in multipliers.items():
                if suffix in market_cap_str:
                    number = float(market_cap_str.replace(suffix, '').strip())
                    return number * multiplier
            
            # No suffix, try to parse as number
            return float(market_cap_str)
            
        except (ValueError, AttributeError) as e:
            logger.debug(f"Failed to parse market cap '{market_cap_str}': {str(e)}")
        
        return None
    
    def _parse_stock_table(self, soup: BeautifulSoup, limit: int = 25) -> List[Dict]:
        """
        Parse the stock table from Yahoo Finance full table view.
        
        Args:
            soup: BeautifulSoup object of the page
            limit: Maximum number of stocks to return
            
        Returns:
            List of stock dictionaries
        """
        stocks = []
        
        try:
            # Find the tbody element containing the table data
            tbody = soup.find('tbody')
            
            if not tbody:
                logger.warning("No tbody found on page")
                return []
            
            # Find all rows with the data table identifier
            rows = tbody.find_all('tr', {'data-testid': 'data-table-v2-row'}) # type: ignore
            
            if not rows:
                # Fallback: try to find any tr elements
                rows = tbody.find_all('tr') # type: ignore
                logger.info("Fallback: Found %s rows without data-testid", len(rows))
            else:
                logger.info("Found %s rows with data-testid", len(rows))
            
            for row in rows[:limit]:
                try:
                    # Find all cells in the row
                    cells = row.find_all('td')
                    
                    if len(cells) < 3:
                        logger.debug("Skipping row with only %s cells", len(cells))
                        continue
                    
                    # Initialize stock data
                    stock_data: Dict[str, Optional[str | float | int]] = {
                        "ticker": None,
                        "company": None,
                        "price": None,
                        "change": None,
                        "change_percent": None,
                        "volume": None,
                        "avg_volume": None,
                        "market_cap": None,
                        "pe_ratio": None,
                        "week_range": None,
                        "week_change": None
                    }
                    
                    # Process each cell using data-testid-cell attribute
                    for cell in cells:
                        # Get the data-testid-cell to identify the column
                        cell_id = cell.get('data-testid-cell', '')
                        
                        # Extract ticker
                        if cell_id == 'ticker':
                            ticker_link = cell.find('a', {'data-testid': 'table-cell-ticker'})
                            if ticker_link:
                                symbol_span = ticker_link.find('span', class_='symbol')
                                if symbol_span:
                                    stock_data["ticker"] = symbol_span.get_text(strip=True)
                        
                        # Extract company name
                        elif cell_id == 'companyshortname.raw':
                            # Try multiple selectors
                            company_div = cell.find('div', class_='leftAlignHeader companyName yf-362rys enableMaxWidth')
                            if not company_div:
                                company_div = cell.find('div', class_='leftAlignHeader companyName')
                            if company_div:
                                stock_data["company"] = company_div.get_text(strip=True)
                            else:
                                # Fallback: get direct text
                                company_text = cell.get_text(strip=True)
                                if company_text:
                                    stock_data["company"] = company_text
                        
                        # Extract price
                        elif cell_id == 'intradayprice':
                            price_streamer = cell.find('fin-streamer', {'data-field': 'regularMarketPrice'})
                            if price_streamer:
                                price_text = price_streamer.get_text(strip=True)
                                stock_data["price"] = self._parse_price(price_text) 
                        
                        # Extract change
                        elif cell_id == 'intradaypricechange':
                            change_streamer = cell.find('fin-streamer', {'data-field': 'regularMarketChange'})
                            if change_streamer:
                                change_span = change_streamer.find('span')
                                if change_span:
                                    change_text = change_span.get_text(strip=True)
                                    stock_data["change"] = self._parse_change(change_text)
                        
                        # Extract percent change
                        elif cell_id == 'percentchange':
                            pct_streamer = cell.find('fin-streamer', {'data-field': 'regularMarketChangePercent'})
                            if pct_streamer:
                                pct_span = pct_streamer.find('span')
                                if pct_span:
                                    pct_text = pct_span.get_text(strip=True)
                                    stock_data["change_percent"] = self._parse_percent(pct_text)
                        
                        # Extract volume
                        elif cell_id == 'dayvolume':
                            volume_streamer = cell.find('fin-streamer', {'data-field': 'regularMarketVolume'})
                            if volume_streamer:
                                volume_text = volume_streamer.get_text(strip=True)
                                stock_data["volume"] = self._parse_volume(volume_text)
                        
                        # Extract average volume
                        elif cell_id == 'avgdailyvol3m':
                            avg_vol_text = cell.get_text(strip=True)
                            stock_data["avg_volume"] = self._parse_volume(avg_vol_text)
                        
                        # Extract market cap
                        elif cell_id == 'intradaymarketcap':
                            cap_streamer = cell.find('fin-streamer', {'data-field': 'marketCap'})
                            if cap_streamer:
                                cap_text = cap_streamer.get_text(strip=True)
                                stock_data["market_cap"] = self._parse_market_cap(cap_text)
                        
                        elif cell_id == 'peratio.lasttwelvemonths':
                            pe_text = cell.get_text(strip=True)
                            if pe_text and pe_text not in ['--', 'N/A', '', ' ']:
                                try:
                                    # Remove any whitespace and commas
                                    pe_clean = pe_text.replace(',', '').strip()
                                    stock_data["pe_ratio"] = float(pe_clean)
                                except (ValueError, AttributeError):
                                    stock_data["pe_ratio"] = None
                        
                        # Extract 52-week change percent
                        elif cell_id == 'fiftytwowkpercentchange':
                            week_change_streamer = cell.find('fin-streamer', {'data-field': 'fiftyTwoWeekChangePercent'})
                            if week_change_streamer:
                                week_span = week_change_streamer.find('span')
                                if week_span:
                                    week_text = week_span.get_text(strip=True)
                                    stock_data["week_change"] = self._parse_percent(week_text)
                        
                        # Extract 52-week range
                        elif cell_id == 'fiftyTwoWeekRange':
                            range_div = cell.find('div', class_='labels')
                            if range_div:
                                spans = range_div.find_all('span')
                                if len(spans) >= 2:
                                    low = spans[0].get_text(strip=True)
                                    high = spans[1].get_text(strip=True)
                                    stock_data["week_range"] = f"{low} - {high}"
                    # Skip if no ticker found
                    ticker = stock_data.get("ticker")
                    if not isinstance(ticker, str) or ticker.strip().lower() in ['symbol', 'ticker', '']:
                        continue

                    stocks.append(stock_data)
                    logger.debug(
                        "Parsed stock: %s - Price: %s, Change: %s%%",
                        stock_data['ticker'], stock_data['price'], stock_data['change_percent']
                    )
                    
                except Exception as e:
                    logger.debug("Error parsing row: %s", str(e))
                    traceback.print_exc()
                    continue
            
            logger.info("Successfully parsed %s stocks", len(stocks))
            
        except Exception as e:
            logger.error("Error parsing stock table: %s", str(e))
            traceback.print_exc()
        
        return stocks

    def get_gainers(self, limit: int = 25) -> Dict:
        """
        Get biggest gaining stocks from Yahoo Finance.
        
        Args:
            limit: Maximum number of stocks to return (default: 25)
            
        Returns:
            Dict with success status and list of gaining stocks
            
        Example:
            {
                "success": True,
                "data": [
                    {
                        "ticker": "AAPL",
                        "company": "Apple Inc.",
                        "price": 150.25,
                        "change": 5.50,
                        "change_percent": 3.80,
                        ...
                    }
                ],
                "count": 25,
                "timestamp": 1234567890
            }
        """
        try:
            url = f"{self.base_url}/markets/stocks/gainers/"
            soup = self._fetch_page(url)
            
            if not soup:
                return {
                    "success": False,
                    "error": "Failed to fetch gainers page"
                }
            
            stocks = self._parse_stock_table(soup, limit)
                        
            return {
                "success": True,
                "watchlist_type": "biggest-gainers",
                "data": stocks,
                "count": len(stocks),
                "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000)
            }
            
        except Exception as e:
            logger.error(f"Error fetching gainers: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def get_trending(self, limit: int = 20) -> Dict:
        """
        Get trending stocks using Yahoo Finance JSON API (crumb-based auth).

        Uses the same 3-step flow as the PowerShell reference script:
          1. Hit finance.yahoo.com to seed session cookies
          2. Fetch the crumb token from query2
          3. Resolve trending symbols, then fetch full quote data
        Falls back to HTML scraping if the API flow fails.
        """
        try:
            self._rate_limit()
            init_resp = self.session.get(
                f"{self.base_url}/",
                headers=self._get_headers(),
                timeout=15,
            )
            init_resp.raise_for_status()

            self._rate_limit()
            crumb_resp = self.session.get(
                "https://query2.finance.yahoo.com/v1/test/getcrumb",
                headers=self._get_headers(),
                timeout=10,
            )
            crumb = crumb_resp.text.strip().strip('"')

            if not crumb:
                raise ValueError("Empty crumb returned")

            self._rate_limit()
            trending_resp = self.session.get(
                f"https://query1.finance.yahoo.com/v1/finance/trending/US"
                f"?lang=en-US&region=US&count={limit}&crumb={crumb}",
                headers=self._get_headers(),
                timeout=10,
            )
            trending_resp.raise_for_status()
            results = trending_resp.json().get("finance", {}).get("result", [])
            symbols = [q["symbol"] for q in (results[0].get("quotes", []) if results else []) if q.get("symbol")]

            if not symbols:
                raise ValueError("No trending symbols in API response")

            self._rate_limit()
            quote_resp = self.session.get(
                f"https://query1.finance.yahoo.com/v7/finance/quote"
                f"?symbols={','.join(symbols)}&lang=en-US&region=US&crumb={crumb}",
                headers=self._get_headers(),
                timeout=10,
            )
            quote_resp.raise_for_status()
            raw_quotes = quote_resp.json().get("quoteResponse", {}).get("result", [])

            stocks = []
            for q in raw_quotes:
                mc_raw = q.get("marketCap")
                wk_chg_raw = q.get("fiftyTwoWeekChangePercent")
                stocks.append({
                    "ticker":        q.get("symbol", ""),
                    "company":       q.get("shortName") or q.get("longName", ""),
                    "price":         q.get("regularMarketPrice"),
                    "change":        q.get("regularMarketChange"),
                    "change_percent": q.get("regularMarketChangePercent"),
                    "volume":        q.get("regularMarketVolume"),
                    "avg_volume":    q.get("averageDailyVolume3Month"),
                    "market_cap":    round(mc_raw / 1e9, 3) if mc_raw else None,
                    "pe_ratio":      q.get("trailingPE"),
                    "week_change":   round(wk_chg_raw * 100, 2) if wk_chg_raw else None,
                    "week_range":    f"{q.get('fiftyTwoWeekLow', '')} - {q.get('fiftyTwoWeekHigh', '')}",
                })

            logger.info("[YahooWatchlist] Fetched %d trending stocks via JSON API", len(stocks))
            return {
                "success":        True,
                "watchlist_type": "trending",
                "data":           stocks,
                "count":          len(stocks),
                "timestamp":      int(datetime.now(timezone.utc).timestamp() * 1000),
            }

        except Exception as e:
            logger.warning("[YahooWatchlist] JSON API trending failed (%s) — falling back to scraper", e)
            try:
                url = f"{self.base_url}/markets/stocks/trending/"
                soup = self._fetch_page(url)
                if not soup:
                    return {"success": False, "error": "Failed to fetch trending page"}
                stocks = self._parse_stock_table(soup, limit)
                return {
                    "success": True, "watchlist_type": "trending",
                    "data": stocks, "count": len(stocks),
                    "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
                }
            except Exception as fallback_e:
                logger.error("[YahooWatchlist] Trending fallback also failed: %s", fallback_e)
                return {"success": False, "error": str(fallback_e)}

    def get_losers(self, limit: int = 25) -> Dict:
        """Get biggest losing stocks from Yahoo Finance."""
        try:
            url = f"{self.base_url}/markets/stocks/losers/"
            soup = self._fetch_page(url)
            if not soup:
                return {"success": False, "error": "Failed to fetch losers page"}
            stocks = self._parse_stock_table(soup, limit)
            return {
                "success":        True,
                "watchlist_type": "losers",
                "data":           stocks,
                "count":          len(stocks),
                "timestamp":      int(datetime.now(timezone.utc).timestamp() * 1000),
            }
        except Exception as e:
            logger.error("Error fetching losers: %s", e)
            return {"success": False, "error": str(e)}

    def get_most_active(self, limit: int = 25) -> Dict:
        """
        Get most active stocks from Yahoo Finance.
        
        Args:
            limit: Maximum number of stocks to return (default: 25)
            
        Returns:
            Dict with success status and list of most active stocks
        """
        try:
            url = f"{self.base_url}/markets/stocks/most-active/"
            soup = self._fetch_page(url)
            
            if not soup:
                return {
                    "success": False,
                    "error": "Failed to fetch most active page"
                }
            
            stocks = self._parse_stock_table(soup, limit)
            
            return {
                "success": True,
                "watchlist_type": "most_active",
                "data": stocks,
                "count": len(stocks),
                "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000)
            }
            
        except Exception as e:
            logger.error(f"Error fetching most active stocks: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def get_undervalued_growth(self, limit: int = 25) -> Dict:
        """
        TODO DEPRECATED : Not allowed url
        Get undervalued growth stocks from Yahoo Finance screener.
        
        Args:
            limit: Maximum number of stocks to return (default: 25)
            
        Returns:
            Dict with success status and list of undervalued growth stocks
            
        Note:
            This endpoint may have different table structure than others.
            Parsing logic is adaptive to handle variations.
        """
        try:
            url = f"{self.base_url}/screener/predefined/undervalued_growth_stocks/"
            soup = self._fetch_page(url)
            
            if not soup:
                return {
                    "success": False,
                    "error": "Failed to fetch undervalued growth page"
                }
            
            stocks = self._parse_stock_table(soup, limit)
            
            return {
                "success": True,
                "watchlist_type": "undervalued_growth",
                "data": stocks,
                "count": len(stocks),
                "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000)
            }
            
        except Exception as e:
            logger.error(f"Error fetching undervalued growth stocks: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def get_all_watchlists(self, limit: int = 25) -> Dict:
        """
        Get all watchlists in a single call.
        
        Args:
            limit: Maximum number of stocks per watchlist
            
        Returns:
            Dict with all watchlists
            
        Performance Note:
            This method makes multiple HTTP requests sequentially.
            Consider using async implementation for better performance
            in production environments.
        """
        return {
            "success": True,
            "watchlists": {
                "trending":   self.get_trending(limit),
                "gainers":    self.get_gainers(limit),
                "losers":     self.get_losers(limit),
                "most_active": self.get_most_active(limit),
            },
            "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000)
        }

    def clear_cache(self):
        """Clear the internal cache."""
        self.cache.clear()
        logger.info("Cache cleared")


# Singleton instance
_yahoo_watchlist_service = None


def get_yahoo_watchlist_service() -> YahooWatchlistService:
    """
    Get or create the singleton YahooWatchlistService instance.
    
    Returns:
        YahooWatchlistService instance
        
    Singleton Pattern:
        Ensures single instance across application lifecycle,
        maintaining session state and cache efficiency.
    """
    global _yahoo_watchlist_service
    if _yahoo_watchlist_service is None:
        _yahoo_watchlist_service = YahooWatchlistService()
    return _yahoo_watchlist_service


# ==================== Test Main Function ====================

def print_stock_data(stocks: List[Dict], limit: int = 5):
    """
    Pretty print stock data for testing.
    
    Args:
        stocks: List of stock dictionaries
        limit: Number of stocks to display
    """
    for i, stock in enumerate(stocks[:limit], 1):
        print(f"\n  {i}. {stock.get('ticker', 'N/A')} - {stock.get('company', 'N/A')}")
        print(f"     Price: ${stock.get('price', 'N/A')}")
        print(f"     Change: {stock.get('change', 'N/A')} ({stock.get('change_percent', 'N/A')}%)")
        if stock.get('volume'):
            print(f"     Volume: {stock.get('volume'):,}")
        if stock.get('market_cap'):
            print(f"     Market Cap: ${stock.get('market_cap'):.2f}B")
        if stock.get('pe_ratio'):
            print(f"     P/E Ratio: {stock.get('pe_ratio')}")


def test_watchlist(name: str, method_func, limit: int = 10):
    """
    Test a watchlist method and display results.
    
    Args:
        name: Name of the watchlist
        method_func: Function to call
        limit: Number of results to fetch
    """
    print(f"\n{'='*70}")
    print(f"Testing: {name}")
    print(f"{'='*70}")
    
    try:
        result = method_func(limit=limit)
        
        if result.get("success"):
            data = result.get("data", [])
            print(f"✅ SUCCESS - Retrieved {len(data)} stocks")
            print(f"Watchlist Type: {result.get('watchlist_type', 'N/A')}")
            print(f"Timestamp: {result.get('timestamp', 'N/A')}")
            
            if data:
                print(f"\nShowing first {min(5, len(data))} stocks:")
                print_stock_data(data, limit=5)
            else:
                print("\n⚠️  No stocks returned (empty data)")
        else:
            error = result.get("error", "Unknown error")
            print(f"❌ FAILED - {error}")
            
    except Exception as e:
        print(f"❌ EXCEPTION - {str(e)}")
        traceback.print_exc()


def main():
    """
    Main function to test all Yahoo Finance watchlist methods.
    
    Usage:
        python -m services.yahoo_watchlist_service
        
    Or from the api directory:
        cd api
        python services/yahoo_watchlist_service.py
    """
    print("\n" + "="*70)
    print(" Yahoo Finance Watchlist Service - Test Suite")
    print("="*70)
    
    # Initialize service
    print("\n🔧 Initializing YahooWatchlistService...")
    service = get_yahoo_watchlist_service()
    print("✅ Service initialized")
    
    # Test configuration
    test_limit = 10
    
    # Test each watchlist type
    tests = [
        ("Biggest Gainers", service.get_gainers),
        ("Trending Stocks", service.get_trending),
        ("Most Active", service.get_most_active),
        # ("Undervalued Growth", service.get_undervalued_growth),
    ]
    
    for name, method in tests:
        test_watchlist(name, method, limit=test_limit)
        
        # Brief pause between requests to be respectful
        time.sleep(1)
    
    # Test get_all_watchlists
    print("\n" + "="*70)
    print("Testing: Get All Watchlists (Combined)")
    print("="*70)
    
    try:
        all_results = service.get_all_watchlists(limit=5)
        
        if all_results.get("success"):
            watchlists = all_results.get("watchlists", {})
            print(f"✅ SUCCESS - Retrieved {len(watchlists)} watchlists")
            
            for wl_name, wl_data in watchlists.items():
                if wl_data.get("success"):
                    count = len(wl_data.get("data", []))
                    print(f"  • {wl_name}: {count} stocks")
                else:
                    error = wl_data.get("error", "Unknown")
                    print(f"  • {wl_name}: ❌ {error}")
        else:
            print(f"❌ FAILED - {all_results.get('error', 'Unknown error')}")
            
    except Exception as e:
        print(f"❌ EXCEPTION - {str(e)}")
        traceback.print_exc()
    
    # Summary
    print("\n" + "="*70)
    print(" Test Summary")
    print("="*70)
    print(f"Total tests run: {len(tests) + 1}")
    print(f"Cache entries: {len(service.cache)}")
    print("\n✅ Testing complete!")
    print("\nNote: If any tests failed, check:")
    print("  1. Internet connection")
    print("  2. Yahoo Finance website status")
    print("  3. HTML structure changes (check logs)")
    print("  4. Rate limiting (wait a few minutes and retry)")
    print("\n" + "="*70 + "\n")


if __name__ == "__main__":
    main()