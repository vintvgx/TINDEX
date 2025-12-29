from services.options_analyzer import OptionsAnalyzer
import yfinance as yf
import pandas as pd
from log.logging_config import get_logger

from datetime import datetime, timedelta, timezone

from urllib.parse import urlparse

logger = get_logger(__name__)


def perform_yfinance_research(topic: str, expires_seconds: int = 60, include_options_analysis: bool | None = True) -> dict:
    """
    Perform comprehensive research using yFinance including options analysis.

    Args:
        topic: The topic or ticker to research
        expires_seconds: The seconds that the cache will expire
        include_options_analysis: Whether to include options analysis

    Returns:
        Dict containing research results with integrated options analysis
    """
    try:
        # Try to get stock info
        ticker = yf.Ticker(topic)

        # Get basic info
        try:
            info = ticker.info
        except Exception as e:
            logger.warning(f"Failed to get basic info for {topic}: {str(e)}")
            info = {}

        # Get historical data
        try:
            hist = ticker.history(period="1mo")
        except Exception as e:
            logger.warning(f"Failed to get historical data for {topic}: {str(e)}")
            hist = pd.DataFrame()

        # Get news and convert to JSON-serializable format
        try:
            news = ticker.news
            news_list = convert_dataframe_to_json(news)
        except Exception as e:
            logger.warning(f"Failed to get news for {topic}: {str(e)}")
            news_list = []

        # Get analyst recommendations
        try:
            recommendations = ticker.recommendations
            recommendations_list = convert_dataframe_to_json(recommendations)
        except Exception as e:
            logger.warning(f"Failed to get recommendations for {topic}: {str(e)}")
            recommendations_list = []

        # Get current price and change
        current_price = info.get("currentPrice", 0)
        previous_close = info.get("previousClose", current_price)
        price_change = current_price - previous_close
        price_change_percent = (
            (price_change / previous_close * 100) if previous_close else 0
        )

        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)

        # Prepare research data FIRST (before options analysis)
        research_data = {
            # Company Details
            "ticker": topic,
            "company_name": info.get("longName", info.get("shortName", topic)),
            "description": info.get("longBusinessSummary", ""),
            # Market Data
            "current_price": current_price,
            "price_change": round(price_change, 2),
            "price_change_percent": round(price_change_percent, 2),
            "volume": info.get("volume", 0),
            "day_high": info.get("dayHigh"),
            "day_low": info.get("dayLow"),
            "year_high": info.get("fiftyTwoWeekHigh"),
            "year_low": info.get("fiftyTwoWeekLow"),
            "average_volume": info.get("averageVolume"),
            # Financial Metrics
            "market_cap": info.get("marketCap"),
            "market_state": info.get("marketState"),
            "logo_url": get_company_logo(info, topic),
            "pe_ratio": info.get("trailingPE"),
            "price_to_book": info.get("priceToBook"),
            "dividend_yield": info.get("dividendYield"),
            "beta": info.get("beta"),
            "return_on_equity": info.get("returnOnEquity"),
            "debt_to_equity": info.get("debtToEquity"),
            "profit_margins": info.get("profitMargins"),
            "revenue_growth": info.get("revenueGrowth"),
            "earnings_growth": info.get("earningsGrowth"),
            # Company Info
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "country": info.get("country"),
            "currency": info.get("currency"),
            "exchange": info.get("exchange"),
            "employees": info.get("fullTimeEmployees"),
            "website": info.get("website"),
            # Additional data
            "recommendations": recommendations_list,
            "historical_data": {
                "dates": (
                    hist.index.strftime("%Y-%m-%d").tolist()
                    if not hist.empty and hasattr(hist.index, "strftime")
                    else []
                ),
                "prices": (
                    hist["Close"].tolist()
                    if not hist.empty and "Close" in hist.columns
                    else []
                ),
                "volumes": (
                    hist["Volume"].tolist()
                    if not hist.empty and "Volume" in hist.columns
                    else []
                ),
            },
            "news_data": news_list,
            "expires_at": expires_at.isoformat(),
        }

        # Calculate sentiment BEFORE options analysis
        sentiment = analyze_sentiment(research_data)
        research_data["sentiment"] = sentiment
        research_data["sentiment_score"] = sentiment.get("score")
        research_data["sentiment_confidence"] = sentiment.get("confidence")
        
        # retrieve options analysis using the research data
        if include_options_analysis:
            try:
                logger.info(f"Analyzing options for {topic} using research data")
                
                # Pass research_data and the existing ticker to avoid duplicate API calls
                analyzer = OptionsAnalyzer(research_data, ticker)
                
                # Fetch and analyze options
                analyzer.fetch_options_chain(max_expirations=5)
                analyzer.calculate_scores()
                
                # Get top opportunities
                options_analysis = analyzer.get_top_opportunities(n=10)
                
                # Add options analysis to research data
                research_data["options_analysis"] = options_analysis
                # Ensure has_options is explicitly a boolean (not dict, not None)
                has_opportunities = options_analysis.get('has_opportunities', False)
                research_data["has_options"] = bool(has_opportunities) if has_opportunities is not None else False
                
                # Extract top signal if available
                if options_analysis.get('opportunities'):
                    research_data["top_option_signal"] = options_analysis['opportunities'][0]['signal']
                    research_data["top_option_score"] = options_analysis['opportunities'][0]['total_score']
                else:
                    research_data["top_option_signal"] = None
                    research_data["top_option_score"] = None
                    
                logger.info(f"Found {len(options_analysis.get('opportunities', []))} option opportunities for {topic}")
                
            except Exception as e:
                logger.warning(f"Options analysis failed for {topic}: {str(e)}")
                research_data["options_analysis"] = {
                    'has_opportunities': False,
                    'opportunities': [],
                    'summary': {'error': str(e)}
                }
                research_data["has_options"] = False
                research_data["top_option_signal"] = None
                research_data["top_option_score"] = None

        return {"data": research_data, "success": True}

    except Exception as e:
        return {"success": False, "error": f"yFinance research failed: {str(e)}"}

