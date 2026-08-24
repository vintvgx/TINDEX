from services.utils.options_analyzer import OptionsAnalyzer
import yfinance as yf
import pandas as pd
import pytz
from log.logging_config import get_logger

from datetime import datetime, timedelta, timezone

logger = get_logger(__name__)

ET = pytz.timezone("America/New_York")

# Maps a chart timeframe key to the (period, interval) args yfinance expects.
PERIOD_MAP = {
    "1D": ("1d", "5m"),
    "1W": ("5d", "30m"),
    "1M": ("1mo", "1d"),
    "3M": ("3mo", "1d"),
    "YTD": ("ytd", "1d"),
    "1Y": ("1y", "1d"),
    "5Y": ("5y", "1wk"),
}


def _session_boundary_lines(hist: "pd.DataFrame") -> dict | None:
    """
    1D-chart-only: fixed reference prices at each extended-hours session
    boundary (Pre-Market/Market-Hours-close/Post-Market/Overnight), mirroring
    TradingView's own guide lines. Derived entirely from the fetched bars'
    own timestamps — NOT from wall-clock "now" — so this is correct whenever
    the request happens to land (including hours after the session in
    question, e.g. checking at 3 AM against yesterday's already-closed day).

    A boundary's line is only included once the LATEST bar in `hist` has
    already progressed past it — i.e. the session actually ended — never a
    running/live value for a session still in progress. "overnight_price" is
    the flip side: only present once post-market itself has concluded, using
    the most recent known close as the standing price until pre-market data
    resumes (there is no real overnight tick source here).
    """
    if hist.empty or "Close" not in hist.columns:
        return None
    idx = hist.index
    if getattr(idx, "tz", None) is None:
        return None
    idx_et = idx.tz_convert(ET)
    minutes_of_day = [t.hour * 60 + t.minute for t in idx_et]
    closes = hist["Close"].tolist()

    PRE_END, REG_END, POST_END = 9 * 60 + 30, 16 * 60, 20 * 60
    latest_minute = minutes_of_day[-1]

    def _last_close_before(cutoff: int) -> float | None:
        best = None
        for m, c in zip(minutes_of_day, closes):
            if m < cutoff:
                best = c
            else:
                break
        return float(best) if best is not None else None

    result: dict = {}
    if latest_minute >= PRE_END:
        v = _last_close_before(PRE_END)
        if v is not None:
            result["pre_market_close"] = v
    if latest_minute >= REG_END:
        v = _last_close_before(REG_END)
        if v is not None:
            result["market_close"] = v
    if latest_minute >= POST_END:
        v = _last_close_before(POST_END)
        if v is not None:
            result["post_market_close"] = v
        result["overnight_price"] = float(closes[-1])

    return result or None


def get_historical_prices(ticker: str, period_key: str) -> dict:
    """
    Fetch a single timeframe's historical price series for the chart.

    Args:
        ticker: The stock ticker
        period_key: One of PERIOD_MAP's keys (e.g. "1D", "1Y"); falls back to "1M"

    Returns:
        Dict with "dates", "prices" (closes), "volumes", plus "opens"/"highs"/"lows"
        so the mobile chart can render candlesticks (empty lists on failure).
        1D responses also include "session_lines" (pre/market/post-market
        boundary prices) once available — see _session_boundary_lines.
    """
    period, interval = PERIOD_MAP.get(period_key, PERIOD_MAP["1M"])
    # Extended-hours bars only requested for 1D — that's the only period
    # where session boundaries (and the Pre-Market/Post-Market chart lines)
    # are meaningful; every other period is already daily/weekly closes.
    prepost = period_key == "1D"
    try:
        hist = yf.Ticker(ticker).history(period=period, interval=interval, prepost=prepost)
        # Intraday intervals can include rows with NaN prices (halts, thin
        # bars at the session edges). NaN isn't valid JSON and breaks the
        # mobile JSON.parse, so drop those rows before serializing.
        if not hist.empty and "Close" in hist.columns:
            hist = hist.dropna(subset=["Close"])
    except Exception as e:
        logger.warning(f"Failed to get historical prices for {ticker} ({period_key}): {str(e)}")
        hist = pd.DataFrame()

    def _col(name: str) -> list:
        return hist[name].tolist() if not hist.empty and name in hist.columns else []

    result = {
        "dates": (
            hist.index.strftime("%Y-%m-%dT%H:%M:%S%z").tolist()
            if not hist.empty and hasattr(hist.index, "strftime")
            else []
        ),
        "prices": _col("Close"),
        "volumes": _col("Volume"),
        "opens": _col("Open"),
        "highs": _col("High"),
        "lows": _col("Low"),
    }

    if prepost:
        session_lines = _session_boundary_lines(hist)
        if session_lines:
            result["session_lines"] = session_lines

    return result


