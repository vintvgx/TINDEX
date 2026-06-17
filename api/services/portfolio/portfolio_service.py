"""
Portfolio service: batch price fetch and P&L calculation for portfolio positions.

Uses yfinance batch download for current prices; computes unrealized P&L per position
and aggregates for portfolio summary. Keeps price logic server-side (no API keys on client).
"""

import pandas as pd
import yfinance as yf
from log.logging_config import get_logger

logger = get_logger(__name__)


def batch_fetch_current_prices(tickers: list[str]) -> dict[str, float]:
    """
    Fetch the latest *intraday* price for multiple tickers in a single yfinance call.

    The live ticker tape needs the current market price, not yesterday's close. We
    therefore download today's 1-minute bars (period="1d", interval="1m") and take the
    last printed bar's Close — that is the most-recent traded price while the market is
    open. When the market is closed (pre-market gap, weekend, holiday) the 1m frame is
    empty, so we fall back to the latest daily close, and finally to per-ticker
    Ticker.info.

    Args:
        tickers: List of ticker symbols (e.g. ["AAPL", "TSLA"]).

    Returns:
        Dict mapping ticker -> latest price. Missing/failed tickers are omitted.
    """
    if not tickers:
        return {}

    # 1) Live intraday price (market hours).
    prices = _download_last_close(tickers, period="1d", interval="1m")

    # 2) Daily close fallback for any ticker the intraday call didn't cover
    #    (market closed, illiquid symbol, etc.).
    missing = [t for t in tickers if t not in prices]
    if missing:
        prices.update(_download_last_close(missing, period="5d", interval="1d"))

    # 3) Last resort: per-ticker Ticker.info.
    still_missing = [t for t in tickers if t not in prices]
    if still_missing:
        prices.update(_fallback_fetch_prices(still_missing))

    return prices


def _download_last_close(tickers: list[str], period: str, interval: str) -> dict[str, float]:
    """Download bars and return {ticker: last non-NaN Close}. Never raises."""
    if not tickers:
        return {}
    try:
        data = yf.download(
            tickers,
            period=period,
            interval=interval,
            progress=False,
            threads=False,
            auto_adjust=True,
        )
        if data is None or data.empty:
            return {}

        prices: dict[str, float] = {}
        if len(tickers) == 1:
            close_series = _get_close_series_single(data, tickers[0])
            last = _last_valid(close_series)
            if last is not None:
                prices[tickers[0]] = last
        else:
            # MultiIndex columns ordered (Price, Ticker) on yfinance >= 0.2.x
            for ticker in tickers:
                try:
                    last = _last_valid(data["Close"][ticker])
                    if last is not None:
                        prices[ticker] = last
                except (KeyError, IndexError, TypeError):
                    continue
        return prices
    except Exception as e:  # pylint: disable=broad-except
        logger.warning("price download failed (period=%s interval=%s): %s", period, interval, e)
        return {}


def _last_valid(series) -> float | None:
    """Return the last non-NaN value of a Close series as a float, or None."""
    if series is None:
        return None
    try:
        cleaned = series.dropna()
        if cleaned.empty:
            return None
        return float(cleaned.iloc[-1])
    except (IndexError, TypeError, ValueError):
        return None


def _get_close_series_single(data: pd.DataFrame, ticker: str):
    """Get Close series for single-ticker download; handle flat or MultiIndex columns."""
    if "Close" in data.columns:
        return data["Close"]
    if isinstance(data.columns, pd.MultiIndex):
        try:
            return data["Close"][ticker]
        except (KeyError, TypeError):
            pass
    return None


def _fallback_fetch_prices(tickers: list[str]) -> dict[str, float]:
    """Fetch price per ticker via Ticker().info when batch download returns nothing."""
    prices: dict[str, float] = {}
    for ticker in tickers:
        try:
            t = yf.Ticker(ticker)
            info = t.info
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            if price is not None and not (isinstance(price, float) and pd.isna(price)):
                prices[ticker] = float(price)
        except Exception as e:
            logger.warning("Fallback price fetch failed for %s: %s", ticker, e)
    return prices


def calculate_position_pnl(
    shares: float,
    avg_cost: float,
    current_price: float,
    position_type: str,
) -> dict:
    """
    Compute unrealized P&L and related metrics for a single position.

    Args:
        shares: Number of shares.
        avg_cost: Average cost per share.
        current_price: Current market price per share.
        position_type: "long" or "short".

    Returns:
        Dict with unrealized_pnl, current_value, cost_basis, pnl_pct, current_price.
    """
    if position_type == "short":
        unrealized = (avg_cost - current_price) * shares
    else:
        unrealized = (current_price - avg_cost) * shares

    cost_basis = avg_cost * shares
    current_value = current_price * shares
    if avg_cost > 0:
        price_delta = avg_cost - current_price if position_type == "short" else current_price - avg_cost
        pnl_pct = price_delta / avg_cost * 100
    else:
        pnl_pct = 0.0

    return {
        "unrealized_pnl": round(float(unrealized), 4),
        "current_value": round(float(current_value), 4),
        "cost_basis": round(float(cost_basis), 4),
        "pnl_pct": round(float(pnl_pct), 4),
        "current_price": round(float(current_price), 4),
    }