def perform_yfinance_search(ticker: str) -> dict:
    """
    Search for ticker and return basic information if found.

    Args:
        ticker: The ticker being searched

    Returns:
        Dict containing basic information of the ticker
    """
    try:
        ticker_data = yf.Ticker(ticker)

        # Get basic info
        try:
            info = ticker_data.info
        except Exception as e:
            logger.warning(f"Failed to get basic info for {ticker}: {str(e)}")
            info = {}

        # Get current price and change
        current_price = info.get("currentPrice", 0)
        previous_close = info.get("previousClose", current_price)
        price_change = current_price - previous_close
        price_change_percent = (
            (price_change / previous_close * 100) if previous_close else 0
        )

        
        search_data = {
            "ticker": ticker,
            "company_name": info.get("longName", info.get("shortName", ticker)),
            # Market Data
            "current_price": current_price,
            "price_change": round(price_change, 2),
            "price_change_percent": round(price_change_percent, 2),
            "logo_url": get_company_logo(info, ticker),
            "industry": info.get("industry"),
        }
        
        return {"data": search_data, "success": True}
    except Exception as e:
        return {"success": False, "error": f"No ticker found:  {str(e)}"}

def convert_dataframe_to_json(df):
    """
    Convert a pandas DataFrame to a JSON-serializable format.
    """
    if isinstance(df, pd.DataFrame):
        return df.to_dict("records")
    return df