def get_intraday_chart_for_date(ticker: str, date_str: str, interval: str = "5m") -> dict:
    """
    Intraday OHLCV + VWAP + RSI(14) for ONE specific past calendar day —
    used by the Daily Review's per-trade chart (see routes/ticker_routes.py's
    /ticker/<ticker>/history-date) so a trade card can show what actually
    happened around its entry/exit, not just the numbers.

    yfinance only serves intraday intervals for a limited lookback window
    (roughly 60 days for 5m/15m bars, far less for 1m) — a request for an
    older session_date simply comes back empty. That's expected, not an
    error: callers must check "available" and show a graceful fallback
    rather than treating an empty result as a fetch failure.

    RSI-14 uses the same simple-rolling-mean convention as
    technical_service.get_technicals (not true Wilder smoothing) — kept
    consistent with the rest of this codebase rather than mixing conventions.
    VWAP resets each session (cumulative from the first bar of THIS date only),
    matching how VWAP is meant to be read on an intraday chart.
    """
    import pandas as pd

    try:
        start = datetime.strptime(date_str, "%Y-%m-%d")
        end = start + timedelta(days=1)
        hist = yf.Ticker(ticker).history(start=start, end=end, interval=interval)
        if not hist.empty and "Close" in hist.columns:
            hist = hist.dropna(subset=["Close"])
    except Exception as e:
        logger.warning(f"Failed to get intraday chart for {ticker} on {date_str}: {str(e)}")
        hist = pd.DataFrame()

    if hist.empty:
        return {"available": False, "dates": [], "opens": [], "highs": [], "lows": [],
                "closes": [], "volumes": [], "vwap": [], "rsi": []}

    typical = (hist["High"] + hist["Low"] + hist["Close"]) / 3
    cum_pv  = (typical * hist["Volume"]).cumsum()
    cum_vol = hist["Volume"].cumsum().replace(0, float("nan"))
    vwap    = (cum_pv / cum_vol).bfill().fillna(hist["Close"]).tolist()

    close = hist["Close"]
    delta = close.diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    rs    = gain / loss.replace(0, float("nan"))
    rsi_series = (100 - 100 / (1 + rs))
    # First 14 bars have no RSI yet (insufficient window) — null, not 0/NaN,
    # so the frontend can skip plotting them instead of drawing a false floor.
    rsi = [None if pd.isna(v) else float(v) for v in rsi_series.tolist()]

    return {
        "available": True,
        "dates":   hist.index.strftime("%Y-%m-%dT%H:%M:%S%z").tolist(),
        "opens":   hist["Open"].tolist(),
        "highs":   hist["High"].tolist(),
        "lows":    hist["Low"].tolist(),
        "closes":  hist["Close"].tolist(),
        "volumes": hist["Volume"].tolist(),
        "vwap":    [round(float(v), 4) for v in vwap],
        "rsi":     rsi,
    }


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

        # Get current price and change.
        # ETFs (and some other non-equity tickers) don't populate "currentPrice" —
        # that field is equity-specific — so it comes back 0/missing. Fall back to
        # "regularMarketPrice", then to the most recent trading day's close from
        # the historical data already fetched above, before giving up at 0.
        current_price = info.get("currentPrice") or info.get("regularMarketPrice") or 0
        if not current_price and not hist.empty and "Close" in hist.columns:
            current_price = float(hist["Close"].iloc[-1])
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

        # Get current price and change. See perform_yfinance_research for why
        # ETFs need the "regularMarketPrice" fallback.
        current_price = info.get("currentPrice") or info.get("regularMarketPrice") or 0
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
    """Get company logo URL with fallbacks.

    Clearbit's free logo API (the previous primary source here) is no longer
    reliably reachable, so Financial Modeling Prep's ticker-keyed logo CDN —
    confirmed working and doesn't depend on yfinance having a `website` field —
    is used instead. The frontend falls back to a text placeholder if a given
    ticker has no logo there (FMP 404s rather than erroring).
    """

    # Try yFinance logo_url first
    logo_url = info.get("logo_url")
    if logo_url:
        return logo_url

    if ticker:
        return f"https://financialmodelingprep.com/image-stock/{ticker.upper()}.png"

    return "https://craftsnippets.com/articles_images/placeholder/placeholder.jpg"