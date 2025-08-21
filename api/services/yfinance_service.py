import yfinance as yf
import pandas as pd
import logging

logger = logging.getLogger(__name__)


def perform_yfinance_research(topic: str) -> dict:
    """
    Perform comprehensive research using yFinance.

    Args:
        topic: The topic or ticker to research

    Returns:
        Dict containing research results
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
            hist = pd.DataFrame()  # Empty DataFrame as fallback

        # Get news and convert to JSON-serializable format
        try:
            news = ticker.news
            news_list = convert_dataframe_to_json(news)
        except Exception as e:
            logger.warning(f"Failed to get news for {topic}: {str(e)}")
            news_list = []

        # Get analyst recommendations and convert to JSON-serializable format
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

        # Prepare research data
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
            "regular_market_price": info.get("regularMarketPrice"),
            "regular_market_volume": info.get("regularMarketVolume"),
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
            "news": news_list,
        }

        sentiment = analyze_sentiment(research_data)
        research_data["sentiment"] = sentiment

        return {"success": True, "data": research_data}

    except Exception as e:
        return {"success": False, "error": f"yFinance research failed: {str(e)}"}


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
        Dict containing sentiment analysis results
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