def analyze_sentiment(research_data: dict) -> dict:
    """
    Perform basic sentiment analysis on research data.

    Args:
        research_data: The research data to analyze

    Returns:
        Dict containing sentiment analysis results with the following structure:
        {
            "score": int,           # Composite sentiment score (-4 to +4)
                                   # Calculated by summing individual factor scores:
                                   # - Price movement: +2 (>5% gain), +1 (0-5% gain), -1 (0-5% loss), -2 (>5% loss)
                                   # - PE ratio: +1 (<15, undervalued), -1 (>25, overvalued)
                                   # - Beta: +1 (<1.0, low volatility), -1 (>1.5, high volatility)

            "sentiment": str,       # Overall sentiment category based on score:
                                   # - "bullish" (score >= 2): Positive outlook, good investment signal
                                   # - "neutral" (score 0-1): Mixed signals, hold or cautious approach
                                   # - "bearish" (score < 0): Negative outlook, potential sell signal

            "confidence": float,    # Confidence level (0-100%) in the sentiment assessment
                                   # Calculated as: min(abs(score) / 4 * 100, 100)
                                   # Higher absolute scores = higher confidence

            "factors": {
                "price_movement": float,    # Recent price change percentage
                                           # Positive = stock price increased, Negative = decreased
                                           # Key indicator of recent market performance

                "pe_ratio": float,         # Price-to-Earnings ratio
                                          # Lower values (typically <15) suggest undervalued stock
                                          # Higher values (>25) may indicate overvaluation
                                          # Industry context matters for interpretation

                "beta": float             # Stock volatility relative to market (S&P 500 = 1.0)
                                         # <1.0 = Less volatile than market (more stable)
                                         # >1.0 = More volatile than market (higher risk/reward)
                                         # >1.5 = Significantly more volatile (high risk)
            }
        }

    AAPL Example Analysis:
        {"score": 0, "sentiment": "neutral", "confidence": 0.0, "factors": {"price_movement": 1.27, "pe_ratio": 34.613983, "beta": 1.165}}

        Interpretation:
        - price_movement (1.27%): Slight positive movement, adds +1 to score
        - pe_ratio (34.61): High valuation, subtracts -1 from score
        - beta (1.165): Moderate volatility, no score impact
        - Final score: 0 (neutral sentiment)
        - This suggests AAPL is fairly valued with mixed signals - recent gains offset by high valuation
    """
    try:
        # Simple sentiment analysis based on price movement and metrics
        price_change_percent = research_data.get("price_change_percent", 0)
        pe_ratio = research_data.get("pe_ratio")
        beta = research_data.get("beta")

        # Calculate sentiment score
        sentiment_score = 0

        # Price movement sentiment
        if price_change_percent > 5:
            sentiment_score += 2
        elif price_change_percent > 0:
            sentiment_score += 1
        elif price_change_percent < -5:
            sentiment_score -= 2
        elif price_change_percent < 0:
            sentiment_score -= 1

        # PE ratio sentiment (lower is generally better)
        if pe_ratio and pe_ratio < 15:
            sentiment_score += 1
        elif pe_ratio and pe_ratio > 25:
            sentiment_score -= 1

        # Beta sentiment (lower beta = less volatile)
        if beta and beta < 1:
            sentiment_score += 1
        elif beta and beta > 1.5:
            sentiment_score -= 1

        # Determine sentiment category
        if sentiment_score >= 2:
            sentiment = "bullish"
        elif sentiment_score >= 0:
            sentiment = "neutral"
        else:
            sentiment = "bearish"

        return {
            "score": sentiment_score,
            "sentiment": sentiment,
            "confidence": min(abs(sentiment_score) / 4 * 100, 100),
            "factors": {
                "price_movement": price_change_percent,
                "pe_ratio": pe_ratio,
                "beta": beta,
            },
        }

    except Exception as e:
        return {"score": 0, "sentiment": "neutral", "confidence": 0, "error": str(e)}


def get_company_logo(info: dict, ticker: str) -> str:
    """Get company logo URL with fallbacks."""
    
    # Try yFinance logo_url first
    logo_url = info.get("logo_url")
    if logo_url:
        return logo_url
    
    # Try Clearbit with company website
    website = info.get("website")
    if website:
        domain = urlparse(website).netloc or website
        return f"https://logo.clearbit.com/{domain}"
    
    # Fallback to a default or placeholder
    return "https://craftsnippets.com/articles_images/placeholder/placeholder.jpg" 